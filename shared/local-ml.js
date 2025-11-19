// WatchWise Local ML Stub
// TODO: Replace heuristic logic with ONNX Runtime Web inference once models are embedded.
(function initLocalML() {
  const sentimentLexicon = {
    positive: [
      'amazing',
      'awesome',
      'great',
      'love',
      'best',
      'incredible',
      'wonderful',
      'fantastic',
      'excellent',
      'beautiful',
      'happy',
      'excited',
      'success',
      'wins',
      'calm'
    ],
    negative: [
      'terrible',
      'awful',
      'hate',
      'worst',
      'horrible',
      'disgusting',
      'annoying',
      'stupid',
      'bad',
      'sucks',
      'angry',
      'sad',
      'anxious',
      'fear',
      'panic',
      'failure'
    ]
  };

  const topicKeywords = {
    music: [
      'music',
      'song',
      'album',
      'artist',
      'band',
      'concert',
      'lyrics',
      'beat',
      'singer',
      'guitar'
    ],
    food: [
      'food',
      'cook',
      'cooking',
      'recipe',
      'kitchen',
      'chef',
      'restaurant',
      'meal',
      'pizza',
      'burger',
      'pasta'
    ],
    news: [
      'news',
      'breaking',
      'politics',
      'government',
      'election',
      'economy',
      'update',
      'report'
    ],
    entertainment: [
      'funny',
      'comedy',
      'movie',
      'series',
      'tv',
      'celebrity',
      'gossip',
      'trailer',
      'interview'
    ],
    education: [
      'tutorial',
      'learn',
      'lesson',
      'explained',
      'course',
      'study',
      'guide',
      'exam',
      'math',
      'science'
    ],
    lifestyle: [
      'vlog',
      'daily',
      'routine',
      'travel',
      'fashion',
      'beauty',
      'home',
      'minimal',
      'wellness'
    ],
    gaming: [
      'game',
      'gaming',
      'playthrough',
      'walkthrough',
      'livestream',
      'tournament',
      'speedrun',
      'esports',
      'minecraft',
      'fortnite'
    ],
    technology: [
      'tech',
      'software',
      'hardware',
      'coding',
      'programming',
      'ai',
      'robotics',
      'engineering',
      'build',
      'gadget'
    ],
    sports: [
      'sport',
      'soccer',
      'football',
      'basketball',
      'highlights',
      'match',
      'game-winning',
      'athlete',
      'training'
    ]
  };

  function normalizeText(rawText) {
    return (rawText || '')
      .toLowerCase()
      .replace(/[#@]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreSentiment(text) {
    let positiveScore = 0;
    let negativeScore = 0;

    sentimentLexicon.positive.forEach(word => {
      if (text.includes(word)) positiveScore++;
    });

    sentimentLexicon.negative.forEach(word => {
      if (text.includes(word)) negativeScore++;
    });

    if (positiveScore === 0 && negativeScore === 0) {
      return {
        sentiment: 'neutral',
        confidence: 0.45
      };
    }

    if (positiveScore > negativeScore) {
      const confidence = Math.min(0.95, 0.6 + (positiveScore - negativeScore) * 0.05);
      return { sentiment: 'positive', confidence };
    }

    if (negativeScore > positiveScore) {
      const confidence = Math.min(0.95, 0.6 + (negativeScore - positiveScore) * 0.05);
      return { sentiment: 'negative', confidence };
    }

    return { sentiment: 'neutral', confidence: 0.5 };
  }

  function scoreTopics(text) {
    const matches = Object.entries(topicKeywords).map(([topic, keywords]) => {
      const hits = keywords.reduce((count, word) => (text.includes(word) ? count + 1 : count), 0);
      return { topic, hits };
    });

    matches.sort((a, b) => b.hits - a.hits);
    const best = matches[0];

    if (!best || best.hits === 0) {
      return {
        topic: 'other',
        confidence: 0.4,
        alternatives: matches.slice(1, 3).map(item => ({ topic: item.topic, confidence: 0.2 }))
      };
    }

    const confidence = Math.min(0.95, 0.55 + best.hits * 0.1);
    const alternatives = matches
      .slice(1, 4)
      .filter(item => item.hits > 0)
      .map(item => ({
        topic: item.topic,
        confidence: Math.min(0.8, 0.45 + item.hits * 0.08)
      }));

    return {
      topic: best.topic,
      confidence,
      alternatives
    };
  }

  window.localML = {
    /**
     * Analyze a block of text associated with a YouTube video.
     * @param {string} rawText
     * @returns {Promise<{
     *   sentiment: 'negative' | 'neutral' | 'positive',
     *   sentimentConfidence: number,
     *   topic: string,
     *   topicConfidence: number,
     *   topicAlternatives: Array<{ topic: string, confidence: number }>
     * }>}
     */
    async analyzeContent(rawText) {
      const normalized = normalizeText(rawText);

      // Placeholder heuristic logic
      const sentimentResult = scoreSentiment(normalized);
      const topicResult = scoreTopics(normalized);

      return {
        sentiment: sentimentResult.sentiment,
        sentimentConfidence: sentimentResult.confidence,
        topic: topicResult.topic,
        topicConfidence: topicResult.confidence,
        topicAlternatives: topicResult.alternatives
      };
    }
  };
})();
