import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import {
  deleteStaleUniverseCaches,
  EVICT_VIEW_OWNER,
  type IViewRequest,
  parseViewRequest,
  stampedJson,
  viewBucket,
  withinMaxAge
} from '../swCache.js'

declare const self: ServiceWorkerGlobalScope & typeof globalThis & { __WB_DISABLE_DEV_LOGS: boolean }

self.__WB_DISABLE_DEV_LOGS = true

precacheAndRoute(self.__WB_MANIFEST)

cleanupOutdatedCaches()

let allowlist: RegExp[] | undefined
if (import.meta.env.DEV) allowlist = [/^\/$/]

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    allowlist,
    denylist: [/^\/assets\//, /^\/api\//]
  })
)

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

  const view = parseViewRequest(url)
  if (!view) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(view.bucket)
      const cached = await cache.match(view.cacheKey)
      if (cached && withinMaxAge(cached, view.maxAge)) return cached
      const out = await dispatchView(view)
      const response = stampedJson(out)
      if (out.result !== undefined) await cache.put(view.cacheKey, response.clone())
      return response
    })()
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(deleteStaleUniverseCaches())
})

clientsClaim()

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
      const client = list.find(c => c.url.startsWith(self.registration.scope)) ?? list[0]
      if (client) {
        await client.focus()
        return
      }
      await self.clients.openWindow(self.registration.scope)
    })
  )
})

self.addEventListener('message', event => {
  const data = event.data
  if (!data) return
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  } else if (data.type === EVICT_VIEW_OWNER && typeof data.owner === 'string') {
    event.waitUntil(caches.delete(viewBucket(data.owner)))
  }
})
