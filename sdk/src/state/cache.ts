export const MIN_TTL_MS = 20

const assertTtl = (ms: number): void => {
  if (ms < MIN_TTL_MS) throw new Error(`ttl/maxAge ${ms}ms is below the ${MIN_TTL_MS}ms floor`)
}

export function ttlCached<T>(fetcher: () => Promise<T>, ttlMs: number): (maxAgeMs?: number) => Promise<T> {
  assertTtl(ttlMs)
  let inflight: Promise<T> | null = null
  let fetchedAt = 0
  return (maxAgeMs = ttlMs) => {
    if (maxAgeMs !== ttlMs) assertTtl(maxAgeMs)
    const now = Date.now()
    if (inflight === null || now - fetchedAt > maxAgeMs) {
      fetchedAt = now
      const pending = fetcher()
      pending.catch(() => {
        if (inflight === pending) {
          inflight = null
          fetchedAt = 0
        }
      })
      inflight = pending
    }
    return inflight
  }
}

export function ttlCachedByKey<K, T>(
  defaultTtlMs: number,
  fetcher: (key: K) => Promise<T>
) {
  const byKey = new Map<K, (maxAgeMs?: number) => Promise<T>>()
  return (key: K, maxAgeMs?: number) => {
    let getter = byKey.get(key)
    if (getter === undefined) {
      getter = ttlCached(() => fetcher(key), defaultTtlMs)
      byKey.set(key, getter)
    }
    return getter(maxAgeMs)
  }
}
