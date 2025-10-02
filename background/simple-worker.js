// Simple WatchWise Background Worker
console.log('🎯 WatchWise: Simple background worker loaded');

// Initialize storage only if not already set
chrome.runtime.onInstalled.addListener(() => {
    console.log('WatchWise extension installed');
    
    // Only initialize if data doesn't exist
    chrome.storage.local.get(['todayStats', 'videos']).then(result => {
        if (!result.todayStats && !result.videos) {
            console.log('Initializing storage for first time');
            chrome.storage.local.set({
                isTracking: true,
                todayStats: {
                    count: 0,
                    positive: 0,
                    negative: 0,
                    topics: {}
                },
                videos: []
            });
        } else {
            console.log('Storage already exists, not resetting');
        }
    });
});

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getStats') {
        chrome.storage.local.get(['todayStats', 'videos']).then(result => {
            sendResponse({
                success: true,
                data: {
                    todayStats: result.todayStats || { count: 0, positive: 0, negative: 0, topics: {} },
                    totalVideos: (result.videos || []).length
                }
            });
        });
        return true;
    }
    
    if (message.action === 'clearData') {
        chrome.storage.local.clear().then(() => {
            chrome.storage.local.set({
                isTracking: true,
                todayStats: { count: 0, positive: 0, negative: 0, topics: {} },
                videos: []
            });
            sendResponse({ success: true });
        });
        return true;
    }
});

// Listen for video storage requests from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'storeVideo') {
        chrome.storage.local.get(['videos', 'todayStats'], (result) => {
            const videos = result.videos || [];
            const todayStats = result.todayStats || { count: 0, positive: 0, negative: 0, topics: {} };

            // Prevent duplicates
            if (videos.some(v => v.id === message.data.id)) {
                sendResponse({ success: true, duplicate: true });
                return;
            }

            videos.push(message.data);
            todayStats.count++;
            if (message.data.sentiment === 'positive') todayStats.positive++;
            if (message.data.sentiment === 'negative') todayStats.negative++;
            if (!todayStats.topics[message.data.topic]) todayStats.topics[message.data.topic] = 0;
            todayStats.topics[message.data.topic]++;

            chrome.storage.local.set({ videos, todayStats }, () => {
                sendResponse({ success: true });
            });
        });
        // Return true to indicate async response
        return true;
    }
});
