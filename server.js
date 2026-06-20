require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

const axiosInstance = axios.create({
  timeout: 15000,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000
  }),
  httpsAgent: new (require('https').Agent)({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000
  })
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS === '*') ? '*' : (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*');

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

app.use(express.json());

app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    console.error(`Request timeout: ${req.method} ${req.url}`);
    !res.headersSent && res.status(504).json({ error: 'Gateway timeout' });
  });
  next();
});

let openai = null;
process.env.OPENAI_API_KEY && (openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

const SHOPIFY_STORE_URL = `https://${process.env.SHOPIFY_SHOP_DOMAIN}.myshopify.com`;

const INTENT_MAPPING = {
  sleep: {
    keywords: ['sleep', 'insomnia', 'schlaf', 'rest', 'night', 'bedtime', 'schlafen', 'nacht'],
    searchTerms: ['schlaf', 'sleep', 'vata nacht', 'einschlafen']
  },
  digestion: {
    keywords: ['digestion', 'stomach', 'verdauung', 'gut', 'bloating', 'recipe', 'rezept', 'food', 'essen', 'magen'],
    searchTerms: ['verdauung', 'digestion', 'magen', 'pitta']
  },
  stress: {
    keywords: ['stress', 'calm', 'entspannung', 'anxiety', 'relax', 'ruhe', 'beruhigung'],
    searchTerms: ['stress', 'entspannung', 'relax', 'ashwagandha']
  },
  energy: {
    keywords: ['energy', 'tired', 'fatigue', 'müde', 'vitality', 'energie', 'müdigkeit'],
    searchTerms: ['energie', 'energy', 'vitality', 'kapha']
  },
  immunity: {
    keywords: ['immune', 'immunity', 'immun', 'defense', 'abwehr', 'immunsystem'],
    searchTerms: ['immun', 'immunity', 'abwehr', 'amrit']
  },
  skin: {
    keywords: ['skin', 'haut', 'acne', 'dermatitis', 'hautpflege'],
    searchTerms: ['haut', 'skin', 'hautpflege']
  },
  joints: {
    keywords: ['joint', 'gelenk', 'arthritis', 'pain', 'schmerz', 'gelenke'],
    searchTerms: ['gelenk', 'joint', 'schmerz']
  },
  weight: {
    keywords: ['weight', 'gewicht', 'diet', 'metabolism', 'abnehmen', 'diät'],
    searchTerms: ['gewicht', 'weight', 'abnehmen', 'kapha']
  },
  heart: {
    keywords: ['heart', 'herz', 'cardio', 'blood pressure', 'blutdruck'],
    searchTerms: ['herz', 'heart', 'blutdruck']
  }
};

function extractIntentFromKeywords(query) {
  const lowerQuery = query.toLowerCase();
  return Object.entries(INTENT_MAPPING).reduce((found, [intent, config]) => {
    return found || (config.keywords.find(keyword => lowerQuery.includes(keyword))
      ? { intent, keywords: [config.keywords.find(keyword => lowerQuery.includes(keyword))], language: detectLanguage(query) }
      : null);
  }, null);
}

function detectLanguage(query) {
  const germanIndicators = ['was', 'welche', 'wie', 'der', 'die', 'das', 'für', 'ich', 'mein', 'haben', 'kann', 'hilfe'];
  const lowerQuery = query.toLowerCase();
  return germanIndicators.some(word => lowerQuery.includes(word)) ? 'de' : 'en';
}

async function extractIntentWithAI(query) {
  return openai
    ? (async () => {
        try {
          const intents = Object.keys(INTENT_MAPPING).join(', ');
          const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: `You are a search intent classifier for an Ayurveda health products store. Classify the user's query into one of these intents: ${intents}. Return JSON with keys: intent, keywords (array), language (en or de).`
              },
              { role: 'user', content: query }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
          });
          const result = JSON.parse(response.choices[0].message.content);
          return INTENT_MAPPING[result.intent] ? result : extractIntentFromKeywords(query);
        } catch (error) {
          console.error('AI intent extraction failed:', error.message);
          return extractIntentFromKeywords(query);
        }
      })()
    : extractIntentFromKeywords(query);
}

function fetchSuggestResults(term) {
  const url = `${SHOPIFY_STORE_URL}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product,article,page,collection&resources[limit]=10`;
  console.log(`Fetching suggest results for term: ${term}`);
  return axiosInstance.get(url, {
    headers: { 'Accept': 'application/json' }
  }).then(response => {
    console.log(`Successfully fetched results for term: ${term}`);
    return response.data?.resources?.results || {};
  }).catch(error => {
    console.error(`Error fetching results for term ${term}:`, error.message);
    return {};
  });
}

async function searchShopifyPublic(searchTerms) {
  const seenProducts = new Set();
  const seenArticles = new Set();
  const seenPages = new Set();
  const seenCollections = new Set();
  const allProducts = [];
  const allArticles = [];
  const allPages = [];
  const allCollections = [];

  const limitedTerms = searchTerms.slice(0, 3);
  const suggestResponses = await Promise.allSettled(limitedTerms.map(term => fetchSuggestResults(term)));

  suggestResponses.forEach(response => {
    (response.status !== 'fulfilled') && console.error('Suggest request failed:', response.reason?.message);
    const results = (response.status === 'fulfilled') ? response.value : {};

    (results.products || []).forEach(product => {
      !seenProducts.has(product.id) && (seenProducts.add(product.id), allProducts.push({
        id: product.id,
        title: product.title,
        handle: product.handle,
        price: product.price,
        price_min: product.price_min,
        price_max: product.price_max,
        compare_at_price_min: product.compare_at_price_min,
        image: product.image,
        url: product.url,
        tags: product.tags,
        type: product.type,
        available: product.available
      }));
    });

    (results.articles || []).forEach(article => {
      !seenArticles.has(article.id) && (seenArticles.add(article.id), allArticles.push({
        id: article.id,
        title: article.title,
        handle: article.handle,
        summary: article.summary_html,
        url: article.url,
        published_at: article.published_at,
        image: article.image,
        blog_handle: article.blog_handle
      }));
    });

    (results.pages || []).forEach(page => {
      !seenPages.has(page.id) && (seenPages.add(page.id), allPages.push({
        id: page.id,
        title: page.title,
        handle: page.handle,
        url: page.url
      }));
    });

    (results.collections || []).forEach(collection => {
      !seenCollections.has(collection.id) && (seenCollections.add(collection.id), allCollections.push({
        id: collection.id,
        title: collection.title,
        handle: collection.handle,
        url: collection.url
      }));
    });
  });

  return {
    products: allProducts.slice(0, 10),
    articles: allArticles.slice(0, 5),
    recipes: allPages.slice(0, 5),
    collections: allCollections.slice(0, 5)
  };
}

function generateExplanation(query, intent, language) {
  const explanations = {
    en: {
      sleep: "Based on your question about sleep, we've found products and articles that may help improve your sleep quality.",
      digestion: "Based on your question about digestion, we've found products and articles related to digestive health.",
      stress: "Based on your question about stress, we've found products and articles that may help with stress management.",
      energy: "Based on your question about energy, we've found products and articles to help boost your vitality.",
      immunity: "Based on your question about immunity, we've found products and articles to support your immune system.",
      skin: "Based on your question about skin, we've found products and articles for skin care.",
      joints: "Based on your question about joints, we've found products and articles for joint health.",
      weight: "Based on your question about weight, we've found products and articles for weight management.",
      heart: "Based on your question about heart health, we've found products and articles for cardiovascular support."
    },
    de: {
      sleep: "Basierend auf Ihrer Frage zum Schlaf haben wir Produkte und Artikel gefunden, die Ihre Schlafqualität verbessern können.",
      digestion: "Basierend auf Ihrer Frage zur Verdauung haben wir Produkte und Artikel zur Verdauungsgesundheit gefunden.",
      stress: "Basierend auf Ihrer Frage zu Stress haben wir Produkte und Artikel gefunden, die beim Stressmanagement helfen können.",
      energy: "Basierend auf Ihrer Frage zu Energie haben wir Produkte und Artikel gefunden, um Ihre Vitalität zu steigern.",
      immunity: "Basierend auf Ihrer Frage zur Immunität haben wir Produkte und Artikel zur Stärkung Ihres Immunsystems gefunden.",
      skin: "Basierend auf Ihrer Frage zur Haut haben wir Produkte und Artikel zur Hautpflege gefunden.",
      joints: "Basierend auf Ihrer Frage zu Gelenken haben wir Produkte und Artikel zur Gelenkgesundheit gefunden.",
      weight: "Basierend auf Ihrer Frage zum Gewicht haben wir Produkte und Artikel zur Gewichtskontrolle gefunden.",
      heart: "Basierend auf Ihrer Frage zur Herzgesundheit haben wir Produkte und Artikel zur Herz-Kreislauf-Unterstützung gefunden."
    }
  };

  return explanations[language]?.[intent] || explanations.en[intent] || "We've found relevant products and articles for you.";
}

app.post('/api/smart-search', async (req, res) => {
  const startTime = Date.now();
  try {
    const { query, useAI = true } = req.body;
    console.log(`Smart search request for query: ${query}`);

    return !query
      ? res.status(400).json({ error: 'Query is required' })
      : await (async () => {
          const intentResult = await ((useAI && openai) ? extractIntentWithAI(query) : Promise.resolve(extractIntentFromKeywords(query)));

          const searchTerms = [...new Set([
            query,
            ...(intentResult ? (INTENT_MAPPING[intentResult.intent]?.searchTerms || []) : []),
            ...(intentResult?.keywords || [])
          ])];

          const results = await searchShopifyPublic(searchTerms);

          const intent = intentResult?.intent || null;
          const language = intentResult?.language || detectLanguage(query);
          const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
          const explanation = intent
            ? generateExplanation(query, intent, language)
            : (totalResults > 0
              ? "Hier sind die Suchergebnisse für Ihre Anfrage."
              : "Keine Ergebnisse gefunden. Versuchen Sie es mit anderen Suchbegriffen.");

          const duration = Date.now() - startTime;
          console.log(`Smart search completed in ${duration}ms for query: ${query}`);
          return res.json({ query, intent, language, explanation, results });
        })();
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Smart search error after ${duration}ms:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/ping', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ alive: true, timestamp: Date.now() });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    openai: !!openai,
    shopify: !!process.env.SHOPIFY_SHOP_DOMAIN,
    storeUrl: SHOPIFY_STORE_URL
  });
});

app.listen(PORT, () => {
  console.log(`Smart Search server running on port ${PORT}`);
  console.log(`Store: ${SHOPIFY_STORE_URL}`);
  console.log(`OpenAI: ${openai ? 'configured' : 'not configured'}`);
});

module.exports = app;
