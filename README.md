# Smart Search Backend

A Node.js/Express backend for Shopify that provides intelligent, intent-based search functionality. The system uses natural language processing to understand user queries and return relevant products and blog articles.

## Features

- **Intent-based Search**: Classifies user queries into health/wellness intents (sleep, digestion, stress, energy, etc.)
- **Dual-mode Intent Extraction**:
  - AI-powered using OpenAI GPT-3.5 (optional)
  - Keyword-based fallback (always available)
- **Multi-language Support**: English and German
- **Shopify Integration**: Searches products and blog articles via Shopify Admin API
- **Graceful Degradation**: Falls back to keyword matching if AI fails
- **CORS Support**: Configurable allowed origins

## Supported Intents

- Sleep (sleep, insomnia, schlaf)
- Digestion (digestion, stomach, verdauung)
- Stress (stress, calm, entspannung)
- Energy (energy, tired, müde)
- Immunity (immune, immun, abwehr)
- Skin (skin, haut, acne)
- Joints (joint, gelenk, arthritis)
- Weight (weight, gewicht, diet)
- Heart (heart, herz, cardio)

## Prerequisites

- Node.js 16+
- Shopify store with Admin API access
- OpenAI API key (optional, for AI-powered intent extraction)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd smart-search
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your credentials:
```env
SHOPIFY_SHOP_DOMAIN=your-shop-domain
SHOPIFY_ACCESS_TOKEN=your_shopify_access_token
SHOPIFY_APP_SECRET=your_shopify_app_secret
SHOPIFY_API_VERSION=2026-04
APP_PROXY_PREFIX=your-app-proxy-prefix
PORT=3000
ALLOWED_ORIGINS=https://your-shop-domain.myshopify.com
OPENAI_API_KEY=your_openai_api_key  # Optional
```

### Getting Shopify Credentials

1. **Shop Domain**: Your Shopify store name (e.g., `mystore` from `mystore.myshopify.com`)
2. **Access Token**: Create a custom app in Shopify Admin → Settings → Apps and sales channels → Develop apps → Create an app
3. **App Secret**: Generated when creating the custom app
4. **API Version**: Use the latest stable version (default: 2026-04)

### Getting OpenAI API Key (Optional)

1. Sign up at [OpenAI Platform](https://platform.openai.com/)
2. Navigate to API Keys
3. Create a new secret key
4. Add it to your `.env` file

## Usage

### Start the Server

```bash
npm start
```

The server will start on port 3000 (or the port specified in `.env`).

### API Endpoints

#### Smart Search

**POST** `/api/smart-search`

Request body:
```json
{
  "query": "what is best for sleep?",
  "useAI": true
}
```

Response:
```json
{
  "query": "what is best for sleep?",
  "intent": "sleep",
  "language": "en",
  "explanation": "Based on your question about sleep, we've found products and articles that may help improve your sleep quality.",
  "results": {
    "products": [
      {
        "id": 123456789,
        "title": "Sleep Support Supplement",
        "handle": "sleep-support",
        "price": "29.99",
        "image": "https://cdn.shopify.com/...",
        "tags": ["sleep", "rest"]
      }
    ],
    "articles": [
      {
        "id": 987654321,
        "title": "5 Tips for Better Sleep",
        "handle": "5-tips-for-better-sleep",
        "summary": "<p>Learn how to improve your sleep...</p>",
        "published_at": "2024-01-15T10:00:00Z",
        "blog_id": 123456
      }
    ]
  }
}
```

#### Health Check

**GET** `/health`

Response:
```json
{
  "status": "ok",
  "openai": true,
  "shopify": true
}
```

## Frontend Integration

### Natural Language Detection

In your frontend JavaScript, detect natural language queries:

```javascript
isNaturalLanguageQuery(query) {
  const indicators = ['what', 'which', 'how', 'was', 'welche', 'wie', 'best', 'help', 'suggest'];
  return indicators.some(word => query.toLowerCase().includes(word));
}
```

### Routing Logic

```javascript
async function handleSearch(query) {
  if (isNaturalLanguageQuery(query)) {
    // Use smart search backend
    const response = await fetch('https://your-backend.com/api/smart-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, useAI: true })
    });
    return await response.json();
  } else {
    // Use Shopify's built-in predictive search
    return await shopifyPredictiveSearch(query);
  }
}
```

### Rendering Results

Display the explanation, products, and articles in your search UI:

```javascript
function renderSmartSearchResults(data) {
  // Show explanation
  document.getElementById('explanation').textContent = data.explanation;
  
  // Render products
  data.results.products.forEach(product => {
    // Create product card with image, title, price
  });
  
  // Render articles
  data.results.articles.forEach(article => {
    // Create article link with title
  });
}
```

## Architecture

### Intent Extraction Flow

```
User Query
    ↓
Is OpenAI configured?
    ↓ Yes
Extract intent with GPT-3.5
    ↓ Fallback
Extract intent from keywords
    ↓
Return intent + keywords + language
```

### Search Flow

```
Intent detected
    ↓
Get intent config (tags, topics)
    ↓
Search Shopify products (title OR tags)
Search Shopify articles (title)
    ↓
Generate explanation (based on intent + language)
    ↓
Return results
```

## Error Handling

- If OpenAI fails → Falls back to keyword extraction
- If no intent detected → Returns helpful message suggesting keywords
- If Shopify API fails → Returns empty array for that search type
- All errors logged to console

## Customization

### Adding New Intents

Edit `INTENT_MAPPING` in `server.js`:

```javascript
const INTENT_MAPPING = {
  // ... existing intents
  your_new_intent: {
    keywords: ['keyword1', 'keyword2', 'german_keyword'],
    product_tags: ['tag1', 'tag2'],
    blog_topics: ['topic1', 'topic2']
  }
};
```

### Adding Explanations

Edit the `explanations` object in `generateExplanation()` function to add new language/intent combinations.

## Development

### Project Structure

```
smart-search/
├── server.js          # Main application file
├── package.json       # Dependencies
├── .env.example       # Environment template
├── .env              # Your credentials (not in git)
└── README.md         # This file
```

## License

MIT
