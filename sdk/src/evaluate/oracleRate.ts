import type { IGetRate, IRate } from './types.js'

const RATE_TIMEOUT_MS = 12_000

export function oracleRate(url: string): IGetRate {
  return async (asset0, asset1, freshness): Promise<IRate> => {
    const res = await fetch(`${url}/rate?token0=${asset0}&token1=${asset1}&freshness=${freshness}`, {
      signal: AbortSignal.timeout(RATE_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`oracle ${url} answered ${res.status} for ${asset0}/${asset1}: ${await res.text()}`)
    const data = (await res.json()) as { token0?: string; token1?: string; time?: number } | null
    if (!data?.token0 || !data?.token1 || !data.time) throw new Error(`oracle ${url} returned no rate for ${asset0}/${asset1}`)
    return { token0: BigInt(data.token0), token1: BigInt(data.token1), time: data.time }
  }
}

export interface IOracleSnapshot {
  time: number
  freshness: number
  rates: ({ symbol: string; token0: bigint; token1: bigint; time: number } | { symbol: string; refused: string })[]
  markets: { market: string; median: { price: bigint; time: number } | null; sources: { id: string; price: bigint | null; time: number | null }[] }[]
}

export async function oracleSnapshot(url: string, freshness: number): Promise<IOracleSnapshot> {
  const res = await fetch(`${url}/snapshot?freshness=${freshness}`, { signal: AbortSignal.timeout(RATE_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`oracle ${url} answered ${res.status} for its snapshot: ${await res.text()}`)
  const data = (await res.json()) as {
    time: number
    freshness: number
    rates: ({ symbol: string; token0: string; token1: string; time: number } | { symbol: string; refused: string })[]
    markets: { market: string; median: { price: string; time: number } | null; sources: { id: string; price: string | null; time: number | null }[] }[]
  }
  return {
    time: data.time,
    freshness: data.freshness,
    rates: data.rates.map(rate => ('refused' in rate ? rate : { symbol: rate.symbol, token0: BigInt(rate.token0), token1: BigInt(rate.token1), time: rate.time })),
    markets: data.markets.map(market => ({
      market: market.market,
      median: market.median === null ? null : { price: BigInt(market.median.price), time: market.median.time },
      sources: market.sources.map(source => ({ id: source.id, price: source.price === null ? null : BigInt(source.price), time: source.time }))
    }))
  }
}
