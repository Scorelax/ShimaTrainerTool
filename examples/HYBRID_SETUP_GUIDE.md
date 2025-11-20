# Hybrid Architecture Setup Guide

## Overview
This guide shows you how to migrate your Pokemon D&D Tool to a hybrid architecture with:
- **Frontend**: GitHub Pages (modern, fast, offline-capable)
- **Backend**: Google Apps Script (free API, database access)
- **Database**: Google Sheets (easy for DMs to edit)

## 📁 File Structure

```
pokemon-dnd-tool/
├── examples/
│   ├── api-version-gode.gs.js     # Google Apps Script API
│   └── frontend/
│       ├── index.html              # Main HTML
│       ├── js/
│       │   ├── main.js            # App entry point
│       │   ├── api.js             # API client
│       │   ├── components/
│       │   │   └── trainer-card.js
│       │   └── utils/
│       │       └── notifications.js
│       ├── css/
│       │   └── styles.css         # (create this)
│       └── assets/                # Images, icons
└── README.md
```

## 🚀 Step-by-Step Migration

### Step 1: Set Up Google Apps Script API (30 mins)

1. **Open your Google Apps Script project**
   - Go to https://script.google.com
   - Open your existing project

2. **Replace `doGet()` function**
   - Copy content from `examples/api-version-gode.gs.js`
   - Paste into your `gode.gs.js` file
   - Keep all your existing functions (they become the backend)

3. **Deploy as Web App**
   ```
   Click: Deploy → New deployment
   Type: Web app
   Execute as: Me
   Who has access: Anyone (or "Anyone with Google account")
   Click: Deploy
   ```

4. **Copy your deployment URL**
   - It looks like: `https://script.google.com/macros/s/AKfycby.../exec`
   - You'll need this for the frontend

5. **Test the API**
   - Visit: `https://YOUR_URL/exec?route=test`
   - You should see JSON response

### Step 2: Create GitHub Repository (15 mins)

1. **Create new repository**
   ```bash
   # On GitHub.com
   New Repository → pokemon-dnd-tool
   Initialize with README: Yes
   ```

2. **Clone to your computer**
   ```bash
   git clone https://github.com/YOUR_USERNAME/pokemon-dnd-tool.git
   cd pokemon-dnd-tool
   ```

3. **Copy frontend files**
   ```bash
   # Copy from examples/frontend/ to your repo
   cp -r examples/frontend/* .
   ```

4. **Update API URL**
   Edit `js/api.js`:
   ```javascript
   const API_CONFIG = {
     baseUrl: 'https://script.google.com/macros/s/YOUR_ACTUAL_DEPLOYMENT_ID/exec',
     // ^ Replace with your URL from Step 1
   };
   ```

5. **Commit and push**
   ```bash
   git add .
   git commit -m "Initial frontend setup"
   git push
   ```

### Step 3: Enable GitHub Pages (5 mins)

1. **Go to your repository on GitHub**
   - Settings → Pages
   - Source: Deploy from branch
   - Branch: main
   - Folder: / (root)
   - Click Save

2. **Wait 1-2 minutes**
   - GitHub will build your site
   - Visit: `https://YOUR_USERNAME.github.io/pokemon-dnd-tool/`

3. **Your app should load!** 🎉

## 🎨 Styling (Optional)

Create `css/styles.css` with basic styling:

```css
/* Basic Layout */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  color: #333;
}

.app {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

/* Loading States */
.loading-screen {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #667eea;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: white;
  z-index: 9999;
}

.pokeball-loader {
  width: 60px;
  height: 60px;
  border: 8px solid white;
  border-radius: 50%;
  border-top-color: #ff6b6b;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Navigation */
.main-nav {
  background: white;
  padding: 1rem 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nav-logo {
  width: 40px;
  height: 40px;
}

.nav-menu {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-link {
  text-decoration: none;
  color: #666;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  transition: all 0.3s;
}

.nav-link:hover,
.nav-link.active {
  background: #667eea;
  color: white;
}

/* Content */
.content {
  background: white;
  border-radius: 12px;
  padding: 2rem;
  min-height: 500px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

/* Trainer Grid */
.trainer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
}

.trainer-card-preview {
  background: white;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  padding: 1.5rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s;
}

.trainer-card-preview:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0,0,0,0.15);
  border-color: #667eea;
}

.trainer-card-preview img {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 1rem;
}

/* Pokemon Grid */
.pokemon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.pokemon-card {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  transition: transform 0.2s;
}

.pokemon-card:hover {
  transform: scale(1.05);
}

.pokemon-card img {
  width: 100px;
  height: 100px;
  object-fit: contain;
}

/* Badges */
.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
}

.badge-level {
  background: #ffd93d;
  color: #333;
}

.badge-class {
  background: #667eea;
  color: white;
}

/* Buttons */
.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
}

/* Toast Notifications */
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
}

.toast {
  background: white;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  opacity: 0;
  transform: translateX(100%);
  transition: all 0.3s;
}

.toast.show {
  opacity: 1;
  transform: translateX(0);
}

.toast-success { border-left: 4px solid #4caf50; }
.toast-error { border-left: 4px solid #f44336; }
.toast-warning { border-left: 4px solid #ff9800; }
.toast-info { border-left: 4px solid #2196f3; }

/* Responsive */
@media (max-width: 768px) {
  .main-nav {
    flex-direction: column;
    gap: 1rem;
  }

  .nav-menu {
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }

  .trainer-grid,
  .pokemon-grid {
    grid-template-columns: 1fr;
  }
}
```

## 🧪 Testing Checklist

- [ ] API test endpoint returns JSON
- [ ] Frontend loads without errors (check Console)
- [ ] Can fetch and display trainer list
- [ ] Can view individual trainer card
- [ ] Can fetch Pokemon list
- [ ] Caching works (check Network tab - 2nd load should be instant)
- [ ] Offline indicator appears when offline
- [ ] Mobile responsive (test on phone)

## 📊 Performance Comparison

### Before (Apps Script HTML)
```
Initial Load:    3-5 seconds
Navigation:      2-3 seconds (full reload)
API Calls:       500ms-2s
Caching:         None
Offline:         ❌ No
Mobile:          😐 OK
```

### After (GitHub Pages + API)
```
Initial Load:    300-600ms (50ms cached)
Navigation:      Instant (no reload)
API Calls:       500ms-2s (0ms if cached)
Caching:         ✅ 30 minutes
Offline:         ✅ Basic support
Mobile:          ✨ Excellent
```

## 🔧 Advanced Features (Optional)

### Add PWA Support

Create `manifest.json`:
```json
{
  "name": "Pokemon D&D Trainer Tool",
  "short_name": "PokeD&D",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#667eea",
  "theme_color": "#667eea",
  "icons": [
    {
      "src": "assets/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "assets/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

Create `sw.js` (Service Worker):
```javascript
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

### Use React (Advanced)

If you want a more modern framework:

```bash
npx create-react-app pokemon-dnd-frontend
cd pokemon-dnd-frontend
# Copy your API client to src/
# Build components in React
npm run build
# Deploy the build/ folder to GitHub Pages
```

## 🆘 Troubleshooting

### "API is not responding"
- Check your deployment URL in `api.js`
- Make sure Google Apps Script is deployed as "Web app"
- Check "Who has access" is set correctly

### "CORS Error"
- This shouldn't happen with Apps Script
- If it does, make sure you're using the Web App URL, not the script URL

### "Slow loading"
- First load will always be slower (fetching from API)
- Subsequent loads should be instant (cached)
- Check Network tab in DevTools to see what's slow

### "Not updating after changes"
- Clear cache: DevTools → Application → Clear storage
- Hard refresh: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)
- If API changes: Redeploy Apps Script with new version number

## 🎯 Next Steps

1. **Start with one page**: Migrate just the trainer list first
2. **Test thoroughly**: Make sure it works before moving to next page
3. **Add features gradually**: Don't try to do everything at once
4. **Get feedback**: Have your D&D group test it

## 📚 Resources

- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Progressive Web Apps](https://web.dev/progressive-web-apps/)

## 💬 Questions?

Feel free to experiment! The beauty of this approach is:
- Your data is safe in Google Sheets
- You can always roll back
- Frontend and backend are independent

Good luck! 🚀
