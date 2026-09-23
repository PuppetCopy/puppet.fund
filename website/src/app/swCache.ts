import { PROTOCOL } from '@puppet/contracts/const'

const UNIVERSE = `u${PROTOCOL.version}:`
const VIEW_PREFIX = `${UNIVERSE}view:`
export const SHARED_VIEW_BUCKET = `${VIEW_PREFIX}shared`
export const viewBucket = (owner?: string | null): string => (owner ? `${VIEW_PREFIX}${owner}` : SHARED_VIEW_BUCKET)

const VIEW_PATH = '/api/view'

const CACHED_AT_HEADER = 'x-cached-at'

export function stampedJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', [CACHED_AT_HEADER]: String(Date.now()) }
  })
}

export function withinMaxAge(cached: Response, maxAge: number | undefined): boolean {
  if (maxAge === undefined) return true
  const stamp = Number(cached.headers.get(CACHED_AT_HEADER))
  return Number.isFinite(stamp) && Date.now() - stamp <= maxAge
}

export function viewUrl(p: {
  net: string
  to: string
  data?: string
  owner?: string | null
  maxAge?: number
  block?: string
}): string {
  const q = new URLSearchParams()
  q.set('net', p.net)
  q.set('to', p.to)
  if (p.data !== undefined) q.set('data', p.data)
  if (p.owner) q.set('w', p.owner)
  if (p.block) q.set('b', p.block)
  if (p.maxAge !== undefined) q.set('ttl', String(p.maxAge))
  return `${VIEW_PATH}?${q}`
}

export interface IViewRequest {
  net: string | null
  to: string | null
  data: string | null
  block: string | null
  bucket: string
  cacheKey: string
  maxAge: number | undefined
}

export function parseViewRequest(url: URL): IViewRequest | null {
  if (url.pathname !== VIEW_PATH) return null
  const u = new URL(url)
  const block = u.searchParams.get('b')
  const ttl = u.searchParams.get('ttl')
  u.searchParams.delete('ttl')
  u.searchParams.delete('b')
  return {
    net: u.searchParams.get('net'),
    to: u.searchParams.get('to'),
    data: u.searchParams.get('data'),
    block,
    bucket: viewBucket(u.searchParams.get('w')),
    cacheKey: u.href,
    maxAge: block !== null ? 0 : ttl === null ? undefined : Number(ttl)
  }
}

export const EVICT_VIEW_OWNER = 'evict-view-owner'

const cacheStorage = (): CacheStorage | undefined => (typeof globalThis !== 'undefined' ? globalThis.caches : undefined)

export async function deleteStaleUniverseCaches(): Promise<void> {
  const store = cacheStorage()
  if (!store) return
  const keys = await store.keys()
  await Promise.all(
    keys.filter(k => !k.startsWith(UNIVERSE) && /^u\d+:/.test(k)).map(k => store.delete(k))
  )
}
