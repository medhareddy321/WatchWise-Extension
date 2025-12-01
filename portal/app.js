// WatchWise Parent Portal (offline, file-based)

const fileInput = document.getElementById('fileInput');
const demoDataBtn = document.getElementById('demoData');

const todayCountEl = document.getElementById('todayCount');
const todayWatchEl = document.getElementById('todayWatch');
const positiveBarEl = document.getElementById('positiveBar');
const negativeBarEl = document.getElementById('negativeBar');
const positiveCountEl = document.getElementById('positiveCount');
const negativeCountEl = document.getElementById('negativeCount');
const flagsListEl = document.getElementById('flagsList');
const videoListEl = document.getElementById('videoList');
const videoTotalEl = document.getElementById('videoTotal');

fileInput.addEventListener('change', handleFile);
demoDataBtn.addEventListener('click', loadDemo);

function handleFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      renderDashboard(normalizeData(data));
    } catch (err) {
      alert('Could not read file. Make sure it is the WatchWise export JSON.');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function loadDemo() {
  const demo = {
    exportDate: new Date().toISOString(),
    todayStats: {
      count: 6,
      positive: 2,
      negative: 2,
      topics: { education: 2, gaming: 1, music: 1, 'ads or sponsored': 2 }
    },
    videos: [
      { title: 'STEM tutorial', sentiment: 'positive', topic: 'education', watchDurationMs: 180000, timestamp: Date.now() },
      { title: 'Prank compilation', sentiment: 'negative', topic: 'pranks', watchDurationMs: 90000, timestamp: Date.now() },
      { title: 'Fitness tips', sentiment: 'positive', topic: 'fitness', watchDurationMs: 60000, timestamp: Date.now() },
      { title: 'Ad: Mystery product', sentiment: 'neutral', topic: 'ads or sponsored', watchDurationMs: 45000, timestamp: Date.now() },
      { title: 'Late-night challenge', sentiment: 'negative', topic: 'challenges', watchDurationMs: 30000, timestamp: Date.now() },
      { title: 'Music video', sentiment: 'neutral', topic: 'music', watchDurationMs: 20000, timestamp: Date.now() }
    ]
  };
  renderDashboard(normalizeData(demo));
}

function normalizeData(raw) {
  const videos = raw.videos || [];
  const todayStats = raw.todayStats || { count: 0, positive: 0, negative: 0, topics: {} };
  return { videos, todayStats };
}

function renderDashboard({ videos, todayStats }) {
  const today = new Date().toDateString();
  const todayVideos = videos.filter(v => new Date(v.timestamp).toDateString() === today);

  // Count
  todayCountEl.textContent = todayStats.count || todayVideos.length || 0;

  // Watch time
  const todayWatch = todayVideos.reduce((acc, v) => acc + (v.watchDurationMs || 0), 0);
  todayWatchEl.textContent = formatWatchTime(todayWatch);

  // Sentiment
  const posNeg = countBySentiment(todayVideos);
  const pos = todayStats.positive ?? posNeg.positive;
  const neg = todayStats.negative ?? posNeg.negative;
  updateSentiment(pos, neg);

  // Flags (basic: use topic buckets)
  const flagged = aggregateFlags(todayVideos);
  renderFlags(flagged);

  // Recent videos
  renderVideos(todayVideos);
}

function formatWatchTime(ms) {
  const sec = Math.floor((ms || 0) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function countBySentiment(videos) {
  const tally = { positive: 0, negative: 0, neutral: 0 };
  videos.forEach(v => {
    const s = (v.sentiment || 'neutral').toLowerCase();
    if (tally[s] !== undefined) tally[s] += 1;
    else tally.neutral += 1;
  });
  return tally;
}

function updateSentiment(pos, neg) {
  const total = pos + neg;
  const posPct = total > 0 ? (pos / total) * 100 : 50;
  const negPct = total > 0 ? (neg / total) * 100 : 50;
  positiveBarEl.style.width = `${posPct}%`;
  negativeBarEl.style.width = `${negPct}%`;
  positiveCountEl.textContent = pos || 0;
  negativeCountEl.textContent = neg || 0;
}

const FLAG_TOPICS = [
  'violence',
  'sexual content',
  'self-harm',
  'drugs',
  'alcohol',
  'gambling',
  'hate or offensive',
  'conspiracy'
];

function aggregateFlags(videos) {
  const counts = {};
  videos.forEach(v => {
    const topic = (v.topic || '').toLowerCase();
    if (FLAG_TOPICS.includes(topic)) {
      counts[topic] = (counts[topic] || 0) + 1;
    }
  });
  return counts;
}

function renderFlags(flags) {
  const entries = Object.entries(flags).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) {
    flagsListEl.textContent = 'No flagged categories';
    return;
  }
  flagsListEl.innerHTML = entries
    .map(([topic, count]) => `<div class="topic-item"><span>${topic}</span><span>${count}</span></div>`)
    .join('');
}

function renderVideos(videos) {
  videoTotalEl.textContent = `${videos.length} total`;
  if (videos.length === 0) {
    videoListEl.innerHTML = '<div class="muted">No videos for the selected day.</div>';
    return;
  }
  const sorted = [...videos].sort((a, b) => b.timestamp - a.timestamp);
  videoListEl.innerHTML = sorted
    .map(v => {
      const sentiment = (v.sentiment || 'neutral').toLowerCase();
      const topic = v.topic || 'other';
      const dur = formatWatchTime(v.watchDurationMs || 0);
      return `
        <div class="video-item">
          <div class="video-title">${escapeHtml(v.title || 'Untitled')}</div>
          <div class="video-meta">
            <span>${dur}</span>
            <span class="muted">${new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="video-meta">
            <span class="chip ${sentiment === 'positive' ? 'positive' : sentiment === 'negative' ? 'negative' : ''}">${emojiForSentiment(sentiment)} ${sentiment}</span>
            <span class="chip flag">${topic}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function emojiForSentiment(sentiment) {
  if (sentiment === 'positive') return '😊';
  if (sentiment === 'negative') return '😔';
  return '😐';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
