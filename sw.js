const CACHE_NAME = 'ttg-v3'; // Static version increment
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/app.js',
  './js/game.js',
  './js/grid.js',
  './js/render.js',
  './js/state.js',
  './js/multiplayer.js',
  './js/zoom.js',
  './js/constants.js',
  './js/ai.js',
  './js/confetti.js',
  './js/svg.js',
  './js/utils.js',
  './manifest.json',
  './fonts/Excalifont-Regular.woff2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim())
  );
});

// Stale-while-revalidate strategy
self.addEventListener('fetch', (e) => {
  // Skip Firebase and non-GET requests
  if (e.request.method !== 'GET' || e.request.url.includes('google-analytics') || e.request.url.includes('firebase')) {
    return;
  }

  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(e.request).then((cachedResponse) => {
        const fetchedResponse = fetch(e.request).then((networkResponse) => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        }).catch(() => {
          // Silent fail for network errors if we have a cache
          return null;
        });

        return cachedResponse || fetchedResponse;
      });
    })
  );
});
