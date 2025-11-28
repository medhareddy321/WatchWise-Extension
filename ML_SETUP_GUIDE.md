# WatchWise ML Setup Guide

This guide captures where the ML stack stands right now, how to enable the Hugging Face powered classifiers we ship today, and how we will transition to on-device BERT/MiniLM.

## 1. Stack Overview

WatchWise deliberately layers three analysis tiers so the extension keeps functioning even when optional models are unavailable:

1. **Keyword heuristics (always on)** – `content/simple-monitor.js` uses curated positive/negative lexicons plus topic keywords to classify every video or Short. This path requires no setup.
2. **Cloud transformers via Hugging Face (current advanced path)** – Once a user saves an API key in the popup, `shared/ml-service.js` calls hosted transformers for sentiment, topic, and emotion. This is the most accurate option we ship today.
3. **Local BERT via ONNX Runtime Web (in progress)** – `shared/local-ml.js` already wires up DistilBERT + MiniLM for offline inference. Bundling the ONNX/vocab assets and non-zero topic centroids is the remaining blocker before we can make this the default.

The content monitor prefers local BERT when `window.localML` is ready, otherwise calls into the Hugging Face client, and finally falls back to heuristics.

---

## 2. Current Cloud Models (Hugging Face)

When Hugging Face mode is enabled we send only the concatenated `title + description + hashtags` to the API. The following models are configured in `shared/ml-service.js`:

| Task | Model | Training Background | Output |
| --- | --- | --- | --- |
| Sentiment | `cardiffnlp/twitter-roberta-base-sentiment-latest` | RoBERTa-base continually fine-tuned on millions of English tweets (3-way labels). | `negative`, `neutral`, `positive` + confidence |
| Topics | `facebook/bart-large-mnli` | BART trained on MultiNLI; used for zero-shot scoring against curated labels (music, news, gaming, etc.). | Top topic + ranked alternatives |
| Emotions | `j-hartmann/emotion-english-distilroberta-base` | DistilRoBERTa fine-tuned on GoEmotions (joy, anger, fear, sadness …). | Dominant emotion + distribution |

`shared/ml-service.js` caches responses per `(model, text)` for 24 hours, so doomscrolling through Shorts will not always hit the API. For every request we include `options.wait_for_model = true` so cold starts resolve before we store results.

### Inefficiencies We See Today

1. **Latency** – Every classification costs a network round-trip; Shorts swipes can outrun the response.
2. **Rate limits** – Free Hugging Face tokens throttle under heavy usage, and paid tiers add recurring cost.
3. **Reliability** – Offline usage, expired tokens, or HF outages push us back to heuristics.
4. **Privacy** – Even though we send only text, privacy-focused users want a zero-network option.

These pain points are exactly why we are investing in the on-device BERT stack.

### Enabling Hugging Face in the Extension

1. Visit [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) and create a READ token (name it “WatchWise”).
2. Open the WatchWise popup → **🤖 AI Settings** → paste the key → **Save API Key**.
3. The key is stored in `chrome.storage.local.huggingFaceApiKey`. `shared/ml-service.js` loads it automatically and begins servicing requests—no extension reload required.
4. The popup status changes to `🤖 AI: On`, confirming we will call Hugging Face for new sessions.

To disable cloud ML, clear the key and save; the popup will flip to `🤖 AI: Off` and the monitor immediately falls back to heuristics (or local BERT once packaged).

---

## 3. Why BERT/DistilBERT/MiniLM

- **BERT** builds contextual embeddings by reading text left-to-right and right-to-left simultaneously, so it understands phrasings such as “debunking this conspiracy” vs “this conspiracy is scary”.
- **DistilBERT** distills BERT into a lighter, faster network while retaining ~97% of the accuracy. We export the SST-2 fine-tuned DistilBERT model (`distilbert-sst2.onnx`) for binary sentiment.
- **MiniLM (`all-minilm-l6-v2`)** produces 384-dimensional sentence embeddings. By comparing embeddings to topic centroids we can classify topics locally without a zero-shot API call.

Moving to this stack gives us offline operation, lower latency, better privacy, and zero recurring inference costs.

---

## 4. Local BERT Implementation Status

`shared/local-ml.js` already contains the glue necessary for a full on-device pipeline:

1. **Runtime** – Dynamically imports `shared/vendor/onnxruntime-web.min.mjs` (WASM backend) and caches separate sessions for sentiment and embeddings.
2. **Tokenizer** – Implements a WordPiece tokenizer backed by `models/bert-vocab.json`, adds `[CLS]`/`[SEP]`, and pads/truncates to 256 tokens.
3. **Sentiment path** – Runs DistilBERT (`distilbert-sst2.onnx`), applies softmax to logits, and returns `sentiment` + `sentimentConfidence`.
4. **Topic path** – Runs MiniLM (`all-minilm-l6-v2.onnx`), average-pools hidden states to build a sentence embedding, then computes cosine similarity vs `TOPIC_CENTROIDS` to produce `topic`, `topicConfidence`, and up to three alternatives.
5. **API surface** – Exposes `window.localML.analyzeContent(rawText)` so the content monitor can switch tiers without code changes.

### Remaining Work Before GA

- Bundle `distilbert-sst2.onnx`, `all-minilm-l6-v2.onnx`, `bert-vocab.json`, and the ORT bundle under `/models` and list them in `web_accessible_resources`.
- Replace the zero-filled `TOPIC_CENTROIDS` with averaged embeddings from labeled exemplars per topic.
- Add popup/dashboard toggles so users can pick **Local only / Cloud only / Auto** once both tiers are stable.
- Performance test on low-end devices to ensure WASM inference stays under our latency budget.

---

## 5. Classification Flow Recap

1. `content/simple-monitor.js` builds `rawText = title + description + hashtags` for every completed session.
2. If the ONNX assets are present, `window.localML.analyzeContent(rawText)` runs locally.
3. Otherwise, `ml-service.analyzeContent(rawText)` calls Hugging Face using the stored token.
4. If both fail (e.g., no token + missing assets), heuristics provide best-effort sentiment/topic labels.
5. The final analysis plus `watchDurationMs` are stored alongside each record in `chrome.storage.local.videos` for the popup/dashboard to consume.

---

## 6. Quick Reference

- **Key files**: `content/simple-monitor.js`, `shared/ml-service.js`, `shared/local-ml.js`, `popup/simple-popup.js`, `background/simple-worker.js`.
- **Storage keys**: `videos`, `todayStats`, `huggingFaceApiKey`, archived `stats-YYYY-MM-DD` for historical stats.
- **Content script order**: `shared/local-ml.js` loads before `simple-monitor.js` so `window.localML` can attach in time.
- **Error debugging**: Use the WatchWise background service worker console (`chrome://extensions`) to inspect Hugging Face call failures or ONNX load issues.

Once the remaining ONNX packaging and centroid calibration work lands, the Hugging Face path becomes optional backup instead of the daily driver.
