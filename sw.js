/* 快取策略刻意分成兩種：
   - 應用程式本體（HTML / CSS / JS / manifest）走「網路優先」，所以推上新版後
     使用者一連線就是新版，不用等快取過期。離線時才退回快取。
   - 字體與圖示走「快取優先」，它們不會在同名檔案下改變，沒必要每次都問網路。 */
const CACHE = 'lgv-2026-09-17';
const SHELL = [
  './', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './fonts/Archivo.woff2',
  './fonts/IBMPlexMono-400.woff2',
  './fonts/IBMPlexMono-500.woff2',
  './fonts/IBMPlexMono-600.woff2',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-180.png', './icons/icon-maskable-512.png'
];
const IMMUTABLE = /\/(fonts|icons)\//;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;   // 本來就不該有外部請求

  if (IMMUTABLE.test(req.url)) {                              // 快取優先
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(                                              // 網路優先
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
