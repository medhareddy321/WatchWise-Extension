WatchWise: YouTube Mindful-Viewing Companion
Technical Report — Updated (Nov 2025)

Version: 1.1.1
Project Type: Chrome Extension (Manifest V3)
Domain: Human–AI Interaction, Digital Wellness, Privacy-Preserving Analytics

---

## 1. Executive Summary

WatchWise instruments YouTube (including Shorts) to help people understand and reshape their viewing habits. The extension now:

- Tracks every watch session with real watch time (pause/resume aware) and deduplicated metadata per video.
- Classifies each session with tiered ML (heuristics → Hugging Face transformers → on-device BERT/MiniLM once assets ship).
- Provides live stats in the popup plus a richer dashboard for historical review, export, and data clearing.
- Keeps all records in `chrome.storage.local` so no viewing history leaves the device unless the user opts into Hugging Face inference.

The Hugging Face path is the **currently deployed advanced classifier**. The BERT/ONNX pipeline is implemented in code but still waiting on bundled models and topic centroids before we can flip the default.

---

## 2. System Overview

### 2.1 Manifest & Permissions
- `manifest_version`: 3 with a service worker (`background/simple-worker.js`) and a single YouTube content script (`content/simple-monitor.js`).
- Permissions: `storage`, `activeTab`, and `https://www.youtube.com/*`.
- No access to history, cookies, identity APIs, or other origins.  
- Popup: `popup/popup.html` backed by `popup/simple-popup.js`.  
- Dashboard: `dashboard/index.html` exposed through `web_accessible_resources`.

### 2.2 Component Map
| Component | Source | Responsibilities |
| --- | --- | --- |
| Content monitor | `content/simple-monitor.js` | DOM scraping, watch-time tracking, heuristics/local ML invocation, nudges, message dispatch |
| Service worker | `background/simple-worker.js` | Storage initialization, dedupe, stats aggregation, export + daily rollover |
| ML modules | `shared/ml-service.js`, `shared/local-ml.js` | Hugging Face client + caching, ONNX Runtime Web wrapper |
| Surfaces | `popup/simple-popup.js`, `dashboard/dashboard.js` | At-a-glance stats, API-key management, historical reporting, export/clear controls |

---

## 3. Content Monitoring (content/simple-monitor.js)

1. **Activation & Environment Guards**
   - Runs on `www.youtube.com` and `m.youtube.com` only after verifying `chrome.storage.local` works and loading the `isTracking` toggle.

2. **Video Detection**
   - Extracts IDs from `watch?v=`, `/shorts/`, and `youtu.be` URLs.
   - Handles SPA navigation/swipes via a URL poller (1 second) plus `checkVideoAfterUrlChange` retries (up to 8 attempts) so Shorts DOM lag doesn’t drop events.

3. **Metadata Extraction**
   - Multiple title selectors for long-form videos, plus a Short-specific header/description sweep with fallback to the document title.
   - `filterOutSoundtrack` removes auto-added music credits before sentiment/topic analysis.
   - Hashtag harvesting across description, metadata, and Shorts overlays via `collectHashtagsFromContainers`.
   - Uses `snapshotVideoInfo` to clone metadata before DOM mutates.

4. **Watch-Time Instrumentation**
   - Tracks `watchStartTime`, `totalWatchTime`, and pause state for the active `<video>` element.
   - Stores a session if `watchDurationMs ≥ 1000` ms to avoid accidental scrolls.
   - Flushes progress on URL change, `pagehide`, and `visibilitychange`; also runs periodic flushes every 15 seconds.

5. **ML Handoff**
   - Builds `rawText = title + description + hashtags`.
   - Calls `window.localML.analyzeContent` when the ONNX bundle is loaded; otherwise falls back to heuristic sentiment/topic classifiers embedded in the monitor.
   - The resulting payload includes `sentiment`, `topic`, `topicConfidence`, `sentimentConfidence`, `topicAlternatives`, and the captured `watchDurationMs`.

6. **Nudges & UX**
   - After every successful `storeVideo`, checks `todayStats.negative` and spawns a lightweight DOM notification every third negative video encouraging a break.

7. **Messaging**
   - Sends `{ action: 'storeVideo' }` for each completed session and relies on the service worker for dedupe/stat updates.

---

## 4. Background Service (background/simple-worker.js)

1. **Storage Contract**
   ```json
   {
     "isTracking": true,
     "todayStats": { "count": 0, "positive": 0, "negative": 0, "topics": {} },
     "videos": []
   }
   ```
   - `computeTodayStatsFromVideos` recomputes daily stats from scratch whenever videos are mutated to stay resilient to manual edits.

2. **Message API**
   - `getStats`: Returns live `todayStats`, total video count, and tracking toggle.
   - `storeVideo`: Deduplicates by video ID, appends new sessions, and persists `todayStats`.
   - `clearData`: Wipes storage and re-seeds defaults.
   - `exportData`: Uses `chrome.downloads.download` to export `videos` + `todayStats` as JSON.

3. **Lifecycle Hooks**
   - `chrome.runtime.onInstalled` ensures storage is initialized exactly once.
   - `scheduleDailyReset` calculates the next midnight, archives `todayStats` under `stats-YYYY-MM-DD`, and resets counters without touching historical `videos`.

4. **Reliability Considerations**
   - Errors are logged per action for easier debugging via `chrome://extensions`.
   - Duplicate writes short-circuit, so replays from the content script are safe.

---

## 5. User Surfaces

### 5.1 Popup (`popup/simple-popup.js`)
- Shows today’s watch count and a dual sentiment progress bar.
- Displays tracking status (`🟢 Tracking Active`) and AI state (`🤖 AI: On/Off`).
- Launches the dashboard in a new tab and provides an “AI Settings” drawer where users can paste or clear their Hugging Face API key (stored at `chrome.storage.local.huggingFaceApiKey`).

### 5.2 Dashboard (`dashboard/dashboard.js`)
- Loads `videos` + `todayStats` from storage, recomputes stats client-side, and visualizes:
  - Total videos today, lifetime watch time, and today’s watch time (friendly `Xd Yh Zm` formatting).
  - Sentiment distribution with emoji counts.
  - Top topics list and today’s recent videos (title truncation, watch time, sentiment/topic emojis).
- Offers `Refresh`, `Export`, and `Clear data` actions. Clearing reinitializes storage to the default contract.
- Uses inline notifications for feedback and ensures the UI remains responsive on narrow viewports.

---

## 6. ML Pipeline

### 6.1 Tier 1 — Keyword Heuristics (Default Fallback)
- Always available and runs instantly inside `simple-monitor.js`.
- Uses curated positive/negative word lists plus topic keywords (music, food, news, gaming, etc.).
- Guarantees that classifications exist even without network or models, though accuracy is limited.

### 6.2 Tier 2 — Hugging Face Transformers (Current Advanced Path)
- Live today via `shared/ml-service.js` once the user enters an API key.
- Models:
  - **Sentiment**: `cardiffnlp/twitter-roberta-base-sentiment-latest` — RoBERTa-base trained on millions of English tweets (negative/neutral/positive).
  - **Topics**: `facebook/bart-large-mnli` — MultiNLI-trained BART used for zero-shot topic classification with a curated candidate label list (music, news, education, gaming, etc.).
  - **Emotion**: `j-hartmann/emotion-english-distilroberta-base` — DistilRoBERTa fine-tuned on GoEmotions for joy, anger, fear, sadness, and related states.
- Caching: Responses are cached per `(model, text)` for 24 hours to reduce quota usage.
- Known inefficiencies:
  - Latency per classification (network round-trips).
  - Rate limits and quotas on free Hugging Face tokens.
  - Dependency on third-party availability and user-provided credentials.
  - Text leaves the device, which some users dislike even though no identifiers are sent.

### 6.3 Tier 3 — Local BERT via ONNX Runtime Web (In Progress)
- `shared/local-ml.js` ships:
  - Dynamic import of `shared/vendor/onnxruntime-web.min.mjs` for WASM inference.
  - DistilBERT sentiment model (`distilbert-sst2.onnx`) expecting SST-2 style binary outputs.
  - MiniLM embedding model (`all-minilm-l6-v2.onnx`) used to compute sentence embeddings.
  - WordPiece tokenizer backed by `models/bert-vocab.json`.
  - Topic classifier scaffolding based on cosine similarity against `TOPIC_CENTROIDS` (currently zero placeholders).
- Missing pieces before GA:
  - Bundle ONNX + vocab artifacts under `/models` and expose them through `web_accessible_resources`.
  - Populate `TOPIC_CENTROIDS` with real embeddings derived from labeled samples.
  - Finalize popup toggles to choose between local vs. cloud inference.
  - Performance/latency testing on low-power devices.

---

## 7. Privacy & Security

- Data never leaves the browser unless the user opts into Hugging Face calls.
- Storage footprint:
  - `chrome.storage.local.videos` — Array of session objects (title, url, watchDurationMs, sentiment/topic data, timestamp).
  - `chrome.storage.local.todayStats` — Daily aggregate counters.
  - `chrome.storage.local.huggingFaceApiKey` — Optional user-supplied token.
- No background page keeps cookies, account identifiers, or YouTube auth scopes.
- Users can clear all data or export it at any time through UI controls; exports are JSON blobs downloaded locally.

---

## 8. Current Workstreams & Backlog

1. **Ship local BERT assets** — Package ONNX models + vocab, hook them into the build, and confirm `simple-monitor.js` prefers the local path when files exist.
2. **Topic centroid calibration** — Create labeled prompts per topic, embed with MiniLM, and bake them into `TOPIC_CENTROIDS`.
3. **AI mode controls** — Expose toggles in the popup/dashboard so users can force heuristic/local/cloud modes and view which tier handled each classification.
4. **Focus/Wellness features** — Explore topic blocking or “focus mode” plus weekly summaries built on the stored `videos`.
5. **Better error surfacing** — Surface ML/monitor failures in the popup (not just DevTools logs) so users know when heuristics are in effect.

WatchWise already delivers end-to-end mindful viewing analytics with Hugging Face as the advanced classifier. The remaining engineering focus is landing the on-device DistilBERT/MiniLM stack and adding richer wellness workflows on top of the existing monitors and storage infrastructure.
