export function ttlCached<T>(fetcher: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let inflight: Promise<T> | null = null
  let expiry = 0
  return () => {
    const now = Date.now()
    if (inflight === null || now >= expiry) {
      expiry = now + ttlMs
      const pending = fetcher()
      pending.catch(() => {
        if (inflight === pending) {
          inflight = null
          expiry = 0
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
  const byKey = new Map<K, (ttlMs?: number) => Promise<T>>()
  return (key: K, ttlMs?: number) => {
    let getter = byKey.get(key)
    if (getter === undefined) {
      getter = ttlCached((...arg) => fetcher(key, ...arg), defaultTtlMs)
      byKey.set(key, getter)
    }
    return getter(ttlMs)
  }
}
