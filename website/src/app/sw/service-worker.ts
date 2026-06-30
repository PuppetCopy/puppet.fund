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

// Self-state view-cache. GET /api/view?net=&to=&data=[&m=code] is a same-origin cache key for ONE eth_call (or
// eth_getCode); the URL is the key, so it's served cache-first and a per-URL ?refresh=true busts exactly that view
// (the app does this on settlement). On miss the SW dispatches the read itself to /api/rpc and caches only a
// successful result, so the matchmaker is never in the read path. A user-supplied RPC can later be tried first here.
async function dispatchView(url: URL): Promise<{ result?: string; error?: string }> {
  const net = url.searchParams.get('net')
  const to = url.searchParams.get('to')
  const isCode = url.searchParams.get('m') === 'code'
  const method = isCode ? 'eth_getCode' : 'eth_call'
  const params = isCode ? [to, 'latest'] : [{ to, data: url.searchParams.get('data') }, 'latest']
  try {
    const res = await fetch(`/api/rpc?network=${net}`, {
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

  if (url.pathname === '/api/view') {
    const forceRefresh = url.searchParams.get('refresh') === 'true'
    url.searchParams.delete('refresh')
    // One bucket per connected wallet (`w`), so a wallet's PA + FA self-views live together and can be evicted as a
    // unit on disconnect/switch; global/deterministic reads (no `w`) share one bucket that survives wallet changes.
    const owner = url.searchParams.get('w')
    const bucket = owner ? `view:${owner}` : 'view:shared'
    const cacheKey = new Request(url.href)
    event.respondWith(
      (async () => {
        const cache = await caches.open(bucket)
        if (!forceRefresh) {
          const cached = await cache.match(cacheKey)
          if (cached) return cached
        }
        const out = await dispatchView(url)
        const response = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } })
        if (out.result !== undefined) await cache.put(cacheKey, response.clone())
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

// Clear api-cache and every per-wallet/shared view bucket on new service worker activation. waitUntil holds the
// activating state until the deletes resolve, so clientsClaim() cannot hand a freshly-claimed client a stale entry.
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter(k => k === 'api-cache' || k.startsWith('view')).map(k => caches.delete(k)))
    })()
  )
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
  } else if (data.type === 'evict-view-owner' && typeof data.owner === 'string') {
    event.waitUntil(caches.delete(`view:${data.owner}`))
  }
})
