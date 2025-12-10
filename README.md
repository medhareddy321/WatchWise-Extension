# WatchWise Extension

WatchWise is a Chrome extension that keeps YouTube watching mindful. It tracks viewing sessions (including Shorts), analyzes content sentiment/topic/emotion, nudges against doomscrolling, and lets parents monitor/override labels in a live portal backed by Firestore.

## What’s inside
- `manifest.json` — MV3 manifest wiring content/background/popup/dashboard/portal.
- `content/simple-monitor.js` — YouTube/Shorts tracker with watch-time, hashtag/captions scraping, autoplay detection, nudges.
- `shared/ml-service.js` — Hugging Face inference client with caching, safety and topic labels.
- `shared/local-ml.js` — Lightweight heuristics fallback for offline/basic sentiment.
- `background/simple-worker.js` — Service worker proxy for Hugging Face fetches and storage of analyzed videos.
- `popup/` — In-browser quick dashboard to set API key and view recent analysis.
- `dashboard/` — Web-accessible dashboard UI for in-extension analytics.
- `portal/` — Parent portal (separate web UI) with real-time Firestore sync, Google auth, manual overrides, watch-limit reminder.
- `assets/` — Icons/brand assets; `models/` — placeholder for optional local models.

## Setup & run
1) Prereqs: Chrome (MV3 capable). If using Hugging Face: personal token. If using the parent portal’s live sync: Firebase project credentials.
2) Load the extension:
   - Open Chrome → `chrome://extensions` → toggle **Developer mode** → **Load unpacked** → select this repo root.
3) Configure Hugging Face API key (optional but recommended):
   - Click the extension icon → “API key” field → paste token → Save.
4) Use the popup or dashboard to view analyzed videos while browsing YouTube.
5) Parent portal (local file hosting works): open `portal/index.html` in a browser.
   - Update Firebase config in `portal/app.js` (current demo project `watchwise-parent` is wired).
   - Click “Sign in with Google”, then keep the page open to receive Firestore updates.

## Open-source code & assets used
- Firebase JS SDK v10.12.3 (Auth, Firestore) via `https://www.gstatic.com/firebasejs/...`.
- Hugging Face Inference API via `https://router.huggingface.co/hf-inference/models` with models:
  - `cardiffnlp/twitter-roberta-base-sentiment-latest` (sentiment)
  - `j-hartmann/emotion-english-distilroberta-base` (emotion)
  - `facebook/bart-large-mnli` (topic/flag classification)
- Google Fonts: Poppins.

## Changes made (vs. a minimal starter)
- Built unified YouTube/Shorts monitor that extracts titles/descriptions/hashtags/captions, tracks real watch-time, and detects SPA navigation (`content/simple-monitor.js`).
- Added ML pipeline with caching, retries, and safety/topic vocab plus local heuristics fallback (`shared/ml-service.js`, `shared/local-ml.js`).
- Implemented background service worker to proxy HF requests and store analyzed videos (`background/simple-worker.js`).
- Designed popup and dashboard UIs to surface sentiment/topic/emotion labels and recent sessions (`popup/*`, `dashboard/*`).
- Created parent portal with Firebase live sync, Google auth, manual label overrides, and watch-limit reminder (`portal/*`).

## New code implemented (high level)
- Realtime parent portal UI + Firestore sync and override flow (`portal/app.js`, `portal/index.html`, `portal/style.css`).
- ML integration and caching layer + remote fetch proxy (`shared/ml-service.js`, `background/simple-worker.js`).
- YouTube/Shorts tracker with captions/hashtag parsing and nudge logic (`content/simple-monitor.js`).
- Pop-up and web dashboards for quick inspection of analyzed videos (`popup/*`, `dashboard/*`).

## Run & test notes
- No build step; all assets are plain JS/CSS/HTML.
- Data is stored via `chrome.storage` (extension) and Firestore (portal). Hugging Face requires your API key.

