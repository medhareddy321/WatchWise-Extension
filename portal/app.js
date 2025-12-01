// WatchWise Parent Portal (live Firestore sync)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

const todayCountEl = document.getElementById('todayCount');
const todayWatchEl = document.getElementById('todayWatch');
const positiveBarEl = document.getElementById('positiveBar');
const negativeBarEl = document.getElementById('negativeBar');
const positiveCountEl = document.getElementById('positiveCount');
const negativeCountEl = document.getElementById('negativeCount');
const flagsListEl = document.getElementById('flagsList');
const videoListEl = document.getElementById('videoList');
const videoTotalEl = document.getElementById('videoTotal');
const syncStatusEl = document.getElementById('syncStatus');
const syncBadgeEl = document.getElementById('syncBadge');
const badgeNoteEl = document.getElementById('badgeNote');
const badgeSecondaryEl = document.getElementById('badgeSecondary');
const authCard = document.getElementById('authCard');
const googleBtn = document.getElementById('googleBtn');
const authStatus = document.getElementById('authStatus');
const signOutBtn = document.getElementById('signOutBtn');
const watchLimitInput = document.getElementById('watchLimit');
const watchLimitStatus = document.getElementById('watchLimitStatus');
const saveWatchLimitBtn = document.getElementById('saveWatchLimit');
const watchReminder = document.getElementById('watchReminder');
const categoryStatsEl = document.getElementById('categoryStats');
const emotionStatsEl = document.getElementById('emotionStats');

// Firebase config (live)
const firebaseConfig = {
  apiKey: 'AIzaSyDVCTf_XrPhtF-x9J1InFHtI0mRceNN3Js',
  authDomain: 'watchwise-parent.firebaseapp.com',
  projectId: 'watchwise-parent',
  storageBucket: 'watchwise-parent.firebasestorage.app',
  messagingSenderId: '619612994480',
  appId: '1:619612994480:web:537bed0efb38b05682b475',
  measurementId: 'G-E2KEDGWTF6'
};
const CHILD_ID = 'child-1';

let unsubscribeSnapshot = null;
let app;
let db;
let auth;
let childDocRef;
let currentData = { videos: [], todayStats: {} };
let watchLimitMinutes = Number(localStorage.getItem('ww_watch_limit')) || '';

init();

function init() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('YOUR_')) {
    setStatus('Awaiting config', 'Add Firebase config in portal/app.js to begin.');
    return;
  }
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  childDocRef = doc(db, 'children', CHILD_ID);

  if (watchLimitMinutes) {
    watchLimitInput.value = watchLimitMinutes;
  }

  googleBtn.addEventListener('click', handleGoogleLogin);
  signOutBtn.addEventListener('click', handleSignOut);
  saveWatchLimitBtn.addEventListener('click', saveWatchLimit);
  videoListEl.addEventListener('click', handleOverrideClick);

  onAuthStateChanged(auth, user => {
    if (user) {
      authStatus.textContent = `Signed in as ${user.email}`;
      authCard.style.display = 'none';
      startRealtime();
    } else {
      authStatus.textContent = 'Sign in to view the dashboard.';
      authCard.style.display = 'block';
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      renderDashboard({ videos: [], todayStats: {} });
    }
  });
}

function startRealtime() {
  if (!db || !childDocRef) return;
  try {
    setStatus('Connecting…', `Listening for children/${CHILD_ID}`);

    unsubscribeSnapshot = onSnapshot(
      childDocRef,
      snapshot => {
        if (!snapshot.exists()) {
          setStatus('Waiting', `No document yet for children/${CHILD_ID}`);
          return;
        }

        try {
          const raw = snapshot.data();
          const payload = raw?.data;
          const parsed =
            typeof payload === 'string'
              ? JSON.parse(payload)
              : payload || { todayStats: {}, videos: [] };

          currentData = parsed;
          applyExportData(parsed);
          setStatus('Live', `Last updated ${new Date().toLocaleTimeString()}`);
        } catch (err) {
          console.error('[Portal] Failed to parse snapshot', err);
          setStatus('Error', 'Bad data format in Firestore.');
        }
      },
      err => {
        console.error('[Portal] Snapshot error', err);
        setStatus('Error', 'Check API key / rules / network.');
        scheduleRetry();
      }
    );
  } catch (err) {
    console.error('[Portal] Failed to init Firebase', err);
    setStatus('Error', 'Firebase init failed.');
    scheduleRetry();
  }
}

function scheduleRetry() {
  setTimeout(() => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    startRealtime();
  }, 5000);
}

function setStatus(stateText, noteText) {
  if (syncStatusEl) syncStatusEl.textContent = stateText;
  if (syncBadgeEl) syncBadgeEl.textContent = stateText;
  if (badgeNoteEl) badgeNoteEl.textContent = noteText || '';
  if (badgeSecondaryEl) badgeSecondaryEl.textContent = 'Powered by Firestore real-time updates.';
}

function applyExportData(data) {
  renderDashboard(normalizeData(data));
}

function normalizeData(raw) {
  const videos = raw?.videos || [];
  const todayStats = raw?.todayStats || { count: 0, positive: 0, negative: 0, topics: {} };
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
  maybeShowWatchReminder(todayWatch);

  // Sentiment
  const posNeg = countBySentiment(todayVideos);
  const pos = todayStats.positive ?? posNeg.positive;
  const neg = todayStats.negative ?? posNeg.negative;
  updateSentiment(pos, neg);

  // Flags (basic: use topic buckets)
  const flagged = aggregateFlags(todayVideos);
  renderFlags(flagged);

  renderCategories(todayVideos);
  renderEmotions(todayVideos);

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
  'graphic violence',
  'sexual content',
  'pornography',
  'nsfw',
  'adult themes',
  'self-harm',
  'suicide',
  'drugs',
  'alcohol',
  'gambling',
  'hate or offensive',
  'hate speech',
  'weapons',
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
  flagsListEl.innerHTML = `
    <div class="stat-grid">
      ${entries
        .map(
          ([topic, count]) =>
            `<div class="stat-pill"><span>${escapeHtml(topic)}</span><span class="count">${count}</span></div>`
        )
        .join('')}
    </div>
  `;
}

function renderCategories(videos) {
  const counts = {};
  videos.forEach(v => {
    const t = (v.topic || 'other').toLowerCase();
    counts[t] = (counts[t] || 0) + 1;
  });
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) {
    categoryStatsEl.textContent = 'No data yet';
    return;
  }
  categoryStatsEl.innerHTML = `
    <div class="stat-grid">
      ${entries
        .map(
          ([topic, count]) =>
            `<div class="stat-pill"><span>${escapeHtml(topic)}</span><span class="count">${count}</span></div>`
        )
        .join('')}
    </div>
  `;
}

function renderEmotions(videos) {
  const counts = {};
  videos.forEach(v => {
    const e = (v.emotion || 'neutral').toLowerCase();
    counts[e] = (counts[e] || 0) + 1;
  });
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) {
    emotionStatsEl.textContent = 'No data yet';
    return;
  }
  emotionStatsEl.innerHTML = `
    <div class="stat-grid">
      ${entries
        .map(
          ([emo, count]) =>
            `<div class="stat-pill"><span>${escapeHtml(emo)}</span><span class="count">${count}</span></div>`
        )
        .join('')}
    </div>
  `;
}

function maybeShowWatchReminder(ms) {
  if (!watchLimitMinutes) {
    watchReminder.style.display = 'none';
    return;
  }
  const limitMs = watchLimitMinutes * 60 * 1000;
  watchReminder.style.display = ms >= limitMs ? 'block' : 'none';
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
      const emotion = (v.emotion || 'neutral').toLowerCase();
      return `
        <div class="video-item" data-video-id="${escapeHtml(v.id)}">
          <div class="video-title">${escapeHtml(v.title || 'Untitled')}</div>
          <div class="video-meta">
            <span>${dur}</span>
            <span class="muted">${new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="video-meta">
            <span class="chip ${sentiment === 'positive' ? 'positive' : sentiment === 'negative' ? 'negative' : ''}">${emojiForSentiment(sentiment)} ${sentiment}</span>
            <span class="chip flag">${topic}</span>
            <span class="chip emotion">${emotion}</span>
            <button class="ghost override-btn" data-video-id="${escapeHtml(v.id)}">Override</button>
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

function recomputeTodayStats(videos) {
  const today = new Date().toDateString();
  const todayVideos = videos.filter(v => new Date(v.timestamp).toDateString() === today);
  const stats = { count: 0, positive: 0, negative: 0, topics: {} };
  todayVideos.forEach(v => {
    stats.count += 1;
    const s = (v.sentiment || 'neutral').toLowerCase();
    if (s === 'positive') stats.positive += 1;
    if (s === 'negative') stats.negative += 1;
    const t = (v.topic || 'other').toLowerCase();
    stats.topics[t] = (stats.topics[t] || 0) + 1;
  });
  return stats;
}

async function handleOverrideClick(event) {
  const btn = event.target.closest('.override-btn');
  if (!btn) return;
  const videoId = btn.dataset.videoId;
  const video = currentData.videos.find(v => v.id === videoId);
  if (!video) return;

  const newSentiment = prompt('Set sentiment (positive/neutral/negative):', video.sentiment || 'neutral');
  if (!newSentiment) return;
  const newTopic = prompt('Set topic (e.g., education, gaming, food, nsfw, other):', video.topic || 'other') || 'other';
  const newEmotion = prompt('Set emotion (joy, fear, anger, sadness, disgust, surprise, neutral):', video.emotion || 'neutral') || 'neutral';

  video.sentiment = newSentiment.toLowerCase();
  video.topic = newTopic.toLowerCase();
  video.emotion = newEmotion.toLowerCase();

  currentData.todayStats = recomputeTodayStats(currentData.videos);
  await saveDataToFirestore();
  applyExportData(currentData);
}

async function saveDataToFirestore() {
  if (!childDocRef) return;
  const payload = { ...currentData };
  await setDoc(childDocRef, { data: JSON.stringify(payload) }, { merge: true });
}

function handleLogin() {
  // unused (email login removed)
}

function handleGoogleLogin() {
  if (!auth) return;
  const provider = new GoogleAuthProvider();
  signInWithPopup(auth, provider)
    .then(result => {
      authStatus.textContent = `Logged in as ${result.user.email}`;
    })
    .catch(err => {
      authStatus.textContent = err.message;
    });
}

function handleSignOut() {
  if (!auth) return;
  signOut(auth).catch(err => (authStatus.textContent = err.message));
}

function saveWatchLimit() {
  const val = Number(watchLimitInput.value);
  if (!val || val <= 0) {
    watchLimitStatus.textContent = 'Enter minutes > 0';
    return;
  }
  watchLimitMinutes = val;
  localStorage.setItem('ww_watch_limit', String(val));
  watchLimitStatus.textContent = `Saved (${val} minutes)`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
