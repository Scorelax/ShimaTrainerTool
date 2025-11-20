# Hybrid Architecture Migration Plan

## Overview
Move frontend to GitHub Pages while keeping Google Sheets + Apps Script backend.

## Benefits
- ✅ **10-100x faster page loads** - Static files served from CDN
- ✅ **Modern UI frameworks** - Use React, Vue, or vanilla JS with modern tooling
- ✅ **Better developer experience** - Hot reload, proper debugging, version control
- ✅ **Offline capabilities** - Progressive Web App features
- ✅ **Keep Google Sheets** - DM can still edit data directly
- ✅ **Free hosting** - GitHub Pages + Google Apps Script both free
- ✅ **Better mobile experience** - Responsive design with modern CSS

## Architecture

```
Frontend (GitHub Pages)          Backend (Google Apps Script)
├── index.html                   └── gode.gs.js (API only)
├── js/
│   ├── api.js                      Endpoints:
│   ├── components/                 - doGet(e) → route requests
│   │   ├── trainer-card.js         - API endpoints return JSON
│   │   ├── pokemon-list.js         - CORS enabled
│   │   └── battle.js               - Authentication handled
│   └── utils/
│       ├── cache.js
│       └── storage.js
├── css/
│   └── styles.css
└── assets/
    └── images/
```

## Migration Steps

### Phase 1: API Layer (Google Apps Script)
**Time: 2-3 hours**

1. Convert `doGet()` to API router
2. Expose all functions as JSON endpoints
3. Enable CORS
4. Add response caching headers
5. Test all endpoints with Postman/curl

### Phase 2: Frontend Setup (GitHub Pages)
**Time: 1-2 hours**

1. Create new GitHub repository
2. Set up GitHub Pages
3. Create basic HTML structure
4. Add API client wrapper
5. Deploy initial version

### Phase 3: Component Migration
**Time: 5-10 hours**

1. Move HTML templates to frontend
2. Replace `google.script.run` with API calls
3. Add loading states and error handling
4. Implement client-side caching
5. Test each component

### Phase 4: Enhancement
**Time: Ongoing**

1. Add offline support (Service Worker)
2. Implement better state management
3. Add animations and transitions
4. Progressive enhancement

## File Structure

### Google Apps Script (API Only)
```javascript
// gode.gs.js - Simplified API version

function doGet(e) {
  const route = e.parameter.route;
  const action = e.parameter.action;

  // CORS headers
  const response = {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  };

  try {
    let data;

    switch(route) {
      case 'pokemon':
        data = handlePokemonRequest(action, e.parameter);
        break;
      case 'trainer':
        data = handleTrainerRequest(action, e.parameter);
        break;
      case 'battle':
        data = handleBattleRequest(action, e.parameter);
        break;
      default:
        throw new Error('Unknown route');
    }

    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.toString(),
        status: 'error'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handlePokemonRequest(action, params) {
  switch(action) {
    case 'list':
      return getCompletePokemonData();
    case 'get':
      return getPokemonInfo(params.trainer, params.name);
    case 'register':
      return registerPokemonForTrainer(params.trainer, JSON.parse(params.data));
    default:
      throw new Error('Unknown pokemon action');
  }
}
```

### Frontend (GitHub Pages)
```javascript
// js/api.js - API Client

const API_BASE = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

class PokemonAPI {
  static async getPokemonList() {
    const response = await fetch(`${API_BASE}?route=pokemon&action=list`);
    return response.json();
  }

  static async getTrainerData(name) {
    const response = await fetch(
      `${API_BASE}?route=trainer&action=get&name=${encodeURIComponent(name)}`
    );
    return response.json();
  }

  static async registerPokemon(trainerName, pokemonData) {
    const response = await fetch(
      `${API_BASE}?route=pokemon&action=register` +
      `&trainer=${encodeURIComponent(trainerName)}` +
      `&data=${encodeURIComponent(JSON.stringify(pokemonData))}`
    );
    return response.json();
  }
}

// Usage in components
async function loadTrainerCard(trainerName) {
  const trainer = await PokemonAPI.getTrainerData(trainerName);
  renderTrainerCard(trainer);
}
```

### Frontend Example - Trainer Card Component
```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pokemon DnD Trainer Tool</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div id="app">
    <nav id="navigation"></nav>
    <main id="content">
      <div class="loading">Loading...</div>
    </main>
  </div>

  <script type="module" src="js/main.js"></script>
</body>
</html>
```

```javascript
// js/components/trainer-card.js
export class TrainerCard {
  constructor(trainerData) {
    this.data = trainerData;
  }

  render() {
    return `
      <div class="trainer-card">
        <img src="${this.data.image}" alt="${this.data.name}">
        <h2>${this.data.name}</h2>
        <div class="stats">
          <div class="stat">
            <span>Level</span>
            <strong>${this.data.level}</strong>
          </div>
          <div class="stat">
            <span>HP</span>
            <strong>${this.data.currentHP || this.data.hp}</strong>
          </div>
          <!-- More stats -->
        </div>
        <div class="pokemon-list">
          ${this.renderPokemonList()}
        </div>
      </div>
    `;
  }

  renderPokemonList() {
    return this.data.pokemon
      .map(p => `
        <div class="pokemon-item" data-name="${p.name}">
          <img src="${p.image}" alt="${p.name}">
          <span>${p.nickname || p.name}</span>
        </div>
      `)
      .join('');
  }
}
```

## Caching Strategy

### Client-Side Cache
```javascript
// js/utils/cache.js
class Cache {
  constructor(duration = 30 * 60 * 1000) { // 30 minutes
    this.duration = duration;
  }

  get(key) {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const { data, timestamp } = JSON.parse(item);
    if (Date.now() - timestamp > this.duration) {
      localStorage.removeItem(key);
      return null;
    }

    return data;
  }

  set(key, data) {
    localStorage.setItem(key, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  }
}

// Usage
const cache = new Cache();

async function getTrainerData(name) {
  const cached = cache.get(`trainer:${name}`);
  if (cached) return cached;

  const data = await PokemonAPI.getTrainerData(name);
  cache.set(`trainer:${name}`, data);
  return data;
}
```

## Progressive Web App (PWA)

Add offline support with Service Worker:

```javascript
// sw.js - Service Worker
const CACHE_NAME = 'pokemon-dnd-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/main.js',
  '/js/api.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
```

## Performance Comparison

### Current (Apps Script HTML)
- Initial load: 2-5 seconds
- Navigation: 1-3 seconds (full page reload)
- Data fetch: 500ms-2s

### After Migration (GitHub Pages)
- Initial load: 200-500ms (cached: 50ms)
- Navigation: Instant (SPA)
- Data fetch: 500ms-2s (same API, but with client cache: 0ms)

## Cost Breakdown

| Service | Current | After Migration |
|---------|---------|-----------------|
| Frontend Hosting | Free (Apps Script) | Free (GitHub Pages) |
| Backend API | Free (Apps Script) | Free (Apps Script) |
| Database | Free (Sheets) | Free (Sheets) |
| Domain (optional) | - | $12/year |
| **Total** | **$0/month** | **$0-1/month** |

## Migration Checklist

- [ ] Set up GitHub repository
- [ ] Enable GitHub Pages
- [ ] Convert doGet() to API router
- [ ] Test all API endpoints
- [ ] Create frontend file structure
- [ ] Build API client wrapper
- [ ] Migrate one component (e.g., trainer card)
- [ ] Test thoroughly
- [ ] Migrate remaining components
- [ ] Add caching layer
- [ ] Implement error handling
- [ ] Add loading states
- [ ] Performance optimization
- [ ] Add Service Worker (PWA)
- [ ] Mobile responsive testing
- [ ] Deploy production version

## Next Steps

1. I can help you set up the GitHub repository structure
2. Convert your gode.gs.js to API format
3. Create the first component (trainer card) as example
4. Set up the deployment pipeline

Ready to start?
