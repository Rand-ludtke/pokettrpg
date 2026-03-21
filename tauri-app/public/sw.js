const CACHE_NAME = 'pokettrpg-pwa-v6';
const scope = self?.registration?.scope || '/';
const base = scope.endsWith('/') ? scope : `${scope}/`;
const CORE_ASSETS = [
  base,
  `${base}index.html`,
  `${base}manifest.webmanifest`,
  `${base}pwa-icon.svg`,
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : undefined)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const isNavigation = event.request.mode === 'navigate';

  // Always revalidate document requests first so deployed updates are picked up.
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' })))
    );
    return;
  }

  // Never cache fusion/API endpoints — gen-check, generate, sprites must always hit the server
  const url = new URL(event.request.url);
  if (url.pathname.includes('/fusion/') || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  event.respondWith(
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
    })
  );
});
