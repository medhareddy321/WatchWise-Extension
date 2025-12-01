// WatchWise ML Service - Hugging Face Integration
console.log('🤖 WatchWise: ML Service loaded');

class MLService {
    constructor() {
        this.apiBase = 'https://router.huggingface.co/hf-inference/models';
        this.apiKey = null; // Will be set by user
        this.cache = new Map(); // Simple in-memory cache
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours

        // Hugging Face models
        this.models = {
            sentiment: 'cardiffnlp/twitter-roberta-base-sentiment-latest',
            emotion: 'j-hartmann/emotion-english-distilroberta-base'
        };
        // Topic model order (single stable model to avoid 404s)
        this.topicModels = [
            'facebook/bart-large-mnli'
        ];

        this.safetyLabels = [
            'nsfw',
            'sexual content',
            'pornography',
            'adult themes',
            'violence',
            'graphic violence',
            'self-harm',
            'suicide',
            'drugs',
            'alcohol',
            'gambling',
            'hate speech',
            'harassment',
            'weapons',
            'conspiracy'
        ];

        this.generalLabels = [
            'news',
            'politics',
            'education',
            'kids',
            'family',
            'gaming',
            'music',
            'sports',
            'fitness',
            'beauty and fashion',
            'food and cooking',
            'travel',
            'finance',
            'business',
            'ads or sponsored',
            'pranks',
            'challenges',
            'technology',
            'science',
            'vlog',
            'reviews',
            'comedy',
            'movies and tv',
            'art',
            'health',
            'religion',
            'environment',
            'history',
            'other'
        ];

        this.maxSentimentChars = 480;
        this.maxTopicChars = 400;
        this.maxEmotionChars = 480;

        this.init();
    }

    async init() {
        // Load API key from storage
        try {
            const result = await chrome.storage.local.get(['huggingFaceApiKey']);
            this.apiKey = result.huggingFaceApiKey;
            console.log('🤖 ML Service initialized with API key:', this.apiKey ? 'Present' : 'Not set');
        } catch (error) {
            console.error('Error loading API key:', error);
        }
    }

    async setApiKey(apiKey) {
        this.apiKey = apiKey;
        await chrome.storage.local.set({ huggingFaceApiKey: apiKey });
        console.log('🤖 API key saved');
    }

    // Check if we have API key
    hasApiKey() {
        return this.apiKey && this.apiKey.length > 0;
    }

    // Fetch via background worker to avoid CORS in content scripts
    async fetchViaBackground(url, options) {
        // If running in extension context with runtime messaging, proxy through the service worker
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime.sendMessage) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { action: 'hfFetch', url, options },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        if (!response || response.success === false) {
                            reject(new Error(response?.error || 'Background fetch failed'));
                            return;
                        }
                        resolve({
                            ok: response.ok,
                            status: response.status,
                            text: response.text
                        });
                    }
                );
            });
        }

        // Fallback: direct fetch (e.g., tests or non-extension contexts)
        const resp = await fetch(url, options);
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, text };
    }

    // Get cache key for text
    getCacheKey(text, model) {
        return `${model}:${text.toLowerCase().trim()}`;
    }

    // Check cache
    getFromCache(text, model) {
        const key = this.getCacheKey(text, model);
        const cached = this.cache.get(key);
        
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            console.log('🤖 Cache hit for:', text.substring(0, 50));
            return cached.data;
        }
        
        return null;
    }

    // Save to cache
    saveToCache(text, model, data) {
        const key = this.getCacheKey(text, model);
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

        // Make API call to Hugging Face with a quick retry and enforced truncation
    async makeApiCall(model, text, bodyOverrides = {}) {
        if (!this.hasApiKey()) {
            throw new Error('Hugging Face API key not set');
        }

        const payload = {
            inputs: text,
            options: {
                wait_for_model: true,
                use_cache: true
            },
            ...bodyOverrides
        };

        let lastError = null;
        const attempts = 2;

        for (let i = 1; i <= attempts; i++) {
            try {
                const response = await this.fetchViaBackground(`${this.apiBase}/${model}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`API call failed: ${response.status} - ${response.text}`);
                }

                try {
                    return JSON.parse(response.text);
                } catch (parseErr) {
                    throw new Error(`Invalid JSON response: ${response.text?.substring(0, 200) || ''}`);
                }
            } catch (error) {
                lastError = error;
                if (i === attempts) break;
                await new Promise(res => setTimeout(res, 400));
            }
        }

        throw lastError || new Error('Unknown HF error');
    }

    // Analyze sentiment using Hugging Face
    async analyzeSentiment(text) {
        console.log('🤖 Analyzing sentiment for:', text.substring(0, 50));
        const cleaned = this.prepareText(text, this.maxSentimentChars);

        // Check cache first
        const cached = this.getFromCache(cleaned, 'sentiment');
        if (cached) {
            return cached;
        }

        try {
            const result = await this.makeApiCall(this.models.sentiment, cleaned);

            // Process result
            const sentiment = result[0][0];
            const analysis = {
                sentiment: this.mapSentimentLabel(sentiment.label),
                confidence: sentiment.score,
                raw: sentiment
            };

            // Save to cache
            this.saveToCache(cleaned, 'sentiment', analysis);

            console.log('🤖 Sentiment result:', analysis);
            return analysis;

        } catch (error) {
            console.error('🤖 Sentiment analysis error:', error);
            // Fallback to basic analysis
            return this.fallbackSentimentAnalysis(cleaned);
        }
    }

    // Analyze topic using Hugging Face
    async analyzeTopic(text) {
        console.log('🤖 Analyzing topic for:', text.substring(0, 50));
        const cleaned = this.prepareText(text, this.maxTopicChars);

        // Check cache first
        const cached = this.getFromCache(cleaned, 'topic');
        if (cached) {
            return cached;
        }

        const candidateLabels = [...this.safetyLabels, ...this.generalLabels];
        let lastError = null;

        const modelsToTry = this.topicModels.filter(m => !m.toLowerCase().includes('fever'));

        for (const model of modelsToTry) {
            try {
                const result = await this.makeApiCall(model, cleaned, {
                    parameters: {
                        candidate_labels: candidateLabels,
                        multi_label: true
                    }
                });

                const parsed = this.parseTopicResult(result);
                if (!parsed || parsed.length === 0) {
                    throw new Error('Topic response missing labels/scores');
                }

                // Build sorted pairs
                const paired = parsed.sort((a, b) => b.confidence - a.confidence);

                // Safety override if any safety label crosses threshold
                const safetyHit = paired.find(
                    p => this.safetyLabels.includes(p.topic) && p.confidence >= 0.6
                );

                const primary = safetyHit || paired[0];

                // Confidence floor
                if (!safetyHit && (primary?.confidence ?? 0) < 0.25) {
                    console.warn('🤖 Topic low confidence; defaulting to other', primary);
                    return {
                        topic: 'other',
                        confidence: primary?.confidence ?? 0.0,
                        alternatives: paired.slice(0, 3),
                        safetyOverride: false,
                        raw: result,
                        lowConfidence: true
                    };
                }

                const analysis = {
                    topic: primary.topic,
                    confidence: primary.confidence,
                    alternatives: paired.slice(1, 4),
                    safetyOverride: !!safetyHit,
                    raw: result,
                    model
                };

                // Save to cache only on successful, non-fallback result
                this.saveToCache(cleaned, 'topic', analysis);

                console.log('🤖 Topic result:', analysis);
                return analysis;
            } catch (err) {
                lastError = err;
                console.error(`🤖 Topic model failed (${model})`, err);
                // Try next model
                continue;
            }
        }

        console.error('🤖 Topic analysis error:', lastError);
        // On failure, return neutral topic instead of forcing fallback safety labels
        return {
            topic: 'other',
            confidence: 0.0,
            alternatives: [],
            safetyOverride: false,
            raw: { error: String(lastError || 'unknown') }
        };
    }

    // Analyze emotion using Hugging Face
    async analyzeEmotion(text) {
        console.log('🤖 Analyzing emotion for:', text.substring(0, 50));
        const cleaned = this.prepareText(text, this.maxEmotionChars);

        // Check cache first
        const cached = this.getFromCache(cleaned, 'emotion');
        if (cached) {
            return cached;
        }

        try {
            const result = await this.makeApiCall(this.models.emotion, cleaned);
            
            // Process result
            const emotions = result[0];
            const topEmotion = emotions.reduce((prev, current) => 
                prev.score > current.score ? prev : current
            );
            
            const analysis = {
                emotion: topEmotion.label,
                confidence: topEmotion.score,
                allEmotions: emotions,
                raw: result
            };

            // Save to cache
            this.saveToCache(cleaned, 'emotion', analysis);
            
            console.log('🤖 Emotion result:', analysis);
            return analysis;
            
        } catch (error) {
            console.error('🤖 Emotion analysis error:', error);
            return {
                emotion: 'neutral',
                confidence: 0.5,
                allEmotions: [],
                raw: null
            };
        }
    }

    // Comprehensive analysis
    async analyzeContent(text) {
        console.log('🤖 Starting comprehensive analysis for:', text.substring(0, 50));
        
        try {
            const [sentiment, topic, emotion] = await Promise.all([
                this.analyzeSentiment(text),
                this.analyzeTopic(text),
                this.analyzeEmotion(text)
            ]);

            const enrichedSentiment = this.mergeSentimentAndEmotion(sentiment, emotion);

            const analysis = {
                sentiment: enrichedSentiment,
                topic: topic,
                emotion: emotion,
                timestamp: Date.now(),
                text: text
            };

            console.log('🤖 Comprehensive analysis complete:', analysis);
            return analysis;
            
        } catch (error) {
            console.error('🤖 Comprehensive analysis error:', error);
            return this.fallbackAnalysis(text);
        }
    }

    // Map Hugging Face sentiment labels to our format
    mapSentimentLabel(hfLabel) {
        if (!hfLabel) return 'neutral';
        const label = hfLabel.toUpperCase();
        const mapping = {
            'LABEL_0': 'negative',
            'LABEL_1': 'neutral', 
            'LABEL_2': 'positive',
            'NEGATIVE': 'negative',
            'NEUTRAL': 'neutral',
            'POSITIVE': 'positive'
        };
        return mapping[label] || 'neutral';
    }

    mergeSentimentAndEmotion(sentiment, emotion) {
        const emotionMap = {
            anger: 'negative',
            fear: 'negative',
            disgust: 'negative',
            sadness: 'negative',
            joy: 'positive',
            surprise: 'neutral',
            neutral: 'neutral',
            love: 'positive'
        };

        const emotionSentiment = emotionMap[(emotion?.emotion || '').toLowerCase()];
        const useEmotion = emotion?.confidence >= 0.35 && emotionSentiment;

        const finalSentiment = useEmotion ? emotionSentiment : sentiment.sentiment;
        const finalConfidence = useEmotion ? emotion.confidence : sentiment.confidence;

        return {
            sentiment: finalSentiment,
            confidence: finalConfidence,
            primaryEmotion: emotion?.emotion || 'neutral',
            emotionConfidence: emotion?.confidence ?? 0.0,
            raw: {
                sentiment,
                emotion
            }
        };
    }

    prepareText(text, limit) {
        const cleaned = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleaned.length <= limit) return cleaned;
        return cleaned.substring(0, limit);
    }

    parseTopicResult(result) {
        // Support nested {labels, scores} or array of {label, score}
        const labels = result?.labels || result?.[0]?.labels;
        const scores = result?.scores || result?.[0]?.scores;

        if (labels && scores && labels.length && scores.length) {
            return labels.map((label, idx) => ({
                topic: (label || '').toLowerCase(),
                confidence: scores[idx] || 0
            }));
        }

        if (Array.isArray(result) && result[0]?.label) {
            return result.map(entry => ({
                topic: (entry.label || '').toLowerCase(),
                confidence: entry.score || 0
            }));
        }

        return [];
    }

    // Fallback sentiment analysis (original keyword-based)
    fallbackSentimentAnalysis(text) {
        console.log('🤖 Using fallback sentiment analysis');
        
        const positiveWords = ['amazing', 'awesome', 'great', 'love', 'best', 'incredible', 'wonderful', 'fantastic', 'excellent', 'perfect'];
        const negativeWords = ['terrible', 'awful', 'hate', 'worst', 'horrible', 'disgusting', 'annoying', 'stupid', 'bad', 'sucks'];
        
        const lowerText = text.toLowerCase();
        let positiveScore = 0;
        let negativeScore = 0;
        
        positiveWords.forEach(word => {
            if (lowerText.includes(word)) positiveScore++;
        });
        
        negativeWords.forEach(word => {
            if (lowerText.includes(word)) negativeScore++;
        });
        
        let sentiment = 'neutral';
        let confidence = 0.5;
        
        if (positiveScore > negativeScore) {
            sentiment = 'positive';
            confidence = Math.min(0.8, 0.5 + (positiveScore * 0.1));
        } else if (negativeScore > positiveScore) {
            sentiment = 'negative';
            confidence = Math.min(0.8, 0.5 + (negativeScore * 0.1));
        }
        
        return {
            sentiment: sentiment,
            confidence: confidence,
            raw: { fallback: true, positiveScore, negativeScore }
        };
    }

    // Fallback topic analysis (original keyword-based)
    fallbackTopicAnalysis(text) {
        console.log('🤖 Using fallback topic analysis');

        const lowerText = text.toLowerCase();

        const safetyKeywords = [
            { topic: 'self-harm', keywords: ['self harm', 'suicide', 'kill myself', 'end my life'] },
            { topic: 'violence', keywords: ['kill', 'murder', 'blood', 'gore', 'violent'] },
            { topic: 'sexual content', keywords: ['nsfw', 'sex', 'porn', 'xxx', 'explicit', 'onlyfans'] },
            { topic: 'hate speech', keywords: ['hate speech', 'racist', 'bigot', 'slur'] },
            { topic: 'drugs', keywords: ['drug', 'cocaine', 'heroin', 'meth', 'weed'] },
            { topic: 'alcohol', keywords: ['alcohol', 'beer', 'vodka', 'whiskey'] },
            { topic: 'gambling', keywords: ['casino', 'betting', 'poker', 'gambling'] }
        ];

        for (const entry of safetyKeywords) {
            if (entry.keywords.some(k => lowerText.includes(k))) {
                return {
                    topic: entry.topic,
                    confidence: 0.9,
                    alternatives: [],
                    safetyOverride: true,
                    raw: { fallback: true, matched: entry.keywords.filter(k => lowerText.includes(k)) }
                };
            }
        }

        const topics = {
            'music': ['music', 'song', 'album', 'artist', 'band', 'concert', 'live', 'performance', 'lyrics'],
            'food and cooking': ['food', 'cooking', 'recipe', 'kitchen', 'chef', 'restaurant', 'meal', 'pizza', 'burger', 'noodles'],
            'news': ['news', 'breaking', 'update', 'politics', 'election', 'government', 'economy'],
            'entertainment': ['funny', 'comedy', 'meme', 'joke', 'laugh', 'hilarious', 'prank', 'reaction'],
            'education': ['tutorial', 'learn', 'how to', 'explained', 'course', 'lesson', 'study', 'programming', 'interview roadmap'],
            'lifestyle': ['vlog', 'daily', 'routine', 'life', 'travel', 'fashion', 'beauty', 'fitness'],
            'gaming': ['game', 'gaming', 'play', 'stream', 'minecraft', 'fortnite', 'call of duty'],
            'sports': ['sport', 'football', 'soccer', 'basketball', 'nba', 'nfl'],
            'technology': ['tech', 'technology', 'software', 'ai', 'machine learning']
        };

        for (const [topic, keywords] of Object.entries(topics)) {
            if (keywords.some(keyword => lowerText.includes(keyword))) {
                return {
                    topic: topic,
                    confidence: 0.7,
                    alternatives: [],
                    raw: { fallback: true, matchedKeywords: keywords.filter(k => lowerText.includes(k)) }
                };
            }
        }

        return {
            topic: 'other',
            confidence: 0.5,
            alternatives: [],
            raw: { fallback: true }
        };
    }

    // Fallback comprehensive analysis
    fallbackAnalysis(text) {
        return {
            sentiment: this.fallbackSentimentAnalysis(text),
            topic: this.fallbackTopicAnalysis(text),
            emotion: {
                emotion: 'neutral',
                confidence: 0.5,
                allEmotions: [],
                raw: { fallback: true }
            },
            timestamp: Date.now(),
            text: text
        };
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
        console.log('🤖 ML cache cleared');
    }

    // Get cache stats
    getCacheStats() {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.keys())
        };
    }
}

// Create global instance
window.mlService = new MLService();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MLService;
}
