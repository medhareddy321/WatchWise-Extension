// WatchWise YouTube Monitor - Content Script
console.log('🎯 WatchWise: YouTube monitor loaded');

class YouTubeMonitor {
    constructor() {
        this.isTracking = true;
        this.currentVideo = null;
        this.observer = null;
        this.watchStartTime = null;
        this.minWatchTime = 10000; // 10 seconds in milliseconds
        this.init();
    }

    async init() {
        console.log('🎯 WatchWise: Initializing monitor...');
        
        // Check if tracking is enabled
        const result = await chrome.storage.local.get(['isTracking']);
        this.isTracking = result.isTracking !== false; // Default to true
        console.log('🎯 WatchWise: Tracking enabled:', this.isTracking);

        // Start monitoring
        this.startMonitoring();
        
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'toggleTracking') {
                this.isTracking = message.isTracking;
                console.log('Tracking toggled:', this.isTracking);
            }
        });
        
        console.log('🎯 WatchWise: Monitor initialized successfully');
    }

    startMonitoring() {
        console.log('🎯 WatchWise: Starting monitoring...');
        
        // Monitor for URL changes (when navigating between videos)
        let currentUrl = window.location.href;
        
        // Monitor for video changes
        this.observer = new MutationObserver((mutations) => {
            if (!this.isTracking) return;
            
            // Check if URL changed (new video)
            if (window.location.href !== currentUrl) {
                console.log('🎯 WatchWise: URL changed, detecting new video...');
                currentUrl = window.location.href;
                
                // Small delay to let page load
                setTimeout(() => {
                    if (this.isVideoPage()) {
                        this.detectCurrentVideo();
                    }
                }, 1000);
            }
            
            // Also check for video changes on current page
            if (this.isVideoPage()) {
                this.detectCurrentVideo();
            }
        });

        // Start observing
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial check
        console.log('🎯 WatchWise: Current URL:', window.location.href);
        console.log('🎯 WatchWise: Is video page:', this.isVideoPage());
        
        if (this.isVideoPage()) {
            console.log('🎯 WatchWise: Initial video detection...');
            // Delay initial detection to let page load
            setTimeout(() => {
                this.detectCurrentVideo();
            }, 2000);
        }

        // Handle page unload to process final video
        window.addEventListener('beforeunload', () => {
            if (this.currentVideo && this.watchStartTime) {
                const watchDuration = Date.now() - this.watchStartTime;
                if (watchDuration >= this.minWatchTime) {
                    this.processVideo(this.currentVideo);
                }
            }
        });
        
        console.log('🎯 WatchWise: Monitoring started successfully');
    }

    isVideoPage() {
        // Check if we're on a YouTube video page
        return window.location.pathname.includes('/watch') || 
               window.location.pathname.includes('/shorts/');
    }

    detectCurrentVideo() {
        try {
            console.log('🎯 WatchWise: Detecting current video...');
            
            // Get video information
            const videoData = this.extractVideoData();
            console.log('🎯 WatchWise: Extracted video data:', videoData);
            
            if (videoData && this.isNewVideo(videoData)) {
                console.log('🎯 WatchWise: New video detected!');
                
                // If we were watching a previous video, check if we watched it long enough
                if (this.currentVideo && this.watchStartTime) {
                    const watchDuration = Date.now() - this.watchStartTime;
                    console.log('🎯 WatchWise: Previous video watch duration:', watchDuration, 'ms');
                    if (watchDuration >= this.minWatchTime) {
                        console.log('🎯 WatchWise: Processing previous video (watched long enough)');
                        this.processVideo(this.currentVideo);
                    } else {
                        console.log('🎯 WatchWise: Skipping previous video (not watched long enough)');
                    }
                }
                
                // Start tracking new video
                this.currentVideo = videoData;
                this.watchStartTime = Date.now();
                console.log('🎥 Started tracking new video:', videoData.title);
            } else if (videoData) {
                console.log('🎯 WatchWise: Same video, continuing to track...');
            } else {
                console.log('🎯 WatchWise: No video data extracted');
            }
        } catch (error) {
            console.error('Error detecting video:', error);
        }
    }

    extractVideoData() {
        // Extract video title - try multiple selectors
        let title = '';
        const titleSelectors = [
            'h1.ytd-video-primary-info-renderer yt-formatted-string',
            'h1.ytd-video-primary-info-renderer',
            '#video-title',
            'h1.title yt-formatted-string',
            '.ytd-video-primary-info-renderer h1'
        ];
        
        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                title = element.textContent.trim();
                break;
            }
        }

        // Extract channel name - try multiple selectors
        let channel = '';
        const channelSelectors = [
            '#channel-name a',
            '#owner-name a', 
            'ytd-channel-name a',
            '#upload-info yt-formatted-string a',
            '.ytd-channel-name a'
        ];
        
        for (const selector of channelSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                channel = element.textContent.trim();
                break;
            }
        }

        // Extract video URL
        const url = window.location.href;

        // Extract video ID
        const videoId = this.extractVideoId(url);

        // Check if it's a Short
        const isShort = window.location.pathname.includes('/shorts/');

        if (!title || !videoId) {
            console.log('Could not extract video data:', { title, videoId, url });
            return null;
        }

        return {
            id: videoId,
            title: title,
            channel: channel,
            url: url,
            isShort: isShort,
            timestamp: Date.now()
        };
    }

    extractVideoId(url) {
        // Extract video ID from YouTube URL
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\n?#]+)/);
        const videoId = match ? match[1] : null;
        console.log('🎯 WatchWise: Extracted video ID:', videoId, 'from URL:', url);
        return videoId;
    }

    isNewVideo(videoData) {
        return !this.currentVideo || this.currentVideo.id !== videoData.id;
    }

    async processVideo(videoData) {
        console.log('🎥 Processing video:', videoData.title);
        
        // Analyze sentiment (simple keyword-based approach for now)
        const sentiment = this.analyzeSentiment(videoData.title);
        console.log('🎯 WatchWise: Sentiment:', sentiment);
        
        // Classify topic (simple keyword matching for now)
        const topic = this.classifyTopic(videoData.title);
        console.log('🎯 WatchWise: Topic:', topic);
        
        // Store video data
        const processedVideo = {
            ...videoData,
            sentiment: sentiment,
            topic: topic,
            processedAt: Date.now()
        };

        console.log('🎯 WatchWise: Storing video data...');
        await this.storeVideoData(processedVideo);
        console.log('🎯 WatchWise: Video data stored successfully!');
        
        // Show notification if needed
        this.checkForNudges(processedVideo);
    }

    analyzeSentiment(text) {
        // Simple sentiment analysis using keywords
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
        
        if (positiveScore > negativeScore) return 'positive';
        if (negativeScore > positiveScore) return 'negative';
        return 'neutral';
    }

    classifyTopic(text) {
        // Improved topic classification using keywords
        const topics = {
            'music': ['music', 'song', 'album', 'artist', 'band', 'concert', 'live', 'performance', 'lyrics', 'mv', 'music video', 'taylor swift', 'ed sheeran', 'beyonce', 'ariana grande', 'drake', 'billie eilish', 'the weeknd', 'dua lipa', 'olivia rodrigo', 'harry styles', 'justin bieber', 'rihanna', 'adele', 'bruno mars', 'coldplay', 'maroon 5', 'imagine dragons', 'one republic', 'twenty one pilots'],
            'food': ['food', 'cooking', 'recipe', 'kitchen', 'chef', 'restaurant', 'meal', 'dinner', 'lunch', 'breakfast', 'baking', 'grill', 'pizza', 'burger', 'pasta', 'sushi', 'tacos', 'chicken', 'beef', 'vegetarian', 'vegan', 'healthy', 'delicious', 'tasty', 'yummy', 'eat', 'drink', 'coffee', 'tea', 'smoothie', 'salad', 'soup', 'dessert', 'cake', 'chocolate'],
            'news': ['news', 'breaking', 'update', 'politics', 'election', 'trump', 'biden', 'government', 'economy', 'stock market', 'covid', 'pandemic', 'war', 'conflict', 'international', 'local news', 'weather'],
            'entertainment': ['funny', 'comedy', 'meme', 'joke', 'laugh', 'hilarious', 'prank', 'reaction', 'viral', 'trending', 'celebrity', 'gossip', 'show', 'movie', 'netflix', 'disney'],
            'education': ['tutorial', 'learn', 'how to', 'explained', 'course', 'lesson', 'study', 'school', 'university', 'science', 'math', 'history', 'language', 'programming', 'coding', 'technology'],
            'lifestyle': ['vlog', 'daily', 'routine', 'life', 'day in the life', 'travel', 'fashion', 'beauty', 'makeup', 'skincare', 'fitness', 'workout', 'gym', 'health', 'wellness', 'home', 'decor', 'organization'],
            'gaming': ['game', 'gaming', 'play', 'stream', 'twitch', 'minecraft', 'fortnite', 'call of duty', 'valorant', 'league of legends', 'among us', 'roblox', 'pokemon', 'nintendo', 'playstation', 'xbox', 'pc gaming', 'esports']
        };
        
        const lowerText = text.toLowerCase();
        
        // Check for exact matches first (higher priority)
        for (const [topic, keywords] of Object.entries(topics)) {
            if (keywords.some(keyword => lowerText.includes(keyword))) {
                return topic;
            }
        }
        
        return 'other';
    }

    async storeVideoData(videoData) {
        try {
            // Check if extension context is still valid
            if (!chrome.runtime?.id) {
                console.error('Extension context invalidated, cannot store data');
                return;
            }

            // Get existing data
            const result = await chrome.storage.local.get(['videos', 'todayStats']);
            const videos = result.videos || [];
            const todayStats = result.todayStats || { count: 0, positive: 0, negative: 0, topics: {} };
            
            // Check if this video is already stored (prevent duplicates)
            const existingVideo = videos.find(v => v.id === videoData.id);
            if (existingVideo) {
                console.log('📊 Video already stored, skipping:', videoData.title);
                return;
            }
            
            // Add new video
            videos.push(videoData);
            
            // Update today's stats
            todayStats.count++;
            if (videoData.sentiment === 'positive') todayStats.positive++;
            if (videoData.sentiment === 'negative') todayStats.negative++;
            
            // Update topic stats
            if (!todayStats.topics[videoData.topic]) {
                todayStats.topics[videoData.topic] = 0;
            }
            todayStats.topics[videoData.topic]++;
            
            // Store updated data
            await chrome.storage.local.set({
                videos: videos,
                todayStats: todayStats
            });
            
            console.log('📊 Video data stored:', videoData.title);
        } catch (error) {
            console.error('Error storing video data:', error);
            // If extension context is invalidated, try to reinitialize
            if (error.message.includes('Extension context invalidated')) {
                console.log('Extension context invalidated, will retry on next video');
            }
        }
    }

    checkForNudges(videoData) {
        // Simple nudge logic - show notification after 3 negative videos
        chrome.storage.local.get(['todayStats']).then(result => {
            const todayStats = result.todayStats || { negative: 0 };
            
            if (todayStats.negative >= 3 && todayStats.negative % 3 === 0) {
                this.showNudge();
            }
        });
    }

    showNudge() {
        // Create a simple notification overlay
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
            <button onclick="this.parentElement.remove()" style="
                background: #4ade80;
                border: none;
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                margin-top: 10px;
                cursor: pointer;
            ">Got it</button>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 10000);
    }
}

// Initialize the monitor
const monitor = new YouTubeMonitor();
