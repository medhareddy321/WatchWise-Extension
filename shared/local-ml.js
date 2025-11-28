/**
 * WatchWise Local ML via ONNX Runtime Web
 *
 * Expected assets:
 *   - Sentiment: models/distilbert-sst2.onnx  (DistilBERT fine-tuned on SST-2)
 *   - Embedding: models/all-minilm-l6-v2.onnx (MiniLM sentence embedding model)
 *   - Vocabulary: models/bert-vocab.json     (WordPiece vocab for DistilBERT/MiniLM)
 *
 * Model placement:
 *   Place all ONNX + vocab files in the extension's /models directory (or update MODEL_PATHS).
 *
 * ONNX Runtime Web:
 *   Include onnxruntime-web as a script tag (e.g., shared/vendor/onnxruntime-web.min.js) so
 *   window.ort is available, OR update `ORT_BUNDLE_PATH` below to dynamically import it as an ES module.
 *
 * Topic classification:
 *   Provide cosine-similarity centroids for each topic inside TOPIC_CENTROIDS (see checklist).
 *   Each centroid array must match the embedding dimension of the MiniLM model (typically 384).
 */

(function initLocalML() {
  const MODEL_PATHS = {
    sentiment: 'models/distilbert-sst2.onnx',
    embedding: 'models/all-minilm-l6-v2.onnx',
    vocab: 'models/bert-vocab.json'
  };

  const ORT_BUNDLE_PATH = 'shared/vendor/onnxruntime-web.min.mjs'; // Change if needed
  const MAX_SEQ_LEN = 256;
  const CLS_TOKEN = '[CLS]';
  const SEP_TOKEN = '[SEP]';
  const UNK_TOKEN = '[UNK]';

  // TODO: replace placeholder zero vectors with real centroids (see checklist)
  const TOPIC_CENTROIDS = {
    music: Array(384).fill(0),
    food: Array(384).fill(0),
    news: Array(384).fill(0),
    entertainment: Array(384).fill(0),
    education: Array(384).fill(0),
    lifestyle: Array(384).fill(0),
    gaming: Array(384).fill(0),
    technology: Array(384).fill(0),
    sports: Array(384).fill(0)
  };

  let ortModulePromise = null;
  let sentimentSessionPromise = null;
  let embeddingSessionPromise = null;
  let vocabPromise = null;
  let cachedTokenizer = null;

  async function getOrt() {
    if (window.ort) return window.ort;
    if (!ortModulePromise) {
      ortModulePromise = import(chrome.runtime.getURL(ORT_BUNDLE_PATH)).then(mod => mod.default || mod);
    }
    const ort = await ortModulePromise;
    if (!window.ort) {
      window.ort = ort;
    }
    return ort;
  }

  async function loadSession(type) {
    if (type === 'sentiment' && sentimentSessionPromise) return sentimentSessionPromise;
    if (type === 'embedding' && embeddingSessionPromise) return embeddingSessionPromise;

    const ort = await getOrt();
    const path = MODEL_PATHS[type];
    if (!path) throw new Error(`No model path configured for ${type}`);

    const sessionPromise = ort.InferenceSession.create(chrome.runtime.getURL(path), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });

    if (type === 'sentiment') {
      sentimentSessionPromise = sessionPromise;
    } else {
      embeddingSessionPromise = sessionPromise;
    }
    return sessionPromise;
  }

  async function loadVocab() {
    if (cachedTokenizer) return cachedTokenizer;
    if (!vocabPromise) {
      vocabPromise = fetch(chrome.runtime.getURL(MODEL_PATHS.vocab))
        .then(res => {
          if (!res.ok) throw new Error(`Failed to load vocab: ${res.status}`);
          return res.json();
        })
        .then(json => buildTokenizer(json));
    }
    cachedTokenizer = await vocabPromise;
    return cachedTokenizer;
  }

  function buildTokenizer(vocabJson) {
    const vocab = {};
    Object.keys(vocabJson).forEach(token => {
      vocab[token] = vocabJson[token];
    });

    const invVocab = Object.entries(vocab).reduce((acc, [token, id]) => {
      acc[id] = token;
      return acc;
    }, {});

    function wordpiece(word) {
      const chars = word.split('');
      const tokens = [];
      let start = 0;
      while (start < chars.length) {
        let end = chars.length;
        let cur = null;
        while (start < end) {
          let substr = chars.slice(start, end).join('');
          if (start > 0) substr = '##' + substr;
          if (vocab[substr] !== undefined) {
            cur = substr;
            break;
          }
          end -= 1;
        }
        if (!cur) {
          tokens.push(UNK_TOKEN);
          start = end = chars.length;
        } else {
          tokens.push(cur);
          start = end;
        }
      }
      return tokens;
    }

    function tokenize(text) {
      const clean = (text || '').toLowerCase().replace(/[^\w\s#@']/g, ' ').trim();
      const words = clean.split(/\s+/).filter(Boolean);
      const tokens = [CLS_TOKEN];
      words.forEach(word => tokens.push(...wordpiece(word)));
      tokens.push(SEP_TOKEN);
      if (tokens.length > MAX_SEQ_LEN) {
        return tokens.slice(0, MAX_SEQ_LEN - 1).concat(SEP_TOKEN);
      }
      return tokens;
    }

    function tokensToIds(tokens) {
      return tokens.map(token => {
        if (vocab[token] !== undefined) return vocab[token];
        return vocab[UNK_TOKEN];
      });
    }

    return {
      vocab,
      invVocab,
      tokenize,
      tokensToIds
    };
  }

  function padArray(arr, length, padValue = 0) {
    if (arr.length > length) return arr.slice(0, length);
    while (arr.length < length) {
      arr.push(padValue);
    }
    return arr;
  }

  function createInputTensors(inputIds) {
    const attention = inputIds.map(id => (id === 0 ? 0 : 1));
    const tokenType = new Array(inputIds.length).fill(0);

    const ids64 = BigInt64Array.from(inputIds.map(id => BigInt(id)));
    const mask64 = BigInt64Array.from(attention.map(v => BigInt(v)));
    const tokenType64 = BigInt64Array.from(tokenType.map(v => BigInt(v)));

    return {
      inputIds: ids64,
      attentionMask: mask64,
      tokenTypeIds: tokenType64
    };
  }

  function softmax(logits) {
    const max = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - max));
    const sum = exps.reduce((acc, v) => acc + v, 0);
    return exps.map(v => v / sum);
  }

  function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return -1;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return -1;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  async function runSentiment(text) {
    const tokenizer = await loadVocab();
    const tokens = tokenizer.tokenize(text).slice(0, MAX_SEQ_LEN);
    const inputIds = padArray(tokenizer.tokensToIds(tokens), MAX_SEQ_LEN, 0);
    const { inputIds: idsTensor, attentionMask, tokenTypeIds } = createInputTensors([...inputIds]);
    const ort = await getOrt();
    const session = await loadSession('sentiment');
    const feeds = {
      input_ids: new ort.Tensor('int64', idsTensor, [1, MAX_SEQ_LEN]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, MAX_SEQ_LEN]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, MAX_SEQ_LEN])
    };
    const results = await session.run(feeds);
    const logits = Array.from(results.logits.data);
    const probs = softmax(logits);
    const [negativeScore, positiveScore] = probs;
    const sentiment = positiveScore >= negativeScore ? 'positive' : 'negative';
    const confidence = Math.max(positiveScore, negativeScore);

    return {
      sentiment,
      sentimentConfidence: Number(confidence.toFixed(4))
    };
  }

  async function runEmbedding(text) {
    const tokenizer = await loadVocab();
    const tokens = tokenizer.tokenize(text).slice(0, MAX_SEQ_LEN);
    const inputIds = padArray(tokenizer.tokensToIds(tokens), MAX_SEQ_LEN, 0);
    const { inputIds: idsTensor, attentionMask, tokenTypeIds } = createInputTensors([...inputIds]);
    const ort = await getOrt();
    const session = await loadSession('embedding');
    const feeds = {
      input_ids: new ort.Tensor('int64', idsTensor, [1, MAX_SEQ_LEN]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, MAX_SEQ_LEN]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, MAX_SEQ_LEN])
    };

    const results = await session.run(feeds);
    const output = results.last_hidden_state || results['output'] || results['sentence_embedding'];
    if (!output) throw new Error('MiniLM ONNX output missing last_hidden_state');
    const data = output.data;
    const hiddenSize = output.dims[2] || 384;
    const embedding = new Array(hiddenSize).fill(0);
    const tokenCount = output.dims[1] || MAX_SEQ_LEN;
    for (let i = 0; i < tokenCount; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        embedding[j] += data[i * hiddenSize + j];
      }
    }
    for (let j = 0; j < hiddenSize; j++) {
      embedding[j] /= tokenCount;
    }
    return embedding;
  }

  function classifyTopic(embedding) {
    const scores = Object.entries(TOPIC_CENTROIDS).map(([topic, centroid]) => {
      const score = cosineSimilarity(embedding, centroid);
      return { topic, score };
    });

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0] || { topic: 'other', score: 0 };
    const alternatives = scores.slice(1, 4).map(item => ({
      topic: item.topic,
      confidence: Number(Math.max(0, item.score).toFixed(3))
    }));

    return {
      topic: best.topic,
      topicConfidence: Number(Math.max(0, best.score).toFixed(3)),
      topicAlternatives: alternatives
    };
  }

  async function analyzeContent(rawText) {
    const text = rawText || '';
    const [sentimentResult, embedding] = await Promise.all([
      runSentiment(text),
      runEmbedding(text)
    ]);

    const topicResult = classifyTopic(embedding);

    return {
      sentiment: sentimentResult.sentiment,
      sentimentConfidence: sentimentResult.sentimentConfidence,
      topic: topicResult.topic,
      topicConfidence: topicResult.topicConfidence,
      topicAlternatives: topicResult.topicAlternatives
    };
  }

  window.localML = {
    analyzeContent
  };
})();
