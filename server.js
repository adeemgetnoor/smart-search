require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*'
}));
app.use(express.json());

// Initialize OpenAI if API key is provided
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// Intent Mapping Configuration
const INTENT_MAPPING = {
  sleep: {
    keywords: ['sleep', 'insomnia', 'schlaf', 'rest', 'night', 'bedtime'],
    product_tags: ['sleep', 'rest', 'night'],
    blog_topics: ['sleep', 'bedtime routine', 'insomnia']
  },
  digestion: {
    keywords: ['digestion', 'stomach', 'verdauung', 'gut', 'bloating'],
    product_tags: ['digestion', 'gut'],
    blog_topics: ['digestion', 'gut health', 'bloating']
  },
  stress: {
    keywords: ['stress', 'calm', 'entspannung', 'anxiety', 'relax'],
    product_tags: ['stress', 'calm', 'relax'],
    blog_topics: ['stress management', 'relaxation', 'anxiety']
  },
  energy: {
    keywords: ['energy', 'tired', 'fatigue', 'müde', 'vitality'],
    product_tags: ['energy', 'vitality'],
    blog_topics: ['energy', 'fatigue', 'vitality']
  },
  immunity: {
    keywords: ['immune', 'immunity', 'immun', 'defense', 'abwehr'],
    product_tags: ['immune', 'immunity'],
    blog_topics: ['immune system', 'immunity']
  },
  skin: {
    keywords: ['skin', 'haut', 'acne', 'dermatitis'],
    product_tags: ['skin', 'dermatology'],
    blog_topics: ['skin care', 'acne', 'dermatitis']
  },
  joints: {
    keywords: ['joint', 'gelenk', 'arthritis', 'pain', 'schmerz'],
    product_tags: ['joint', 'arthritis'],
    blog_topics: ['joint health', 'arthritis', 'pain management']
  },
  weight: {
    keywords: ['weight', 'gewicht', 'diet', 'metabolism'],
    product_tags: ['weight', 'metabolism'],
    blog_topics: ['weight management', 'metabolism', 'diet']
  },
  heart: {
    keywords: ['heart', 'herz', 'cardio', 'blood pressure'],
    product_tags: ['heart', 'cardio'],
    blog_topics: ['heart health', 'blood pressure', 'cardiovascular']
  }
};

// Shopify API Configuration
const SHOPIFY_CONFIG = {
  shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-04'
};

// Helper: Build Shopify Admin API URL
function buildShopifyUrl(endpoint) {
  return `https://${SHOPIFY_CONFIG.shopDomain}.myshopify.com/admin/api/${SHOPIFY_CONFIG.apiVersion}${endpoint}`;
}

// Keyword-based Intent Extraction
function extractIntentFromKeywords(query) {
  const lowerQuery = query.toLowerCase();
  
  for (const [intent, config] of Object.entries(INTENT_MAPPING)) {
    for (const keyword of config.keywords) {
      if (lowerQuery.includes(keyword)) {
        return {
          intent,
          keywords: [keyword],
          language: detectLanguage(query)
        };
      }
    }
  }
  
  return null;
}

// Language Detection (simple)
function detectLanguage(query) {
  const germanIndicators = ['was', 'welche', 'wie', 'der', 'die', 'das', 'für'];
  const lowerQuery = query.toLowerCase();
  
  if (germanIndicators.some(word => lowerQuery.includes(word))) {
    return 'de';
  }
  return 'en';
}

// AI-powered Intent Extraction
async function extractIntentWithAI(query) {
  if (!openai) {
    console.log('OpenAI not configured, falling back to keyword extraction');
    return extractIntentFromKeywords(query);
  }

  try {
    const intents = Object.keys(INTENT_MAPPING).join(', ');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a search intent classifier. Classify the user's query into one of these intents: ${intents}. Return JSON with keys: intent, keywords (array), language (en or de).`
        },
        {
          role: 'user',
          content: query
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Validate intent exists in mapping
    if (!INTENT_MAPPING[result.intent]) {
      return extractIntentFromKeywords(query);
    }
    
    return result;
  } catch (error) {
    console.error('AI intent extraction failed:', error.message);
    return extractIntentFromKeywords(query);
  }
}

// Shopify Product Search
async function searchShopifyProducts(keywords, tags) {
  try {
    const allResults = [];
    const seen = new Set();

    // Search by each keyword in title
    for (const keyword of keywords) {
      const url = buildShopifyUrl(`/products.json?title=${encodeURIComponent(keyword)}&limit=10`);
      const response = await axios.get(url, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken }
      });
      response.data.products.forEach(p => {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          allResults.push(p);
        }
      });
    }

    // Search by each tag
    for (const tag of tags) {
      const url = buildShopifyUrl(`/products.json?tag=${encodeURIComponent(tag)}&limit=10`);
      const response = await axios.get(url, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken }
      });
      response.data.products.forEach(p => {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          allResults.push(p);
        }
      });
    }

    return allResults.slice(0, 10).map(product => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      price: product.variants[0]?.price,
      image: product.images[0]?.src,
      tags: product.tags
    }));
  } catch (error) {
    console.error('Shopify product search failed:', error.message);
    return [];
  }
}

// Shopify Blog Search
async function searchShopifyBlogs(keywords) {
  try {
    const allResults = [];
    const seen = new Set();

    for (const keyword of keywords) {
      const url = buildShopifyUrl(`/articles.json?title=${encodeURIComponent(keyword)}&limit=5`);
      const response = await axios.get(url, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_CONFIG.accessToken }
      });
      response.data.articles.forEach(a => {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          allResults.push(a);
        }
      });
    }

    return allResults.slice(0, 5).map(article => ({
      id: article.id,
      title: article.title,
      handle: article.handle,
      summary: article.summary_html,
      published_at: article.published_at,
      blog_id: article.blog_id
    }));
  } catch (error) {
    console.error('Shopify blog search failed:', error.message);
    return [];
  }
}

// Generate Explanation
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

// Smart Search Endpoint
app.post('/api/smart-search', async (req, res) => {
  try {
    const { query, useAI = true } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Extract intent
    let intentResult;
    if (useAI && openai) {
      intentResult = await extractIntentWithAI(query);
    } else {
      intentResult = extractIntentFromKeywords(query);
    }

    // If no intent detected, return empty results
    if (!intentResult) {
      return res.json({
        query,
        intent: null,
        language: detectLanguage(query),
        explanation: "We couldn't determine a specific intent from your query. Try searching with keywords like 'sleep', 'digestion', or 'stress'.",
        results: {
          products: [],
          articles: []
        }
      });
    }

    const { intent, keywords, language } = intentResult;
    const intentConfig = INTENT_MAPPING[intent];

    // Search Shopify — use intent keywords for blog search (single words match better as title filters)
    const blogKeywords = [...new Set([...keywords, ...intentConfig.product_tags])];
    const [products, articles] = await Promise.all([
      searchShopifyProducts(keywords, intentConfig.product_tags),
      searchShopifyBlogs(blogKeywords)
    ]);

    // Generate response
    const response = {
      query,
      intent,
      language,
      explanation: generateExplanation(query, intent, language),
      results: {
        products,
        articles
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Smart search error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    openai: !!openai,
    shopify: !!SHOPIFY_CONFIG.shopDomain
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Smart Search server running on port ${PORT}`);
  console.log(`OpenAI: ${openai ? 'configured' : 'not configured'}`);
  console.log(`Shopify: ${SHOPIFY_CONFIG.shopDomain ? 'configured' : 'not configured'}`);
});
