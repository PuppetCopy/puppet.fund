import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & typeof globalThis

// self.__WB_MANIFEST is the default injection point
precacheAndRoute(self.__WB_MANIFEST)

// clean old assets
cleanupOutdatedCaches()

let allowlist: RegExp[] | undefined
// in dev mode, we disable precaching to avoid caching issues
if (import.meta.env.DEV) allowlist = [/^\/$/]

// to allow work offline - exclude /assets/ from SPA fallback
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    allowlist,
    denylist: [/^\/assets\//]
  })
)

const CACHEABLE_PATHS: RegExp[] = [/^\/api\/og(\/|$)/]

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (!CACHEABLE_PATHS.some(rx => rx.test(url.pathname))) return

  const forceRefresh = url.searchParams.get('refresh') === 'true'
  url.searchParams.delete('refresh')

  event.respondWith(
    (async () => {
      const cache = await caches.open('api-cache')
      const cacheKey = new Request(url.href)

      if (!forceRefresh) {
        const cached = await cache.match(cacheKey)
        if (cached) return cached
      }

      const response = await fetch(event.request)
      if (response.ok) cache.put(cacheKey, response.clone())
      return response
    })()
  )
})

// Clear api-cache on new service worker activation
self.addEventListener('activate', async () => {
  await caches.delete('api-cache')
})

// Auto update: activate immediately and take control of existing clients
clientsClaim()

// Let the client decide when to promote a waiting SW (via registerSW.reloadCb)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
