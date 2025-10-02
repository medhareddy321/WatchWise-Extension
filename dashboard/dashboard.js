// WatchWise Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const todayCountEl = document.getElementById('todayCount');
    const todayChangeEl = document.getElementById('todayChange');
    const positiveBarEl = document.getElementById('positiveBar');
    const negativeBarEl = document.getElementById('negativeBar');
    const positiveCountEl = document.getElementById('positiveCount');
    const negativeCountEl = document.getElementById('negativeCount');
    const topicsListEl = document.getElementById('topicsList');
    const recentVideosEl = document.getElementById('recentVideos');
    
    const clearDataBtn = document.getElementById('clearData');
    const exportDataBtn = document.getElementById('exportData');
    const refreshDataBtn = document.getElementById('refreshData');

    // Event listeners
    clearDataBtn.addEventListener('click', clearAllData);
    exportDataBtn.addEventListener('click', exportData);
    refreshDataBtn.addEventListener('click', loadDashboardData);

    // Load initial data
    loadDashboardData();

    // Load dashboard data
    async function loadDashboardData() {
        try {
            const result = await chrome.storage.local.get(['videos', 'todayStats']);
            const videos = result.videos || [];
            const todayStats = result.todayStats || { count: 0, positive: 0, negative: 0, topics: {} };

            // Update today's count
            todayCountEl.textContent = todayStats.count;
            
            // Update sentiment visualization
            updateSentimentDisplay(todayStats);
            
            // Update topics
            updateTopicsDisplay(todayStats.topics);
            
            // Update recent videos
            updateRecentVideos(videos);
            
            console.log('Dashboard data loaded successfully');
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }

    // Update sentiment display
    function updateSentimentDisplay(stats) {
        const total = stats.positive + stats.negative;
        
        if (total > 0) {
            const positivePercent = (stats.positive / total) * 100;
            const negativePercent = (stats.negative / total) * 100;
            
            positiveBarEl.style.width = positivePercent + '%';
            negativeBarEl.style.width = negativePercent + '%';
            
            positiveCountEl.textContent = stats.positive;
            negativeCountEl.textContent = stats.negative;
        } else {
            positiveBarEl.style.width = '50%';
            negativeBarEl.style.width = '50%';
            positiveCountEl.textContent = '0';
            negativeCountEl.textContent = '0';
        }
    }

    // Update topics display
    function updateTopicsDisplay(topics) {
        if (Object.keys(topics).length === 0) {
            topicsListEl.innerHTML = '<div class="topic-item"><span class="topic-name">No topics yet</span><span class="topic-count">0</span></div>';
            return;
        }

        // Sort topics by count
        const sortedTopics = Object.entries(topics)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5); // Show top 5 topics

        topicsListEl.innerHTML = sortedTopics.map(([topic, count]) => `
            <div class="topic-item">
                <span class="topic-name">${topic}</span>
                <span class="topic-count">${count}</span>
            </div>
        `).join('');
    }

    // Update recent videos display
    function updateRecentVideos(videos) {
        if (videos.length === 0) {
            recentVideosEl.innerHTML = '<div class="video-item"><span class="video-title">No videos tracked yet</span><span class="video-sentiment">😐</span></div>';
            return;
        }

        // Get unique videos (by video ID) and sort by timestamp
        const uniqueVideos = [];
        const seenIds = new Set();
        
        // Process videos in reverse chronological order to get most recent unique videos
        videos.slice().reverse().forEach(video => {
            if (!seenIds.has(video.id)) {
                seenIds.add(video.id);
                uniqueVideos.push(video);
            }
        });

        // Get last 5 unique videos
        const recentVideos = uniqueVideos.slice(0, 5);

        if (recentVideos.length === 0) {
            recentVideosEl.innerHTML = '<div class="video-item"><span class="video-title">No unique videos tracked yet</span><span class="video-sentiment">😐</span></div>';
            return;
        }

        recentVideosEl.innerHTML = recentVideos.map(video => {
            const sentimentEmoji = getSentimentEmoji(video.sentiment);
            const topicEmoji = getTopicEmoji(video.topic);
            const shortTitle = video.title.length > 45 ? video.title.substring(0, 45) + '...' : video.title;
            
            return `
                <div class="video-item">
                    <span class="video-title" title="${video.title}">${shortTitle}</span>
                    <span class="video-info">
                        <span class="video-sentiment">${sentimentEmoji}</span>
                        <span class="video-topic">${topicEmoji}</span>
                    </span>
                </div>
            `;
        }).join('');
    }

    // Get sentiment emoji
    function getSentimentEmoji(sentiment) {
        switch (sentiment) {
            case 'positive': return '😊';
            case 'negative': return '😔';
            default: return '😐';
        }
    }

    // Get topic emoji
    function getTopicEmoji(topic) {
        switch (topic) {
            case 'music': return '🎵';
            case 'food': return '🍕';
            case 'news': return '📰';
            case 'entertainment': return '🎬';
            case 'education': return '📚';
            case 'lifestyle': return '✨';
            case 'gaming': return '🎮';
            default: return '📺';
        }
    }

    // Clear all data
    async function clearAllData() {
        if (confirm('Are you sure you want to clear all data? This action cannot be undone.')) {
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
                
                // Reload dashboard
                loadDashboardData();
                
                // Show success message
                showNotification('All data cleared successfully', 'success');
            } catch (error) {
                console.error('Error clearing data:', error);
                showNotification('Error clearing data', 'error');
            }
        }
    }

    // Export data
    async function exportData() {
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
            
            // Create download link
            const a = document.createElement('a');
            a.href = url;
            a.download = `watchwise-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showNotification('Data exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting data:', error);
            showNotification('Error exporting data', 'error');
        }
    }

    // Show notification
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4ade80' : type === 'error' ? '#f87171' : '#3b82f6'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: slideIn 0.3s ease;
        `;
        
        notification.textContent = message;
        document.body.appendChild(notification);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
});
