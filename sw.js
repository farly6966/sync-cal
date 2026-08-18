/* 同步器計算機 — Service Worker
   作用：把整個 App 存一份在手機裡，之後開啟不需要網路。

   ⚠️ 改版時：這裡的 SW_VERSION 要跟 index.html 裡的 APP_VERSION 一起往上加。
   版本號一變，瀏覽器就會裝新的、把舊快取清掉。 */
const SW_VERSION = '2026-08-15h';
const CACHE = 'synccalc-' + SW_VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png',
  './chart.umd.min.js'
];

// 安裝：把資源抓下來存好。單一資源失敗（例如 CDN 連不到）不擋整個安裝。
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

// 啟用：刪掉所有舊版本的快取，只留現在這版
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('synccalc-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  // 版本檢查（?_cb=）與「載入新版」（?v=）一律走網路，不能被快取擋住
  if (url.searchParams.has('_cb') || url.searchParams.has('v')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        // 使用者按了「載入新版」→ 順手把新的首頁寫回快取，下次冷開就是新版
        if (res && res.ok && req.mode === 'navigate') {
          const c = await caches.open(CACHE);
          await c.put('./index.html', res.clone());
        }
        return res;
      } catch (err) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // 其餘：先給快取（秒開、離線可用），同時背景更新
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (cached) return cached;
    const res = await fresh;
    if (res) return res;
    // 完全離線又沒快取到：導頁請求至少回首頁
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return Response.error();
  })());
});
