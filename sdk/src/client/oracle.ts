import type { IGetRate, IRate } from '../evaluate/index.js'

export interface IRateStore {
  read(pair: string): Promise<unknown>
  write(pair: string, data: unknown): void
}

const MAX_CLOCK_SKEW_MS = 60_000

export function createGetRate(oracleUrl: string, store: IRateStore) {
  const rateCache = new Map<string, IRate>()
  const rateInflight = new Map<string, Promise<IRate>>()
  const storedRead = new Map<string, Promise<IRate | null>>()
  const urlOf = (asset0: string, asset1: string, freshness: number): string => `${oracleUrl}/rate?token0=${asset0}&token1=${asset1}&freshness=${freshness}`
  const rateOf = (asset0: string, asset1: string, data: unknown): IRate => {
    const { token0, token1, time } = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
    if ((typeof token0 !== 'string' && typeof token0 !== 'number') || (typeof token1 !== 'string' && typeof token1 !== 'number') || typeof time !== 'number' || !token0 || !token1 || !time) {
      throw new Error(`no rate for ${asset0}/${asset1}`)
    }
    return { token0: BigInt(token0), token1: BigInt(token1), time }
  }

  const cachedRate = (asset0: string, asset1: string): Promise<IRate | null> => {
    const pair = `${asset0}-${asset1}`
    const held = rateCache.get(pair)
    if (held !== undefined) return Promise.resolve(held)
    const read = storedRead.get(pair) ?? store.read(pair).then(data => (data === null ? null : rateOf(asset0, asset1, data)))
    storedRead.set(pair, read)
    return read
  }

  const getRate: IGetRate = async (asset0, asset1, freshness) => {
    const key = `${asset0}-${asset1}`
    const cached = rateCache.get(key)
    if (cached && Date.now() - cached.time * 1000 < freshness && cached.time * 1000 - Date.now() < MAX_CLOCK_SKEW_MS) return cached
    const inflight = rateInflight.get(key)
    if (inflight) return inflight

    const stored = cachedRate(asset0, asset1)
    const pending = (async (): Promise<IRate> => {
      try {
        const known = await stored
        if (known !== null && Date.now() - known.time * 1000 < freshness && known.time * 1000 - Date.now() < MAX_CLOCK_SKEW_MS) {
          rateCache.set(key, known)
          return known
        }
        const res = await fetch(urlOf(asset0, asset1, freshness))
        if (!res.ok) {
          const reason = res.headers.get('content-type')?.startsWith('text/plain') ? await res.text() : ''
          console.error(`[rate] ${asset0}/${asset1} refused (${res.status}) at freshness ${freshness}ms${reason ? `: ${reason}` : ''}`)
          throw new Error(`no rate for ${asset0}/${asset1} (${res.status})${reason ? `: ${reason}` : ''}`)
        }
        const data: unknown = await res.json()
        const rate = rateOf(asset0, asset1, data)
        rateCache.set(key, rate)
        store.write(key, data)
        return rate
      } finally {
        rateInflight.delete(key)
      }
    })()
    rateInflight.set(key, pending)
    return pending
  }

  return { getRate, cachedRate }
}
