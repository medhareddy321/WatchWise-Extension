// WatchWise Background Worker (all features merged)
console.log('🎯 WatchWise: Background worker loaded');

// ----- Helpers -----

// Default shape for today's stats
function getDefaultTodayStats() {
  return {
    count: 0,
    positive: 0,
    negative: 0,
    topics: {}
  };
}

function getEffectiveSentiment(video) {
  return (
    (video.parentOverrides && video.parentOverrides.sentiment) ||
    video.sentiment ||
    'neutral'
  );
}

function getEffectiveTopic(video, isShort) {
  return (
    (video.parentOverrides && video.parentOverrides.topic) ||
    video.topic ||
    (isShort ? 'entertainment' : 'other')
  );
}

function computeTodayStatsFromVideos(videos) {
  const stats = getDefaultTodayStats();
  const todayKey = new Date().toDateString();

  videos.forEach(video => {
    if (!video || !video.timestamp) return;
    const videoDate = new Date(video.timestamp).toDateString();
    if (videoDate !== todayKey) return;

    stats.count++;

    const sentiment = getEffectiveSentiment(video);
    if (sentiment === 'positive') {
      stats.positive++;
    } else if (sentiment === 'negative') {
      stats.negative++;
    }

    const topic = getEffectiveTopic(video, video.isShort);
    if (topic) {
      stats.topics[topic] = (stats.topics[topic] || 0) + 1;
    }
  });

  return stats;
}

// Initialize storage only if it doesn't already exist
async function initializeStorageIfNeeded() {
  const result = await chrome.storage.local.get([
    'todayStats',
    'videos',
    'isTracking'
  ]);

  const hasTodayStats = !!result.todayStats;
  const hasVideos = !!result.videos;
  const hasIsTracking = typeof result.isTracking !== 'undefined';

  if (!hasTodayStats && !hasVideos && !hasIsTracking) {
    console.log('[Init] Initializing storage for the first time');
    await chrome.storage.local.set({
      isTracking: true,
      todayStats: getDefaultTodayStats(),
      videos: []
    });
  } else {
    console.log('[Init] Storage already exists, not resetting');
  }
}

// ----- Lifecycle -----

chrome.runtime.onInstalled.addListener(() => {
  console.log('WatchWise extension installed');
  initializeStorageIfNeeded().catch(err =>
    console.error('[Init] Error initializing storage:', err)
  );
});

// ----- Message Handling -----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Message received:', message);

  switch (message.action) {
    case 'getStats':
      handleGetStats(sendResponse);
      return true; // async

    case 'clearData':
      handleClearData(sendResponse);
      return true; // async

    case 'storeVideo':
      handleStoreVideo(message.data, sendResponse);
      return true; // async

    case 'exportData':
      handleExportData(sendResponse);
      return true; // async

    default:
      // Unknown action – just ignore
      return false;
  }
});

// ----- Action Handlers -----

// 1) Get current statistics
async function handleGetStats(sendResponse) {
  try {
    const result = await chrome.storage.local.get([
      'todayStats',
      'videos',
      'isTracking'
    ]);

    const videos = result.videos || [];
    const todayStats = computeTodayStatsFromVideos(videos);
    const isTracking = result.isTracking !== false; // default true

    await chrome.storage.local.set({ todayStats });

    sendResponse({
      success: true,
      data: {
        todayStats,
        totalVideos: videos.length,
        isTracking
      }
    });
  } catch (error) {
    console.error('[getStats] Error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 2) Clear all stored data and reset
async function handleClearData(sendResponse) {
  try {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      isTracking: true,
      todayStats: getDefaultTodayStats(),
      videos: []
    });

    console.log('[clearData] Storage cleared and reset');
    sendResponse({ success: true });
  } catch (error) {
    console.error('[clearData] Error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 3) Store a video and update todayStats
async function handleStoreVideo(videoData, sendResponse) {
  try {
    const result = await chrome.storage.local.get(['videos']);

    const videos = result.videos || [];

    // Prevent duplicates by video id
    if (videos.some(v => v.id === videoData.id)) {
      console.log('[storeVideo] Duplicate video, not adding:', videoData.id);
      sendResponse({ success: true, duplicate: true });
      return;
    }

    // Add video
    videos.push(videoData);

    const todayStats = computeTodayStatsFromVideos(videos);

    await chrome.storage.local.set({ videos, todayStats });

    console.log('[storeVideo] Stored video:', videoData.id);
    sendResponse({ success: true });
  } catch (error) {
    console.error('[storeVideo] Error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// 4) Export data as downloadable JSON
async function handleExportData(sendResponse) {
  try {
    const result = await chrome.storage.local.get(['videos', 'todayStats']);

    const videos = result.videos || [];
    const todayStats = result.todayStats || getDefaultTodayStats();

    const exportData = {
      exportDate: new Date().toISOString(),
      videos,
      todayStats,
      totalVideos: videos.length
    };

    // Create a JSON blob
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);

    // Start the download
    chrome.downloads.download({
      url,
      filename: `watchwise-export-${new Date()
        .toISOString()
        .split('T')[0]}.json`,
      saveAs: true
    });

    console.log('[exportData] Export initiated');
    sendResponse({ success: true });
  } catch (error) {
    console.error('[exportData] Error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ----- Daily Reset Logic -----

// Runs once, sets a timeout to midnight, then reschedules itself
function scheduleDailyReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const timeUntilMidnight = tomorrow.getTime() - now.getTime();

  console.log(
    `[DailyReset] Scheduling next reset in ${Math.round(
      timeUntilMidnight / 1000 / 60
    )} minutes`
  );

  setTimeout(() => {
    resetDailyStats();
    scheduleDailyReset(); // schedule the next one
  }, timeUntilMidnight);
}

// Archives today's stats then zeros them out
async function resetDailyStats() {
  try {
    const result = await chrome.storage.local.get(['todayStats']);
    const todayStats = result.todayStats || getDefaultTodayStats();

    // Archive under yesterday's date key (since reset happens at midnight of next day)
    // e.g. stats-2025-11-17 for stats collected on 2025-11-17
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const archiveKey = `stats-${yesterday.toISOString().split('T')[0]}`;
    await chrome.storage.local.set({ [archiveKey]: todayStats });

    // Reset today's stats only
    await chrome.storage.local.set({
      todayStats: getDefaultTodayStats()
    });

    console.log('[DailyReset] Daily stats archived and reset');
  } catch (error) {
    console.error('[DailyReset] Error resetting stats:', error);
  }
}

// Start the daily reset scheduler as soon as the worker loads
scheduleDailyReset();
