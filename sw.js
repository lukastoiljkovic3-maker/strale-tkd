/* Minimal PWA service worker: fast repeat loads + offline shell.
   - Navigations: network-first, falling back to the last cached shell offline.
   - Static images: cache-first.
   - Never touches /api/ or cross-origin (Supabase, GHL) - data stays live. */
const CACHE = 'crm-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(ch => ch.put('/', c)); return r; })
        .catch(() => caches.match('/'))
    );
    return;
  }
  if (/\.(png|ico|svg|webp)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(hit =>
        hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ch => ch.put(e.request, c)); return r; })
      )
    );
  }
});
