// Minimal no-op service worker.
//
// Its only job is satisfying Android Chrome's "Add to Home Screen"
// installability criteria, which requires a registered service worker with
// an active fetch handler (iOS Safari has no such requirement). It does no
// caching whatsoever -- every request just passes straight through to the
// network -- so there's nothing here that can ever go stale the way the old
// cache-first version could. No CACHE_NAME, no version bumps needed.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
