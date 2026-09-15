import type { IGetRate, IRate } from './types.js'

const RATE_TIMEOUT_MS = 12_000

export function oracleRate(url: string): IGetRate {
  return async (asset0, asset1, freshness = 120_000): Promise<IRate> => {
    const res = await fetch(`${url}/rate?token0=${asset0}&token1=${asset1}&freshness=${freshness}`, {
      signal: AbortSignal.timeout(RATE_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`oracle ${url} answered ${res.status} for ${asset0}/${asset1}: ${await res.text()}`)
    const data = (await res.json()) as { token0?: string; token1?: string; time?: number } | null
    if (!data?.token0 || !data?.token1 || !data.time) throw new Error(`oracle ${url} returned no rate for ${asset0}/${asset1}`)
    return { token0: BigInt(data.token0), token1: BigInt(data.token1), time: data.time }
  }
}
