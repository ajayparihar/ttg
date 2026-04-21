const CACHE_NAME = 'ttg-v4'; // Static version increment
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
  './js/i18n.js',
  './js/tutorial.js',
  './js/utils/animation.js',
  './js/utils/colors.js',
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

// Cache-First with Network Fallback (for assets)
// This is safer for consistency during a single session.
self.addEventListener('fetch', (e) => {
  // Skip Firebase and non-GET requests
  if (e.request.method !== 'GET' || e.request.url.includes('google-analytics') || e.request.url.includes('firebase')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(e.request).then((networkResponse) => {
        // Cache the new resource
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Return null if offline and not in cache
        return null;
      });
    })
  );
});
