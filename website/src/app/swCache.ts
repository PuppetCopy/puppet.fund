// The service worker's Cache Storage contract in ONE place. The SW is the writer (it fetches self-state reads and caches
// them, and clears buckets on activation); the page is the reader/evictor (it builds the /api/view URLs, drops a wallet's
// bucket on switch, and stores app-computed blobs alongside the view reads). The URL contract is a build/parse pair over
// module-private literals — the two sides can never silently drift on a string. Dependency-free by design so it bundles
// cleanly into the injectManifest service worker.

// --- bucket names ---
export const API_CACHE = 'api-cache'
const VIEW_PREFIX = 'view:'
// Global / deterministic reads (no wallet owner) share this bucket: it survives wallet switches and is cleared only on a
// new SW activation. Per-wallet self-state lives in viewBucket(owner) and is evicted on disconnect / wallet switch.
export const SHARED_VIEW_BUCKET = `${VIEW_PREFIX}shared`
export const viewBucket = (owner?: string | null): string => (owner ? `${VIEW_PREFIX}${owner}` : SHARED_VIEW_BUCKET)

// --- /api/view wire contract: viewUrl (page builds) / parseViewRequest (SW parses) ---
const VIEW_PATH = '/api/view'

export function viewUrl(p: {
  net: string
  to: string
  data?: string
  code?: boolean
  owner?: string | null
  refresh?: boolean
  // Hex block number to PIN the read at (settlement floor). Stripped from the cache key like `refresh`, so the pinned
  // result lands on the same entry cache-first readers consume — a load-balanced node lagging the settlement block
  // errors loudly instead of silently caching pre-settlement state as fresh. Implies a refresh.
  block?: string
}): string {
  const q = new URLSearchParams()
  q.set('net', p.net)
  q.set('to', p.to)
  if (p.code) q.set('m', 'code')
  else if (p.data !== undefined) q.set('data', p.data)
  if (p.owner) q.set('w', p.owner)
  if (p.block) q.set('b', p.block)
  if (p.refresh) q.set('refresh', 'true')
  return `${VIEW_PATH}?${q}`
}

export interface IViewRequest {
  net: string | null
  to: string | null
  data: string | null
  isCode: boolean
  block: string | null
  bucket: string
  // The cache key with `refresh`/`b` stripped, so a refreshed or block-pinned read lands on the same entry it busts.
  cacheKey: string
  forceRefresh: boolean
}

// Null for any other path. Does not mutate the caller's URL.
export function parseViewRequest(url: URL): IViewRequest | null {
  if (url.pathname !== VIEW_PATH) return null
  const u = new URL(url)
  const block = u.searchParams.get('b')
  const forceRefresh = u.searchParams.get('refresh') === 'true' || block !== null
  u.searchParams.delete('refresh')
  u.searchParams.delete('b')
  return {
    net: u.searchParams.get('net'),
    to: u.searchParams.get('to'),
    data: u.searchParams.get('data'),
    isCode: u.searchParams.get('m') === 'code',
    block,
    bucket: viewBucket(u.searchParams.get('w')),
    cacheKey: u.href,
    forceRefresh
  }
}

// --- eviction message (page → SW) ---
export const EVICT_VIEW_OWNER = 'evict-view-owner'

// --- Cache Storage primitives (work in both the window and the SW global scope) ---
// `caches` is a WindowOrWorkerGlobalScope member — present in the SW and on a secure page, absent under SSR / insecure
// origins — so resolve it defensively off globalThis rather than as a bare ambient global.
const cacheStorage = (): CacheStorage | undefined => (typeof globalThis !== 'undefined' ? globalThis.caches : undefined)

// Drop every bucket the app owns (SW activation, a deploy / universe change): api responses + every view bucket.
export async function deleteManagedCaches(): Promise<void> {
  const store = cacheStorage()
  if (!store) return
  const keys = await store.keys()
  await Promise.all(keys.filter(k => k === API_CACHE || k.startsWith(VIEW_PREFIX)).map(k => store.delete(k)))
}

// A JSON blob keyed in a bucket — the reusable primitive for app-computed state that should ride the view-read cache
// lifecycle (persist across reloads/wallet switches in the shared bucket, wiped on deploy). `key` is a synthetic
// same-origin path matched/put directly on the bucket; it never hits the network.
export async function readCacheJson<T>(bucket: string, key: string, fallback: T): Promise<T> {
  try {
    const hit = await (await cacheStorage()?.open(bucket))?.match(key)
    return hit ? ((await hit.json()) as T) : fallback
  } catch {
    return fallback
  }
}

export async function writeCacheJson<T>(bucket: string, key: string, value: T): Promise<void> {
  try {
    const cache = await cacheStorage()?.open(bucket)
    await cache?.put(key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }))
  } catch {
    // best-effort cache; a fresh read on the next miss still yields correct results
  }
}
