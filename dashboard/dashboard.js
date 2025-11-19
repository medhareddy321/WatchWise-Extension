// WatchWise Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const todayCountEl = document.getElementById('todayCount');
    const todayChangeEl = document.getElementById('todayChange');
    const totalWatchTimeEl = document.getElementById('totalWatchTime');
    const todayWatchTimeEl = document.getElementById('todayWatchTime');
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
            const todayStats = computeTodayStats(videos);

            // Update today's count
            todayCountEl.textContent = todayStats.count;
            
            // Update watch time
            updateWatchTimeDisplay(videos, todayStats);
            
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

    // Format time from milliseconds to readable format
    function formatWatchTime(ms) {
        if (!ms || ms === 0) return '0s';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // Update watch time display
    function updateWatchTimeDisplay(videos, todayStats) {
        // Calculate total watch time from all videos
        const totalWatchTime = videos.reduce((total, video) => {
            return total + (video.watchDurationMs || 0);
        }, 0);
        
        // Calculate today's watch time (videos watched today)
        const today = new Date().toDateString();
        const todayWatchTime = videos
            .filter(video => {
                const videoDate = new Date(video.timestamp);
                return videoDate.toDateString() === today;
            })
            .reduce((total, video) => {
                return total + (video.watchDurationMs || 0);
            }, 0);
        
        // Update display
        totalWatchTimeEl.textContent = formatWatchTime(totalWatchTime);
        todayWatchTimeEl.textContent = `Today: ${formatWatchTime(todayWatchTime)}`;
    }

    function computeTodayStats(videos) {
        const stats = { count: 0, positive: 0, negative: 0, topics: {} };
        const todayKey = new Date().toDateString();

        videos.forEach(video => {
            if (!video || !video.timestamp) return;
            const videoDate = new Date(video.timestamp).toDateString();
            if (videoDate !== todayKey) return;

            stats.count++;

            const sentiment = getVideoSentiment(video);
            if (sentiment === 'positive') {
                stats.positive++;
            } else if (sentiment === 'negative') {
                stats.negative++;
            }

            const topic = getVideoTopic(video);
            if (topic) {
                stats.topics[topic] = (stats.topics[topic] || 0) + 1;
            }
        });

        return stats;
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

    // Update recent videos display - show all videos from today
    function updateRecentVideos(videos) {
        if (videos.length === 0) {
            recentVideosEl.innerHTML = '<div class="video-item"><span class="video-title">No videos tracked yet</span><span class="video-sentiment">😐</span></div>';
            return;
        }

        // Filter videos from today
        const today = new Date().toDateString();
        const todayVideos = videos.filter(video => {
            const videoDate = new Date(video.timestamp);
            return videoDate.toDateString() === today;
        });

        if (todayVideos.length === 0) {
            recentVideosEl.innerHTML = '<div class="video-item"><span class="video-title">No videos watched today</span><span class="video-sentiment">😐</span></div>';
            return;
        }

        // Sort by timestamp (most recent first)
        todayVideos.sort((a, b) => b.timestamp - a.timestamp);

        recentVideosEl.innerHTML = todayVideos.map(video => {
            const sentiment = getVideoSentiment(video);
            const topic = getVideoTopic(video);
            const sentimentEmoji = getSentimentEmoji(sentiment);
            const topicEmoji = getTopicEmoji(topic);
            const shortTitle = video.title.length > 40 ? video.title.substring(0, 40) + '...' : video.title;
            const watchTime = formatWatchTime(video.watchDurationMs || 0);
            
            return `
                <div class="video-item">
                    <span class="video-title" title="${video.title}">${shortTitle}</span>
                    <span class="video-info">
                        <span class="video-watch-time" title="Watch time">${watchTime}</span>
                        <span class="video-sentiment">${sentimentEmoji}</span>
                        <span class="video-topic">${topicEmoji}</span>
                    </span>
                </div>
            `;
        }).join('');
    }

    function getVideoSentiment(video) {
        if (!video) return 'neutral';
        return (video.parentOverrides && video.parentOverrides.sentiment) || video.sentiment || 'neutral';
    }

    function getVideoTopic(video) {
        if (!video) return 'other';
        return (video.parentOverrides && video.parentOverrides.topic) || video.topic || 'other';
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
