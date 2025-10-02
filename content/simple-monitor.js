// Simple WatchWise Monitor - No complex features, just works
console.log('🎯 WatchWise: Simple monitor loaded');

let currentVideoId = null;
let watchStartTime = null;
let totalWatchTime = 0; // Total actual watch time (excluding pauses)
let isPaused = false;
const minWatchTime = 10000; // 10 seconds

// Simple function to get video info
function getVideoInfo() {
    console.log('🎯 WatchWise: Getting video info...');
    
    // Try multiple selectors for title
    const titleSelectors = [
        '#video-title',
        'h1.ytd-video-primary-info-renderer yt-formatted-string',
        'h1.ytd-video-primary-info-renderer',
        '.ytd-video-primary-info-renderer h1',
        'h1.title yt-formatted-string'
    ];
    
    let title = '';
    for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            title = element.textContent.trim();
            console.log('🎯 WatchWise: Found title with selector:', selector, 'Title:', title);
            break;
        }
    }
    
    const url = window.location.href;
    const videoIdMatch = url.match(/[?&]v=([^&]+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;
    
    console.log('🎯 WatchWise: URL:', url);
    console.log('🎯 WatchWise: Video ID:', videoId);
    
    return { title, videoId, url };
}

// ML-powered sentiment analysis using Hugging Face
async function getSentiment(title) {
    try {
        // Check if ML service is available
        if (window.mlService && window.mlService.hasApiKey()) {
            console.log('🤖 Using ML sentiment analysis');
            const analysis = await window.mlService.analyzeSentiment(title);
            return {
                sentiment: analysis.sentiment,
                confidence: analysis.confidence,
                method: 'ml'
            };
        } else {
            console.log('🤖 ML service not available, using fallback');
            return getSentimentFallback(title);
        }
    } catch (error) {
        console.error('🤖 ML sentiment analysis failed:', error);
        return getSentimentFallback(title);
    }
}

// Fallback sentiment analysis (original keyword-based)
function getSentimentFallback(title) {
    const positiveWords = ['amazing', 'awesome', 'great', 'love', 'best', 'incredible', 'wonderful', 'fantastic', 'excellent', 'perfect', 'beautiful', 'happy'];
    const negativeWords = ['terrible', 'awful', 'hate', 'worst', 'horrible', 'disgusting', 'annoying', 'stupid', 'bad', 'sucks', 'angry', 'sad'];
    
    const lowerTitle = title.toLowerCase();
    let positiveScore = 0;
    let negativeScore = 0;
    
    positiveWords.forEach(word => {
        if (lowerTitle.includes(word)) positiveScore++;
    });
    
    negativeWords.forEach(word => {
        if (lowerTitle.includes(word)) negativeScore++;
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
        method: 'fallback'
    };
}

// ML-powered topic classification using Hugging Face
async function getTopic(title) {
    try {
        // Check if ML service is available
        if (window.mlService && window.mlService.hasApiKey()) {
            console.log('🤖 Using ML topic classification');
            const analysis = await window.mlService.analyzeTopic(title);
            return {
                topic: analysis.topic,
                confidence: analysis.confidence,
                alternatives: analysis.alternatives,
                method: 'ml'
            };
        } else {
            console.log('🤖 ML service not available, using fallback');
            return getTopicFallback(title);
        }
    } catch (error) {
        console.error('🤖 ML topic classification failed:', error);
        return getTopicFallback(title);
    }
}

// Fallback topic classification (original keyword-based)
function getTopicFallback(title) {
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('music') || lowerTitle.includes('song') || lowerTitle.includes('album') || 
        lowerTitle.includes('artist') || lowerTitle.includes('band') || lowerTitle.includes('concert') ||
        lowerTitle.includes('taylor swift') || lowerTitle.includes('ed sheeran') || lowerTitle.includes('beyonce')) {
        return {
            topic: 'music',
            confidence: 0.7,
            alternatives: [],
            method: 'fallback'
        };
    }
    
    if (lowerTitle.includes('food') || lowerTitle.includes('cooking') || lowerTitle.includes('recipe') ||
        lowerTitle.includes('kitchen') || lowerTitle.includes('chef') || lowerTitle.includes('pizza') ||
        lowerTitle.includes('burger') || lowerTitle.includes('pasta') || lowerTitle.includes('delicious')) {
        return {
            topic: 'food',
            confidence: 0.7,
            alternatives: [],
            method: 'fallback'
        };
    }
    
    if (lowerTitle.includes('news') || lowerTitle.includes('breaking') || lowerTitle.includes('politics')) {
        return {
            topic: 'news',
            confidence: 0.7,
            alternatives: [],
            method: 'fallback'
        };
    }
    
    if (lowerTitle.includes('game') || lowerTitle.includes('gaming') || lowerTitle.includes('play')) {
        return {
            topic: 'gaming',
            confidence: 0.7,
            alternatives: [],
            method: 'fallback'
        };
    }
    
    return {
        topic: 'other',
        confidence: 0.5,
        alternatives: [],
        method: 'fallback'
    };
}

// Process video with async ML analysis
async function processVideoAsync(videoInfo) {
    try {
        console.log('🤖 Processing video with ML analysis:', videoInfo.title);
        
        // Get ML analysis
        const [sentimentAnalysis, topicAnalysis] = await Promise.all([
            getSentiment(videoInfo.title),
            getTopic(videoInfo.title)
        ]);
        
        const videoData = {
            id: videoInfo.videoId,
            title: videoInfo.title,
            url: videoInfo.url,
            sentiment: sentimentAnalysis.sentiment,
            sentimentConfidence: sentimentAnalysis.confidence,
            sentimentMethod: sentimentAnalysis.method,
            topic: topicAnalysis.topic,
            topicConfidence: topicAnalysis.confidence,
            topicAlternatives: topicAnalysis.alternatives,
            topicMethod: topicAnalysis.method,
            timestamp: Date.now()
        };
        
        console.log('🤖 ML analysis complete:', videoData);
        await storeVideo(videoData);
        
    } catch (error) {
        console.error('🤖 Error processing video with ML:', error);
        // Fallback to basic processing
        const videoData = {
            id: videoInfo.videoId,
            title: videoInfo.title,
            url: videoInfo.url,
            sentiment: 'neutral',
            sentimentConfidence: 0.5,
            sentimentMethod: 'error',
            topic: 'other',
            topicConfidence: 0.5,
            topicAlternatives: [],
            topicMethod: 'error',
            timestamp: Date.now()
        };
        await storeVideo(videoData);
    }
}

// Store video data
async function storeVideo(videoData) {
    try {
        console.log('🎯 WatchWise: Attempting to store video:', videoData.title);
        chrome.runtime.sendMessage(
            { action: 'storeVideo', data: videoData },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error('❌ Error storing video:', chrome.runtime.lastError.message);
                } else if (response && response.duplicate) {
                    console.log('🎯 WatchWise: Video already stored:', videoData.title);
                } else {
                    console.log('✅ Video stored successfully:', videoData.title);
                }
            }
        );
    } catch (error) {
        console.error('❌ Error storing video:', error);
    }
}

// Check for new video
function checkVideo() {
    console.log('🎯 WatchWise: Checking for video...');
    const videoInfo = getVideoInfo();
    console.log('🎯 WatchWise: Video info:', videoInfo);
    
    if (!videoInfo.videoId || !videoInfo.title) {
        console.log('🎯 WatchWise: No video ID or title found');
        return;
    }
    
    // New video detected
    if (videoInfo.videoId !== currentVideoId) {
        console.log('🎯 WatchWise: New video detected!', videoInfo.videoId, 'vs', currentVideoId);
        
        // Process previous video if watched long enough
        if (currentVideoId && watchStartTime) {
            const watchDuration = Date.now() - watchStartTime;
            console.log('🎯 WatchWise: Previous video watch duration:', watchDuration, 'ms (min:', minWatchTime, 'ms)');
            if (watchDuration >= minWatchTime) {
                console.log('🎯 WatchWise: Storing previous video (watched long enough)');
                // Get previous video data and store it
                const prevVideoInfo = getVideoInfo();
                if (prevVideoInfo.videoId === currentVideoId) {
                    // Use async ML analysis
                    processVideoAsync(prevVideoInfo);
                }
            } else {
                console.log('🎯 WatchWise: Skipping previous video (not watched long enough)');
            }
        }
        
        // Start tracking new video
        currentVideoId = videoInfo.videoId;
        watchStartTime = Date.now();
        totalWatchTime = 0; // Reset total watch time for new video
        isPaused = false;
        console.log('🎥 Started tracking:', videoInfo.title);
    } else {
        console.log('🎯 WatchWise: Same video, continuing to track...');
    }
}

// Check if video is paused
function checkVideoPauseState() {
    const video = document.querySelector('video');
    if (video) {
        const wasPaused = isPaused;
        isPaused = video.paused;
        
        if (wasPaused !== isPaused) {
            if (isPaused) {
                console.log('🎯 WatchWise: Video paused');
                // Add the time watched so far to total
                if (watchStartTime) {
                    totalWatchTime += Date.now() - watchStartTime;
                    watchStartTime = null; // Reset start time
                }
            } else {
                console.log('🎯 WatchWise: Video resumed');
                // Start timing again
                watchStartTime = Date.now();
            }
        }
    }
}

// Store current video if watched long enough
function storeCurrentVideoIfReady() {
    if (currentVideoId) {
        // Calculate total watch time
        let currentWatchTime = totalWatchTime;
        if (watchStartTime && !isPaused) {
            currentWatchTime += Date.now() - watchStartTime;
        }
        
        console.log('🎯 WatchWise: Total watch time:', currentWatchTime, 'ms (min:', minWatchTime, 'ms)');
        
        if (currentWatchTime >= minWatchTime) {
            console.log('🎯 WatchWise: Storing current video (watched long enough)');
            const videoInfo = getVideoInfo();
            if (videoInfo.videoId === currentVideoId) {
                // Use async ML analysis
                processVideoAsync(videoInfo);
            }
        }
    }
}

// Start monitoring
function startMonitoring() {
    console.log('🎯 WatchWise: Starting simple monitoring...');
    console.log('🎯 WatchWise: Current URL:', window.location.href);
    console.log('🎯 WatchWise: Is YouTube page:', window.location.hostname === 'www.youtube.com');
    
    // Check immediately
    console.log('🎯 WatchWise: Initial video check...');
    checkVideo();
    
    // Check every 2 seconds
    setInterval(() => {
        console.log('🎯 WatchWise: Periodic check...');
        checkVideo();
        checkVideoPauseState(); // Check if video is paused
    }, 2000);
    
    // Store current video every 15 seconds if watched long enough
    setInterval(() => {
        storeCurrentVideoIfReady();
    }, 15000);
    
    // Check on page changes
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            console.log('🎯 WatchWise: URL changed from', lastUrl, 'to', window.location.href);
            lastUrl = window.location.href;
            setTimeout(() => {
                console.log('🎯 WatchWise: Checking video after URL change...');
                checkVideo();
            }, 1000); // Wait for page to load
        }
    }, 1000);
    
    // Store video when leaving the page
    window.addEventListener('beforeunload', () => {
        storeCurrentVideoIfReady();
    });
    
    // Store video when page becomes hidden (user switches tabs)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            storeCurrentVideoIfReady();
        }
    });
}

// Test storage function
async function testStorage() {
    try {
        console.log('🧪 Testing storage...');
        await chrome.storage.local.set({ test: 'Hello World' });
        const result = await chrome.storage.local.get(['test']);
        console.log('🧪 Storage test result:', result);
        return true;
    } catch (error) {
        console.error('🧪 Storage test failed:', error);
        return false;
    }
}

// Initialize
if (window.location.hostname === 'www.youtube.com') {
    console.log('🎯 WatchWise: Initializing on YouTube page...');
    
    // Test storage first
    testStorage().then(storageWorks => {
        if (storageWorks) {
            console.log('🎯 WatchWise: Storage test passed, starting monitoring...');
            startMonitoring();
        } else {
            console.error('🎯 WatchWise: Storage test failed, cannot start monitoring');
        }
    });
}
