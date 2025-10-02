// WatchWise ML Service - Hugging Face Integration
console.log('🤖 WatchWise: ML Service loaded');

class MLService {
    constructor() {
        this.apiBase = 'https://api-inference.huggingface.co/models';
        this.apiKey = null; // Will be set by user
        this.cache = new Map(); // Simple in-memory cache
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
        
        // Hugging Face models
        this.models = {
            sentiment: 'cardiffnlp/twitter-roberta-base-sentiment-latest',
            topic: 'facebook/bart-large-mnli',
            emotion: 'j-hartmann/emotion-english-distilroberta-base'
        };
        
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

    // Make API call to Hugging Face
    async makeApiCall(model, text) {
        if (!this.hasApiKey()) {
            throw new Error('Hugging Face API key not set');
        }

        const response = await fetch(`${this.apiBase}/${model}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: text,
                options: {
                    wait_for_model: true,
                    use_cache: true
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API call failed: ${response.status} - ${errorText}`);
        }

        return await response.json();
    }

    // Analyze sentiment using Hugging Face
    async analyzeSentiment(text) {
        console.log('🤖 Analyzing sentiment for:', text.substring(0, 50));
        
        // Check cache first
        const cached = this.getFromCache(text, 'sentiment');
        if (cached) {
            return cached;
        }

        try {
            const result = await this.makeApiCall(this.models.sentiment, text);
            
            // Process result
            const sentiment = result[0][0];
            const analysis = {
                sentiment: this.mapSentimentLabel(sentiment.label),
                confidence: sentiment.score,
                raw: sentiment
            };

            // Save to cache
            this.saveToCache(text, 'sentiment', analysis);
            
            console.log('🤖 Sentiment result:', analysis);
            return analysis;
            
        } catch (error) {
            console.error('🤖 Sentiment analysis error:', error);
            // Fallback to basic analysis
            return this.fallbackSentimentAnalysis(text);
        }
    }

    // Analyze topic using Hugging Face
    async analyzeTopic(text) {
        console.log('🤖 Analyzing topic for:', text.substring(0, 50));
        
        // Check cache first
        const cached = this.getFromCache(text, 'topic');
        if (cached) {
            return cached;
        }

        try {
            // Use BART for zero-shot classification
            const candidateLabels = [
                'music', 'food', 'news', 'entertainment', 'education', 
                'lifestyle', 'gaming', 'technology', 'sports', 'travel',
                'fashion', 'beauty', 'health', 'fitness', 'business',
                'science', 'art', 'comedy', 'drama', 'documentary'
            ];

            const response = await fetch(`${this.apiBase}/${this.models.topic}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: text,
                    parameters: {
                        candidate_labels: candidateLabels
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API call failed: ${response.status} - ${errorText}`);
            }

            const result = await response.json();

            // Process result
            const topic = result.labels[0];
            const confidence = result.scores[0];
            
            const analysis = {
                topic: topic,
                confidence: confidence,
                alternatives: result.labels.slice(1, 4).map((label, index) => ({
                    topic: label,
                    confidence: result.scores[index + 1]
                })),
                raw: result
            };

            // Save to cache
            this.saveToCache(text, 'topic', analysis);
            
            console.log('🤖 Topic result:', analysis);
            return analysis;
            
        } catch (error) {
            console.error('🤖 Topic analysis error:', error);
            // Fallback to basic analysis
            return this.fallbackTopicAnalysis(text);
        }
    }

    // Analyze emotion using Hugging Face
    async analyzeEmotion(text) {
        console.log('🤖 Analyzing emotion for:', text.substring(0, 50));
        
        // Check cache first
        const cached = this.getFromCache(text, 'emotion');
        if (cached) {
            return cached;
        }

        try {
            const result = await this.makeApiCall(this.models.emotion, text);
            
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
            this.saveToCache(text, 'emotion', analysis);
            
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

            const analysis = {
                sentiment: sentiment,
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
        const mapping = {
            'LABEL_0': 'negative',
            'LABEL_1': 'neutral', 
            'LABEL_2': 'positive'
        };
        return mapping[hfLabel] || 'neutral';
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
        
        const topics = {
            'music': ['music', 'song', 'album', 'artist', 'band', 'concert', 'live', 'performance', 'lyrics'],
            'food': ['food', 'cooking', 'recipe', 'kitchen', 'chef', 'restaurant', 'meal', 'pizza', 'burger'],
            'news': ['news', 'breaking', 'update', 'politics', 'election', 'government', 'economy'],
            'entertainment': ['funny', 'comedy', 'meme', 'joke', 'laugh', 'hilarious', 'prank', 'reaction'],
            'education': ['tutorial', 'learn', 'how to', 'explained', 'course', 'lesson', 'study', 'programming'],
            'lifestyle': ['vlog', 'daily', 'routine', 'life', 'travel', 'fashion', 'beauty', 'fitness'],
            'gaming': ['game', 'gaming', 'play', 'stream', 'minecraft', 'fortnite', 'call of duty']
        };
        
        const lowerText = text.toLowerCase();
        
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
