/* Lumen Log — service worker (offline-first app shell) */
const CACHE = 'lumen-log-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=1',
  './app.js?v=1',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  // Network-first for navigations (so HTML updates land), cache fallback offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return r;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for same-origin assets; pass through cross-origin (Google Fonts).
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(r => {
      if (r.ok && new URL(request.url).origin === self.location.origin) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
      }
      return r;
    }).catch(() => cached))
  );
});
