// NutriGo Service Worker — 应用壳离线缓存（stale-while-revalidate）
const CACHE = 'nutrigo-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  // 只缓存同源 GET（静态资源与页面；API 请求走网络）
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200 && resp.type === 'basic') {
              cache.put(request, resp.clone())
            }
            return resp
          })
          .catch(() => cached)
        return cached || network
      })
    )
  )
})
