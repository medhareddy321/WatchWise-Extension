// Simple WatchWise Popup with ML Integration
document.addEventListener('DOMContentLoaded', function() {
    const todayCountEl = document.getElementById('todayCount');
    const positiveBarEl = document.getElementById('positiveBar');
    const negativeBarEl = document.getElementById('negativeBar');
    const sentimentTextEl = document.getElementById('sentimentText');
    const openDashboardBtn = document.getElementById('openDashboard');
    const trackingStatusEl = document.getElementById('trackingStatus');
    
    // ML setup elements
    const mlSetupEl = document.getElementById('mlSetup');
    const toggleMLSetupBtn = document.getElementById('toggleMLSetup');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    const mlStatusEl = document.getElementById('mlStatus');

    // Load stats and ML status
    loadStats();
    loadMLStatus();
    
    // Event listeners
    openDashboardBtn.addEventListener('click', () => {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard/index.html')
        });
    });
    
    toggleMLSetupBtn.addEventListener('click', () => {
        const isVisible = mlSetupEl.style.display !== 'none';
        mlSetupEl.style.display = isVisible ? 'none' : 'block';
        toggleMLSetupBtn.textContent = isVisible ? '🤖 AI Settings' : '❌ Close';
    });
    
    saveApiKeyBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            try {
                await chrome.storage.local.set({ huggingFaceApiKey: apiKey });
                apiKeyInput.value = '';
                mlSetupEl.style.display = 'none';
                toggleMLSetupBtn.textContent = '🤖 AI Settings';
                loadMLStatus();
                showNotification('API key saved successfully!', 'success');
            } catch (error) {
                console.error('Error saving API key:', error);
                showNotification('Error saving API key', 'error');
            }
        } else {
            showNotification('Please enter a valid API key', 'error');
        }
    });

    async function loadStats() {
        try {
            const result = await chrome.storage.local.get(['todayStats']);
            const todayStats = result.todayStats || { count: 0, positive: 0, negative: 0 };
            
            // Update count
            todayCountEl.textContent = todayStats.count;

            // Update sentiment
            const total = todayStats.positive + todayStats.negative;
            if (total > 0) {
                const positivePercent = (todayStats.positive / total) * 100;
                const negativePercent = (todayStats.negative / total) * 100;
                
                positiveBarEl.style.width = positivePercent + '%';
                negativeBarEl.style.width = negativePercent + '%';
                
                if (positivePercent > 60) {
                    sentimentTextEl.textContent = '😊 Positive';
                } else if (negativePercent > 60) {
                    sentimentTextEl.textContent = '😔 Negative';
                } else {
                    sentimentTextEl.textContent = '😐 Neutral';
                }
            }

            trackingStatusEl.textContent = '🟢 Tracking Active';
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    async function loadMLStatus() {
        try {
            const result = await chrome.storage.local.get(['huggingFaceApiKey']);
            const hasApiKey = result.huggingFaceApiKey && result.huggingFaceApiKey.length > 0;
            
            if (hasApiKey) {
                mlStatusEl.textContent = '🤖 AI: On';
                mlStatusEl.style.color = '#4ade80';
            } else {
                mlStatusEl.textContent = '🤖 AI: Off';
                mlStatusEl.style.color = '#f87171';
            }
        } catch (error) {
            console.error('Error loading ML status:', error);
            mlStatusEl.textContent = '🤖 AI: Error';
            mlStatusEl.style.color = '#f87171';
        }
    }
    
    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: ${type === 'success' ? '#4ade80' : type === 'error' ? '#f87171' : '#3b82f6'};
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
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
