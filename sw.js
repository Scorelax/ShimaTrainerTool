// Service Worker for Pokemon D&D Trainer Tool
const CACHE_NAME = 'pokemon-dnd-v59';

// Files to cache for offline use (relative paths for subdirectory hosting)
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/api.js',
  './js/pages/new-journey.js',
  './js/pages/new-pokemon.js',
  './js/pages/trainer-card.js',
  './js/pages/index.js',
  './js/pages/my-pokemon.js',
  './js/pages/continue-journey.js',
  './js/pages/trainer-info.js',
  './js/pages/edit-pokemon.js',
  './js/pages/pokemon-card.js',
  './js/pages/evolution.js',
  './js/pages/combat.js',
  './js/pages/pokemon-form.js',
  './js/pages/edit-trainer.js',
  './js/utils/audio.js',
  './js/utils/splash.js',
  './js/utils/visibility.js',
  './js/utils/notifications.js',
  './js/utils/pokemon-types.js',
  './js/utils/move-popup.js',
  './assets/Pokeball.png',
  './assets/Grey Pokeball.png',
  './assets/pokecenter.png',
  './assets/Locked_Badge.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((error) => {
        console.log('[SW] Cache failed:', error);
      })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests (Google Apps Script)
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(event.request)
          .then((networkResponse) => {
            // Don't cache if not a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clone the response (can only be consumed once)
            const responseToCache = networkResponse.clone();

            // Add to cache for future use
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          })
          .catch(() => {
            // Network failed, return offline fallback if available
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return null;
          });
      })
  );
});
