// WatchWise Unified YouTube Monitor (simple-monitor.js)
// - Tracks normal videos + Shorts
// - Tracks actual watch time (handles pause/resume)
// - Detects autoplay / suggested videos (SPA navigation)
// - Uses ML (Hugging Face) with fallback keyword logic
// - Sends data to background (simple-worker) via chrome.runtime.sendMessage
// - Shows simple nudges after multiple negative videos

console.log('🎯 WatchWise: Unified simple monitor loaded');

// ----- State -----
let currentVideoId = null;         // ID of the video we're currently tracking
let currentVideoInfo = null;       // Snapshot of current video's info (title, url, etc.)
let watchStartTime = null;         // When we started (or last resumed) watching
let totalWatchTime = 0;            // Accumulated watch time (excluding pauses)
let isPaused = false;              // Whether the tracked <video> is currently paused
let currentVideoElement = null;    // Currently observed <video> element
const minWatchTime = 1000;        // Minimum watch time (ms) before we store a video (1s)

let lastUrl = window.location.href;
let isTracking = true;             // Global tracking flag (future-proof for pause/resume from popup)

// ----- Helpers: video info & ID extraction -----

function extractVideoIdFromUrl(url) {
    // Handles: 
    //   - https://www.youtube.com/watch?v=VIDEO_ID
    //   - https://youtu.be/VIDEO_ID
    //   - https://www.youtube.com/shorts/VIDEO_ID
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
    const videoId = match ? match[1] : null;
    console.log('🎯 WatchWise: Extracted video ID:', videoId, 'from URL:', url);
    return videoId;
}

// Helper function to filter out soundtrack/audio information
function filterOutSoundtrack(text) {
    if (!text) return text;
    
    // Common patterns for soundtrack/audio info that should be removed
    const soundtrackPatterns = [
        /🎵/g,
        /🎶/g,
        /soundtrack/i,
        /audio by/i,
        /music by/i,
        /song:/i,
        /track:/i,
        /original sound/i,
        /original audio/i,
        /- .* (sound|audio|music|song|track)/i, // Pattern like "- Artist Name sound"
        /\(.*sound\)/i,
        /\(.*audio\)/i,
        /\(.*music\)/i
    ];
    
    let filtered = text;
    for (const pattern of soundtrackPatterns) {
        filtered = filtered.replace(pattern, '');
    }
    
    // Remove extra whitespace
    filtered = filtered.trim().replace(/\s+/g, ' ');
    
    return filtered;
}

function getActiveShortRenderer() {
    return document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.querySelector('ytd-reel-video-renderer[mutable-state="watching"]');
}

// Extract concise information from the active Shorts renderer
function extractShortsInfo() {
    const activeRenderer = getActiveShortRenderer();
    
    if (activeRenderer) {
        // Preferred: header title string (style-scope yt-formatted-string under ytd-video-description-header-renderer)
        const header = activeRenderer.querySelector('ytd-video-description-header-renderer');
        if (header) {
            const headerTitle = header.querySelector('yt-formatted-string.style-scope.ytd-video-description-header-renderer');
            if (headerTitle && headerTitle.textContent.trim()) {
                const text = headerTitle.textContent.trim();
                console.log('🎯 WatchWise: Found Shorts header title:', text);
                return text;
            }
        }
        
        // Scoped description fallback (limited to the active renderer to avoid stale data)
        const scopedDescription = activeRenderer.querySelector('ytd-text-inline-expander');
        if (scopedDescription) {
            const expanded = scopedDescription.querySelector('#expanded');
            const snippet = scopedDescription.querySelector('#snippet');
            const candidate = (expanded && expanded.textContent.trim()) ||
                (snippet && snippet.textContent.trim());
            if (candidate) {
                const text = candidate.trim();
                console.log('🎯 WatchWise: Scoped Shorts description fallback:', text.substring(0, 100) + '...');
                return text;
            }
        }
    }
    
    // Global fallbacks as a last resort
    const fallbackSelectors = [
        'ytd-reel-description-renderer #content-text',
        'ytd-reel-description-renderer yt-formatted-string',
        '#description-text',
        'ytd-reel-player-overlay-renderer #description-text'
    ];
    
    for (const selector of fallbackSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
            const text = element.textContent.trim();
            console.log('🎯 WatchWise: Global Shorts fallback:', text.substring(0, 100) + '...');
            return text;
        }
    }
    
    const pageTitle = document.title;
    if (pageTitle) {
        const cleanTitle = pageTitle.replace(/\s*-\s*YouTube\s*$/, '').trim();
        if (cleanTitle && cleanTitle.length > 5 && cleanTitle.toLowerCase() !== 'youtube') {
            console.log('🎯 WatchWise: Using page title as fallback:', cleanTitle);
            return cleanTitle;
        }
    }
    
    return null;
}

function getVideoInfo() {
    console.log('🎯 WatchWise: Getting video info...');

    const url = window.location.href;
    const videoId = extractVideoIdFromUrl(url);
    const isShort = window.location.pathname.includes('/shorts/');

    let title = '';

    if (isShort) {
        // For Shorts, extract description and format as "YT Shorts - [description]"
        console.log('🎯 WatchWise: Detected Short, extracting description...');
        const description = extractShortsInfo();
        
        if (description && description.length > 0) {
            // Format as "YT Shorts - [description]" (truncate if too long)
            const maxLength = 100; // Reasonable length for title
            const shortDesc = description.length > maxLength 
                ? description.substring(0, maxLength).trim() + '...'
                : description;
            title = `YT Shorts - ${shortDesc}`;
            console.log('🎯 WatchWise: Formatted Shorts title:', title);
        }
    } else {
        // For regular videos, use standard title selectors
        const titleSelectors = [
            '#video-title',
            'h1.ytd-video-primary-info-renderer yt-formatted-string',
            'h1.ytd-video-primary-info-renderer',
            '.ytd-video-primary-info-renderer h1',
            'h1.title yt-formatted-string'
        ];

        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                title = element.textContent.trim();
                if (title && title.length > 0) {
                    console.log('🎯 WatchWise: Found title with selector:', selector, 'Title:', title);
                    break;
                }
            }
        }
    }

    // Fallback if nothing found
    if (!title || title.length === 0) {
        if (isShort && videoId) {
            // For Shorts, try to get description and format as "YT Shorts - [description]"
            const description = extractShortsInfo();
            if (description && description.length > 0) {
                // Format as "YT Shorts - [description]" (truncate if too long)
                const maxLength = 100; // Reasonable length for title
                const shortDesc = description.length > maxLength 
                    ? description.substring(0, maxLength).trim() + '...'
                    : description;
                title = `YT Shorts - ${shortDesc}`;
                console.log('🎯 WatchWise: Using description for Shorts title:', title);
            } else {
                title = `YT Shorts - ${videoId}`;
                console.log('🎯 WatchWise: No description found for Short, using fallback:', title);
            }
        } else if (videoId) {
            title = `Video (${videoId})`;
            console.log('🎯 WatchWise: No title found, using fallback:', title);
        }
    }

    console.log('🎯 WatchWise: URL:', url);
    console.log('🎯 WatchWise: Video ID:', videoId);
    console.log('🎯 WatchWise: Is Short:', isShort);
    console.log('🎯 WatchWise: Title:', title || '(empty)');

    return { title, videoId, url, isShort };
}

// ----- ML-powered sentiment & topic (with fallback) -----

async function getSentiment(title) {
    try {
        if (window.mlService && window.mlService.hasApiKey()) {
            console.log('🤖 Using ML sentiment analysis');
            const analysis = await window.mlService.analyzeSentiment(title);
            return {
                sentiment: analysis.sentiment,
                confidence: analysis.confidence,
                method: 'ml'
            };
        } else {
            console.log('🤖 ML service not available, using fallback sentiment');
            return getSentimentFallback(title);
        }
    } catch (error) {
        console.error('🤖 ML sentiment analysis failed:', error);
        return getSentimentFallback(title);
    }
}

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
        sentiment,
        confidence,
        method: 'fallback'
    };
}

async function getTopic(title) {
    try {
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
            console.log('🤖 ML service not available, using fallback topic');
            return getTopicFallback(title);
        }
    } catch (error) {
        console.error('🤖 ML topic classification failed:', error);
        return getTopicFallback(title);
    }
}

function getTopicFallback(title) {
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('music') || lowerTitle.includes('song') || lowerTitle.includes('album') ||
        lowerTitle.includes('artist') || lowerTitle.includes('band') || lowerTitle.includes('concert') ||
        lowerTitle.includes('taylor swift') || lowerTitle.includes('ed sheeran') || lowerTitle.includes('beyonce')) {
        return { topic: 'music', confidence: 0.7, alternatives: [], method: 'fallback' };
    }

    if (lowerTitle.includes('food') || lowerTitle.includes('cooking') || lowerTitle.includes('recipe') ||
        lowerTitle.includes('kitchen') || lowerTitle.includes('chef') || lowerTitle.includes('pizza') ||
        lowerTitle.includes('burger') || lowerTitle.includes('pasta') || lowerTitle.includes('delicious')) {
        return { topic: 'food', confidence: 0.7, alternatives: [], method: 'fallback' };
    }

    if (lowerTitle.includes('news') || lowerTitle.includes('breaking') || lowerTitle.includes('politics')) {
        return { topic: 'news', confidence: 0.7, alternatives: [], method: 'fallback' };
    }

    if (lowerTitle.includes('game') || lowerTitle.includes('gaming') || lowerTitle.includes('play')) {
        return { topic: 'gaming', confidence: 0.7, alternatives: [], method: 'fallback' };
    }

    return { topic: 'other', confidence: 0.5, alternatives: [], method: 'fallback' };
}

// ----- Core: process + store video -----

async function processVideoAsync(videoInfo, watchDurationMs) {
    try {
        // Only require videoId - title will have fallback if empty
        if (!videoInfo || !videoInfo.videoId) {
            console.log('🤖 Skipping processVideoAsync: invalid videoInfo (missing videoId)', videoInfo);
            return;
        }

        // Ensure title exists (should be set by getVideoInfo or checkVideo, but be safe)
        const title = videoInfo.title || (videoInfo.isShort 
            ? `YouTube Short (${videoInfo.videoId})`
            : `Video (${videoInfo.videoId})`);

        console.log('🤖 Processing video with ML analysis:', title, '(isShort:', videoInfo.isShort, ')');

        // Run ML analysis for all videos with meaningful titles
        // Shorts now have titles from description/hashtags/page title, so classify them too
        let sentimentAnalysis, topicAnalysis;
        
        // Only use defaults if title is clearly a fallback (starts with "YouTube Short" or "Video" and has video ID in parentheses)
        const isFallbackTitle =
            title.startsWith('YouTube Short (') ||
            title.startsWith('YT Shorts -') ||
            title.startsWith('Video (');
        
        if (isFallbackTitle || title.length < 5) {
            // No meaningful title - use defaults
            console.log('🤖 No meaningful title found, using default classification');
            sentimentAnalysis = { sentiment: 'neutral', confidence: 0.5, method: 'default' };
            topicAnalysis = { 
                topic: videoInfo.isShort ? 'entertainment' : 'other', 
                confidence: 0.5, 
                alternatives: [], 
                method: 'default' 
            };
        } else {
            // Run ML in parallel for videos with meaningful titles (including Shorts with description/hashtags)
            console.log('🤖 Running ML analysis on title:', title.substring(0, 50) + '...');
            const [sentimentResult, topicResult] = await Promise.allSettled([
                getSentiment(title),
                getTopic(title)
            ]);

            sentimentAnalysis = sentimentResult.status === 'fulfilled'
                ? sentimentResult.value
                : getSentimentFallback(title);

            if (sentimentResult.status === 'rejected') {
                console.warn('🤖 Sentiment analysis failed, using fallback:', sentimentResult.reason);
            }

            topicAnalysis = topicResult.status === 'fulfilled'
                ? topicResult.value
                : getTopicFallback(title);

            if (topicResult.status === 'rejected') {
                console.warn('🤖 Topic analysis failed, using fallback:', topicResult.reason);
            }
        }

        const videoData = {
            id: videoInfo.videoId,
            title: title, // Use the ensured title (with fallback if needed)
            url: videoInfo.url,
            isShort: videoInfo.isShort,
            sentiment: sentimentAnalysis.sentiment,
            sentimentConfidence: sentimentAnalysis.confidence,
            sentimentMethod: sentimentAnalysis.method,
            topic: topicAnalysis.topic,
            topicConfidence: topicAnalysis.confidence,
            topicAlternatives: topicAnalysis.alternatives,
            topicMethod: topicAnalysis.method,
            watchDurationMs: watchDurationMs,
            timestamp: Date.now()
        };

        console.log('🤖 ML analysis complete:', videoData);
        await storeVideo(videoData);

    } catch (error) {
        console.error('🤖 Error processing video with ML:', error);
        // Fallback minimal record if something explodes
        const fallbackTitle = videoInfo.title || (videoInfo.isShort 
            ? `YouTube Short (${videoInfo.videoId})`
            : `Video (${videoInfo.videoId})`);
        
        const videoData = {
            id: videoInfo.videoId,
            title: fallbackTitle,
            url: videoInfo.url,
            isShort: videoInfo.isShort,
            sentiment: 'neutral',
            sentimentConfidence: 0.5,
            sentimentMethod: 'error',
            topic: videoInfo.isShort ? 'entertainment' : 'other',
            topicConfidence: 0.5,
            topicAlternatives: [],
            topicMethod: 'error',
            watchDurationMs: watchDurationMs,
            timestamp: Date.now()
        };
        await storeVideo(videoData);
    }
}

async function storeVideo(videoData) {
    try {
        console.log('🎯 WatchWise: Attempting to store video:', videoData.title);
        chrome.runtime.sendMessage(
            { action: 'storeVideo', data: videoData },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error('❌ Error storing video:', chrome.runtime.lastError.message);
                } else if (response && response.success === false) {
                    // Background worker returned an error
                    console.error('❌ Error storing video:', response.error || 'Unknown error');
                } else if (response && response.duplicate) {
                    console.log('🎯 WatchWise: Video already stored:', videoData.title);
                } else if (response && response.success !== false) {
                    // Successfully stored (response.success === true or undefined but no error)
                    console.log('✅ Video stored successfully:', videoData.title);
                    // After store completes (background updated todayStats), check for nudges
                    checkForNudges();
                } else {
                    // No response or unexpected response format
                    console.warn('⚠️ Unexpected response format when storing video:', response);
                }
            }
        );
    } catch (error) {
        console.error('❌ Error storing video:', error);
    }
}

// ----- Nudge logic (from youtube-monitor) -----

function checkForNudges() {
    chrome.storage.local.get(['todayStats']).then(result => {
        const todayStats = result.todayStats || { negative: 0 };
        const negative = todayStats.negative || 0;

        // Show a nudge every 3 negative videos
        if (negative >= 3 && negative % 3 === 0) {
            showNudge();
        }
    }).catch(err => {
        console.error('Error checking nudges:', err);
    });
}

function showNudge() {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 15px;
        border-radius: 8px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    
    notification.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">🎯 WatchWise</div>
        <div>You've watched several negative videos. Consider taking a 2-minute break?</div>
        <button style="
            background: #4ade80;
            border: none;
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            margin-top: 10px;
            cursor: pointer;
        ">Got it</button>
    `;

    const button = notification.querySelector('button');
    button.addEventListener('click', () => notification.remove());

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 10000);
}

// ----- Tracking logic: new video detection + watch time -----

function computeCurrentWatchTime() {
    let currentWatchTime = totalWatchTime;
    if (watchStartTime && !isPaused) {
        currentWatchTime += Date.now() - watchStartTime;
    }
    return currentWatchTime;
}

function getTrackedVideoElement() {
    if (currentVideoElement && document.contains(currentVideoElement)) {
        return currentVideoElement;
    }
    if (!currentVideoInfo) return null;
    currentVideoElement = findActiveVideoElement(currentVideoInfo.isShort);
    return currentVideoElement;
}

function findActiveVideoElement(isShort) {
    if (isShort) {
        const activeRenderer = getActiveShortRenderer();
        if (activeRenderer) {
            const video = activeRenderer.querySelector('video');
            if (video) return video;
        }
        const fallbackShort = document.querySelector('ytd-shorts video');
        if (fallbackShort) return fallbackShort;
    } else {
        return document.querySelector('video.html5-main-video') ||
            document.querySelector('#movie_player video') ||
            document.querySelector('ytd-player video') ||
            document.querySelector('video');
    }
    return null;
}

// Retry function to wait for DOM to update after URL change
function checkVideoAfterUrlChange(expectedVideoId, retryCount) {
    const maxRetries = 8; // Increased retries for Shorts
    const baseDelay = 500; // Start with 500ms
    
    if (retryCount >= maxRetries) {
        console.log('🎯 WatchWise: Max retries reached, checking video anyway');
        checkVideo();
        return;
    }
    
    const delay = baseDelay * (retryCount + 1); // Exponential backoff: 500ms, 1000ms, 1500ms, etc.
    
    setTimeout(() => {
        console.log(`🎯 WatchWise: Checking video after URL change (attempt ${retryCount + 1}/${maxRetries})...`);
        const videoInfo = getVideoInfo();
        
        // For Shorts, check if we got the expected video ID (title might take longer to load)
        // For regular videos, also check title
        const isShort = window.location.pathname.includes('/shorts/');
        
        if (videoInfo.videoId === expectedVideoId) {
            // Video ID matches - for Shorts, proceed even if title is still loading
            // For regular videos, wait for title
            if (isShort || (videoInfo.title && videoInfo.title.trim().length > 0)) {
                console.log('🎯 WatchWise: Video info updated correctly, proceeding with check');
                checkVideo();
            } else {
                // Regular video without title yet, retry
                console.log('🎯 WatchWise: Video ID matches but title not ready yet, retrying...');
                checkVideoAfterUrlChange(expectedVideoId, retryCount + 1);
            }
        } else {
            // Video ID doesn't match - might be old info, retry
            console.log('🎯 WatchWise: Video info not ready yet (ID:', videoInfo.videoId, 'Expected:', expectedVideoId, 'Title:', videoInfo.title, '), retrying...');
            checkVideoAfterUrlChange(expectedVideoId, retryCount + 1);
        }
    }, delay);
}

function checkVideo() {
    if (!isTracking) {
        console.log('🎯 WatchWise: Tracking is paused, skipping checkVideo');
        return;
    }

    console.log('🎯 WatchWise: Checking for video...');
    const videoInfo = getVideoInfo();
    console.log('🎯 WatchWise: Video info:', videoInfo);

    // Only require videoId - title can be empty (will use fallback in getVideoInfo)
    if (!videoInfo.videoId) {
        console.log('🎯 WatchWise: No video ID found');
        return;
    }
    
    // Ensure title exists (getVideoInfo should provide fallback, but double-check)
    if (!videoInfo.title || videoInfo.title.trim().length === 0) {
        console.log('🎯 WatchWise: No title found, using fallback');
        videoInfo.title = videoInfo.isShort 
            ? `YouTube Short (${videoInfo.videoId})`
            : `Video (${videoInfo.videoId})`;
    }

    // New video detected
    if (videoInfo.videoId !== currentVideoId) {
        console.log('🎯 WatchWise: New video detected!', videoInfo.videoId, 'vs', currentVideoId);

        // If we had a previous video, process it if watched long enough
        if (currentVideoId && currentVideoInfo) {
            const watchDuration = computeCurrentWatchTime();
            console.log('🎯 WatchWise: Previous video watch duration:', watchDuration, 'ms (min:', minWatchTime, 'ms)');

            if (watchDuration >= minWatchTime) {
                console.log('🎯 WatchWise: Storing previous video (watched long enough)');
                // Use the snapshot of previous video info to avoid DOM race conditions
                const prevVideoInfo = { ...currentVideoInfo };
                processVideoAsync(prevVideoInfo, watchDuration);
            } else {
                console.log('🎯 WatchWise: Skipping previous video (not watched long enough)');
            }
        }

        // Start tracking new video
        currentVideoId = videoInfo.videoId;
        currentVideoInfo = {
            videoId: videoInfo.videoId,
            title: videoInfo.title,
            url: videoInfo.url,
            isShort: videoInfo.isShort
        };
        currentVideoElement = findActiveVideoElement(videoInfo.isShort);
        totalWatchTime = 0;
        if (currentVideoElement && !currentVideoElement.paused) {
            watchStartTime = Date.now();
            isPaused = false;
        } else {
            watchStartTime = null;
            isPaused = true;
        }

        console.log('🎥 Started tracking:', videoInfo.title);
    } else {
        // Same video ID, but check if title changed (might be a different video with same ID - shouldn't happen but be safe)
        if (currentVideoInfo && videoInfo.title !== currentVideoInfo.title) {
            console.log('🎯 WatchWise: Same video ID but title changed, updating info');
            currentVideoInfo.title = videoInfo.title;
            currentVideoInfo.url = videoInfo.url;
        }
        if (!currentVideoElement || !document.contains(currentVideoElement)) {
            currentVideoElement = findActiveVideoElement(videoInfo.isShort);
        }
        console.log('🎯 WatchWise: Same video, continuing to track...');
    }
}

function checkVideoPauseState() {
    const video = getTrackedVideoElement();
    if (!video) return;

    const wasPaused = isPaused;
    const currentlyPaused = video.paused;

    if (wasPaused !== currentlyPaused) {
        if (currentlyPaused) {
            console.log('🎯 WatchWise: Video paused');
            if (watchStartTime) {
                totalWatchTime += Date.now() - watchStartTime;
                watchStartTime = null;
            }
        } else {
            console.log('🎯 WatchWise: Video resumed');
            watchStartTime = Date.now();
        }
    }

    isPaused = currentlyPaused;
}

function storeCurrentVideoIfReady() {
    if (!currentVideoId || !currentVideoInfo) return;

    const currentWatchTime = computeCurrentWatchTime();
    console.log('🎯 WatchWise: Total watch time for current video:', currentWatchTime, 'ms (min:', minWatchTime, 'ms)');

    if (currentWatchTime >= minWatchTime) {
        console.log('🎯 WatchWise: Storing current video (watched long enough)');
        const videoInfo = { ...currentVideoInfo };
        processVideoAsync(videoInfo, currentWatchTime);
    } else {
        console.log('🎯 WatchWise: Not storing current video yet (watch time below threshold)');
    }
}

// ----- Init + monitoring -----

async function testStorage() {
    try {
        console.log('🧪 Testing storage...');
        await chrome.storage.local.set({ ww_test: 'Hello World' });
        const result = await chrome.storage.local.get(['ww_test']);
        console.log('🧪 Storage test result:', result);
        return true;
    } catch (error) {
        console.error('🧪 Storage test failed:', error);
        return false;
    }
}

async function loadTrackingFlag() {
    try {
        const result = await chrome.storage.local.get(['isTracking']);
        isTracking = result.isTracking !== false; // default true
        console.log('🎯 WatchWise: isTracking =', isTracking);
    } catch (err) {
        console.error('Error loading isTracking flag:', err);
        isTracking = true;
    }
}

function startMonitoring() {
    console.log('🎯 WatchWise: Starting unified monitoring...');
    console.log('🎯 WatchWise: Current URL:', window.location.href);
    console.log('🎯 WatchWise: Hostname:', window.location.hostname);

    // Initial check
    console.log('🎯 WatchWise: Initial video check...');
    checkVideo();

    // Periodic checks
    setInterval(() => {
        console.log('🎯 WatchWise: Periodic check...');
        checkVideo();
        checkVideoPauseState();
    }, 2000);

    // Periodically store current video if watched long enough
    setInterval(() => {
        storeCurrentVideoIfReady();
    }, 15000);

    // Watch for URL changes (SPA navigation, autoplay, Shorts swipes)
    setInterval(() => {
        const url = window.location.href;
        if (url !== lastUrl) {
            console.log('🎯 WatchWise: URL changed from', lastUrl, 'to', url);
            const oldUrl = lastUrl;
            lastUrl = url;
            
            // Extract video IDs to compare
            const oldVideoId = extractVideoIdFromUrl(oldUrl);
            const newVideoId = extractVideoIdFromUrl(url);
            
            // If video ID actually changed, clear current tracking to force new detection
            if (oldVideoId !== newVideoId) {
                console.log('🎯 WatchWise: Video ID changed, clearing current tracking');
                // Store previous video if watched long enough
                if (currentVideoId && currentVideoInfo) {
                    const watchDuration = computeCurrentWatchTime();
                    if (watchDuration >= minWatchTime) {
                        const prevVideoInfo = { ...currentVideoInfo };
                        processVideoAsync(prevVideoInfo, watchDuration);
                    }
                }
                // Clear current tracking to force detection of new video
                currentVideoId = null;
                currentVideoInfo = null;
                watchStartTime = null;
                totalWatchTime = 0;
                currentVideoElement = null;
            }
            
            // Wait for DOM to update, then check with retry logic
            checkVideoAfterUrlChange(newVideoId, 0);
        }
    }, 1000);

    // When leaving page or switching tabs, store if ready
    // Use pagehide instead of beforeunload (beforeunload is deprecated)
    window.addEventListener('pagehide', () => {
        storeCurrentVideoIfReady();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            storeCurrentVideoIfReady();
        }
    });

    console.log('🎯 WatchWise: Monitoring started successfully');
}

// Listen for toggleTracking messages (future-proof / if you add pause UI later)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleTracking') {
        isTracking = message.isTracking;
        console.log('🎯 WatchWise: Tracking toggled:', isTracking);
    }
});

// ----- Bootstrap -----

if (window.location.hostname === 'www.youtube.com' || window.location.hostname === 'm.youtube.com') {
    console.log('🎯 WatchWise: Initializing on YouTube page...');

    // First make sure storage works & load tracking flag
    testStorage().then(storageWorks => {
        if (storageWorks) {
            loadTrackingFlag().then(() => {
                console.log('🎯 WatchWise: Storage OK & tracking flag loaded, starting monitoring...');
                startMonitoring();
            });
        } else {
            console.error('🎯 WatchWise: Storage test failed, cannot start monitoring');
        }
    });
}
