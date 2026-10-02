/* 業務獎金的離線快取。範圍是 /bonus/，比根目錄的 sw.js 更精確，所以這個資料夾由它負責。
   策略跟根目錄相同：程式本體網路優先（推新版馬上生效），字體與圖示快取優先。
   這裡只快取程式檔案；業績資料在 localStorage，不經過 Service Worker。 */
const CACHE = 'lg-bonus-2026-10-02b';
const SHELL = [
  './', './bonus.css', './bonus.js', './manifest.webmanifest',
  '../fonts/Archivo.woff2', '../fonts/IBMPlexMono-500.woff2',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];
const IMMUTABLE = /\/(fonts|icons)\//;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok && !res.redirected) await c.put(url, res);
      } catch (_) { /* 少一個檔案不該讓離線整組報廢 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('lg-bonus-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    if (IMMUTABLE.test(req.url)) {
      const hit = await caches.match(req, { cacheName: CACHE });
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    } catch (_) {
      return (await caches.match(req, { cacheName: CACHE }))
          || (req.mode === 'navigate' ? await caches.match('./', { cacheName: CACHE }) : null)
          || new Response('離線，且這個檔案尚未快取。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
