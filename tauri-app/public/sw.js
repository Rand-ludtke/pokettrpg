const CACHE_NAME = 'pokettrpg-pwa-v9';
const scope = self?.registration?.scope || '/';
const base = scope.endsWith('/') ? scope : `${scope}/`;
const CORE_ASSETS = [
  base,
  `${base}index.html`,
  `${base}manifest.webmanifest`,
  `${base}pwa-icon.svg`,
  `${base}emulatorjs-host.html`,
  `${base}gamecorner-bootstrap.json`,
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

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const isNavigation = event.request.mode === 'navigate';
  const url = new URL(event.request.url);

  // Leave cross-origin requests alone so the browser reports real network and
  // CORS failures instead of our synthetic Offline 503 fallback.
  if (url.origin !== self.location.origin) return;

  // The hidden EmulatorJS host is loaded in an iframe with a cache-busting
  // query string. Let that request hit the network directly so the PWA
  // offline fallback never replaces it with the generic "Offline" page.
  if (url.origin === self.location.origin && url.pathname.endsWith('/emulatorjs-host.html')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(`${base}emulatorjs-host.html`).then(
          cached => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }),
        ),
      ),
    );
    return;
  }

  // Compatibility shim for older cached bundles that still request root-level gamecorner assets.
  if (url.origin === self.location.origin && url.pathname.startsWith('/gamecorner/')) {
    const rewrittenUrl = new URL(`${base}${url.pathname.replace(/^\//, '')}`, self.location.origin);
    event.respondWith(
      fetch(rewrittenUrl.toString())
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(rewrittenUrl.toString(), clone));
          }
          return response;
        })
        .catch(() => caches.match(rewrittenUrl.toString()).then(cached => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' })))
    );
    return;
  }

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
  if (url.pathname.includes('/fusion/') || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
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
