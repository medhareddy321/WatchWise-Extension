// WatchWise Background Service Worker
console.log('🎯 WatchWise: Background service worker loaded');

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('WatchWise extension installed');
    
    // Initialize storage with default values
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
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received:', message);
    
    switch (message.action) {
        case 'getStats':
            handleGetStats(sendResponse);
            return true; // Keep message channel open for async response
            
        case 'clearData':
            handleClearData(sendResponse);
            return true;
            
        case 'exportData':
            handleExportData(sendResponse);
            return true;
    }
});

// Get current statistics
async function handleGetStats(sendResponse) {
    try {
        const result = await chrome.storage.local.get(['todayStats', 'videos', 'isTracking']);
        sendResponse({
            success: true,
            data: {
                todayStats: result.todayStats || { count: 0, positive: 0, negative: 0, topics: {} },
                totalVideos: (result.videos || []).length,
                isTracking: result.isTracking !== false
            }
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Clear all stored data
async function handleClearData(sendResponse) {
    try {
        await chrome.storage.local.clear();
        await chrome.storage.local.set({
            isTracking: true,
            todayStats: {
                count: 0,
                positive: 0,
                negative: 0,
                topics: {}
            },
            videos: []
        });
        
        sendResponse({ success: true });
    } catch (error) {
        console.error('Error clearing data:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Export data as JSON
async function handleExportData(sendResponse) {
    try {
        const result = await chrome.storage.local.get(['videos', 'todayStats']);
        
        const exportData = {
            exportDate: new Date().toISOString(),
            videos: result.videos || [],
            todayStats: result.todayStats || {},
            totalVideos: (result.videos || []).length
        };
        
        // Create downloadable file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // Download the file
        chrome.downloads.download({
            url: url,
            filename: `watchwise-export-${new Date().toISOString().split('T')[0]}.json`,
            saveAs: true
        });
        
        sendResponse({ success: true });
    } catch (error) {
        console.error('Error exporting data:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Daily reset functionality (runs at midnight)
function scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
        resetDailyStats();
        scheduleDailyReset(); // Schedule next reset
    }, timeUntilMidnight);
}

// Reset daily statistics
async function resetDailyStats() {
    try {
        const result = await chrome.storage.local.get(['todayStats']);
        const todayStats = result.todayStats || {};
        
        // Archive today's stats
        const archiveKey = `stats-${new Date().toISOString().split('T')[0]}`;
        await chrome.storage.local.set({ [archiveKey]: todayStats });
        
        // Reset today's stats
        await chrome.storage.local.set({
            todayStats: {
                count: 0,
                positive: 0,
                negative: 0,
                topics: {}
            }
        });
        
        console.log('Daily stats reset');
    } catch (error) {
        console.error('Error resetting daily stats:', error);
    }
}

// Start daily reset scheduler
scheduleDailyReset();
