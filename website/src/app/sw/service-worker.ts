import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { API_CACHE, deleteManagedCaches, EVICT_VIEW_OWNER, type IViewRequest, parseViewRequest, viewBucket } from '../swCache.js'

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

// Self-state view-cache. GET /api/view?net=&to=&data=[&m=code] is a same-origin cache key for ONE eth_call (or
// eth_getCode); the URL is the key, so it's served cache-first and a per-URL ?refresh=true busts exactly that view
// (the app does this on settlement). On miss the SW dispatches the read itself to /api/rpc and caches only a
// successful result, so the matchmaker is never in the read path. A user-supplied RPC can later be tried first here.
async function dispatchView(view: IViewRequest): Promise<{ result?: string; error?: string }> {
  const method = view.isCode ? 'eth_getCode' : 'eth_call'
  const block = view.block ?? 'latest'
  const params = view.isCode ? [view.to, block] : [{ to: view.to, data: view.data }, block]
  try {
    const res = await fetch(`/api/rpc?network=${view.net}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
    const json = (await res.json()) as { result?: string; error?: { message?: string } }
    return json.error ? { error: json.error.message ?? 'rpc error' } : { result: json.result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'rpc fetch failed' }
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  // One bucket per connected wallet (`w`), so a wallet's PA + FA self-views live together and can be evicted as a
  // unit on disconnect/switch; global/deterministic reads (no `w`) share one bucket that survives wallet changes.
  const view = parseViewRequest(url)
  if (view) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(view.bucket)
        if (!view.forceRefresh) {
          const cached = await cache.match(view.cacheKey)
          if (cached) return cached
        }
        const out = await dispatchView(view)
        const response = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } })
        if (out.result !== undefined) await cache.put(view.cacheKey, response.clone())
        return response
      })()
    )
    return
  }

  if (!CACHEABLE_PATHS.some(rx => rx.test(url.pathname))) return

  const forceRefresh = url.searchParams.get('refresh') === 'true'
  url.searchParams.delete('refresh')

  event.respondWith(
    (async () => {
      const cache = await caches.open(API_CACHE)
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

// Clear api-cache and every per-wallet/shared view bucket on new service worker activation. waitUntil holds the
// activating state until the deletes resolve, so clientsClaim() cannot hand a freshly-claimed client a stale entry.
self.addEventListener('activate', event => {
  event.waitUntil(deleteManagedCaches())
})

// Auto update: activate immediately and take control of existing clients
clientsClaim()

// Let the client decide when to promote a waiting SW (via registerSW.reloadCb), and drop a wallet's view bucket when
// it disconnects / the active wallet switches.
self.addEventListener('message', event => {
  const data = event.data
  if (!data) return
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  } else if (data.type === EVICT_VIEW_OWNER && typeof data.owner === 'string') {
    event.waitUntil(caches.delete(viewBucket(data.owner)))
  }
})
