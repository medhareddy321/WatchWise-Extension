// WatchWise Popup JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const todayCountEl = document.getElementById('todayCount');
    const positiveBarEl = document.getElementById('positiveBar');
    const negativeBarEl = document.getElementById('negativeBar');
    const sentimentTextEl = document.getElementById('sentimentText');
    const openDashboardBtn = document.getElementById('openDashboard');
    const pauseTrackingBtn = document.getElementById('pauseTracking');
    const trackingStatusEl = document.getElementById('trackingStatus');

    // Load and display current stats
    loadStats();

    // Event listeners
    openDashboardBtn.addEventListener('click', openDashboard);
    pauseTrackingBtn.addEventListener('click', toggleTracking);

    // Load stats from storage
    async function loadStats() {
        try {
            const result = await chrome.storage.local.get(['todayStats', 'isTracking']);
            
            // Update today's count
            const todayStats = result.todayStats || { count: 0, positive: 0, negative: 0 };
            todayCountEl.textContent = todayStats.count;

            // Update sentiment bar
            const total = todayStats.positive + todayStats.negative;
            if (total > 0) {
                const positivePercent = (todayStats.positive / total) * 100;
                const negativePercent = (todayStats.negative / total) * 100;
                
                positiveBarEl.style.width = positivePercent + '%';
                negativeBarEl.style.width = negativePercent + '%';
                
                // Update sentiment text
                if (positivePercent > 60) {
                    sentimentTextEl.textContent = '😊 Positive';
                } else if (negativePercent > 60) {
                    sentimentTextEl.textContent = '😔 Negative';
                } else {
                    sentimentTextEl.textContent = '😐 Neutral';
                }
            }

            // Update tracking status
            const isTracking = result.isTracking !== false; // Default to true
            updateTrackingStatus(isTracking);
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    // Open dashboard in new tab
    function openDashboard() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard/index.html')
        });
    }

    // Toggle tracking on/off
    async function toggleTracking() {
        try {
            const result = await chrome.storage.local.get(['isTracking']);
            const newTrackingState = !result.isTracking;
            
            await chrome.storage.local.set({ isTracking: newTrackingState });
            updateTrackingStatus(newTrackingState);
            
            // Send message to content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url.includes('youtube.com')) {
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'toggleTracking', 
                    isTracking: newTrackingState 
                });
            }
        } catch (error) {
            console.error('Error toggling tracking:', error);
        }
    }

    // Update tracking status display
    function updateTrackingStatus(isTracking) {
        if (isTracking) {
            trackingStatusEl.textContent = '🟢 Tracking Active';
            pauseTrackingBtn.textContent = '⏸️ Pause Tracking';
        } else {
            trackingStatusEl.textContent = '🔴 Tracking Paused';
            pauseTrackingBtn.textContent = '▶️ Resume Tracking';
        }
    }
});
