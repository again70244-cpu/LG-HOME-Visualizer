/* 快取策略刻意分成兩種：
   - 應用程式本體（HTML / CSS / JS / manifest）走「網路優先」，所以推上新版後
     使用者一連線就是新版，不用等快取過期。離線時才退回快取。
   - 字體與圖示走「快取優先」，它們不會在同名檔案下改變，沒必要每次都問網路。 */
const CACHE = 'lgv-2026-09-17';
const SHELL = [
  './', './app.css', './app.js', './manifest.webmanifest',
  './fonts/Archivo.woff2',
  './fonts/IBMPlexMono-400.woff2',
  './fonts/IBMPlexMono-500.woff2',
  './fonts/IBMPlexMono-600.woff2',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-180.png', './icons/icon-maskable-512.png'
];
/* 這個 repo 底下不只一個 App（bonus/ 是另一個 PWA，有自己的 Service Worker）。
   這支 SW 的範圍是網站根目錄，會涵蓋到別人的路徑，所以改成「白名單自己的檔案」：
   凡不屬於本 App 的請求一律不攔截，直接放行給網路與對方的 SW。
   採白名單而非排除 bonus/，是為了之後再加第幾個 App 都不必回來改這裡。 */
const BASE = new URL('./', self.location).pathname;
const OWN_FILES = new Set(['', 'index.html', 'preview.html', 'app.css', 'app.js',
                           'manifest.webmanifest', 'sw.js']);
const OWN_DIRS = ['fonts/', 'icons/'];
function ownPath(url){
  const u = new URL(url);
  if (u.origin !== location.origin) return null;
  if (!u.pathname.startsWith(BASE)) return null;
  const rel = u.pathname.slice(BASE.length);
  if (OWN_FILES.has(rel) || OWN_DIRS.some(d => rel.startsWith(d))) return rel;
  return null;                                   // 別的 App 的東西，不是我的事
}

/* 逐一快取，不用 addAll。addAll 是全有全無的：只要有一個項目回傳轉址
   （Cloudflare 預設會把 /index.html 轉到 /）或 404，整個安裝就失敗，
   Service Worker 也就永遠註冊不起來。 */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok && !res.redirected) { await c.put(url, res); return; }
        console.warn('[SW] 略過', url, res.status, res.redirected ? '(轉址)' : '');
      } catch (err) {
        console.warn('[SW] 抓取失敗', url, err && err.message);   // 少一個檔案不該讓離線整組報廢
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('lgv-') && k !== CACHE).map(k => caches.delete(k))))   // 只清自己的，bonus/ 的快取不要動
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const rel = ownPath(req.url);
  if (rel === null) return;                                   // 不是本 App 的檔案，完全不碰

  if (OWN_DIRS.some(d => rel.startsWith(d))) {                // 字體與圖示：快取優先
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      } catch (_) {
        return new Response('', { status: 503 });
      }
    })());
    return;
  }
  e.respondWith((async () => {                                // 網路優先
    try {
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    } catch (_) {
      // respondWith 收到 undefined 會直接丟 TypeError，所以最後一定要給一個 Response
      return (await caches.match(req))
          || (req.mode === 'navigate' ? await caches.match('./') : null)
          || new Response('離線，且這個檔案尚未快取。', {
               status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
