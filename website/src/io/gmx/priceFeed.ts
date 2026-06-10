interface IGmxOraclePrice {
  updateTimestamp: number
  token: Address
  price: bigint
}

import { getMappedValueFallback, periodicRun } from '@puppet/sdk/core'
import { type IStream, map, op, skipRepeats } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, formatUnits } from 'viem'

// Configuration
const PRICE_FEED_CONFIG = {
  UPDATE_INTERVAL_MS: 10_000,
  API_URL: 'https://arbitrum-api.gmxinfra.io/signed_prices/latest'
} as const

// Arbitrum URL: https://arbitrum-api.gmxinfra.io/signed_prices/latest
// Avalanche URL: https://avalanche-api.gmxinfra.io/signed_prices/latest
interface IGmxSignedPriceData {
  id: string // "4003688959"
  minBlockNumber: number // null
  minBlockHash: string | null // null
  oracleDecimals: number | null // null
  tokenSymbol: string // "ETH"
  tokenAddress: Address // "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
  minPrice: number | null // null
  maxPrice: number | null // null
  signer: string | null // null
  signature: string | null // null
  signatureWithoutBlockHash: string | null // null
  createdAt: string // "2025-07-28T19:30:24.419Z"
  minBlockTimestamp: number | null // 1753731023 (seconds - Unix timestamp)
  oracleKeeperKey: string // "realtimeFeed"
  maxBlockTimestamp: number // 1753731023 (seconds - Unix timestamp)
  maxBlockNumber: number // null
  maxBlockHash: string // null
  maxPriceFull: string // "3791200513446191" (price with full precision)
  minPriceFull: string // "3791014710710536" (price with full precision)
  oracleKeeperRecordId: string | null // null
  oracleKeeperFetchType: string // "ws"
  oracleType: string // "realtimeFeed2"
  blob: string // "0x00094baebfda9b87..." (binary data)
}

async function querySignedPrices(): Promise<IGmxSignedPriceData[]> {
  try {
    const response = await fetch(PRICE_FEED_CONFIG.API_URL)

    if (!response.ok) {
      throw new Error(`GMX signed prices API error! status: ${response.status}`)
    }

    const data = (await response.json()) as { signedPrices: IGmxSignedPriceData[] }
    return data.signedPrices || []
  } catch (error) {
    console.error('Error fetching GMX signed prices:', error)
    return []
  }
}

export const latestPriceMap = op(
  periodicRun({
    startImmediate: true,
    interval: PRICE_FEED_CONFIG.UPDATE_INTERVAL_MS,
    actionOp: map(async () => {
      const signedPrices = await querySignedPrices()
      const out: Record<Address, IGmxOraclePrice> = {}
      for (const item of signedPrices) {
        const timestampMs = (item.minBlockTimestamp || item.maxBlockTimestamp) * 1000
        const existing = out[item.tokenAddress]
        if (existing && existing.updateTimestamp >= timestampMs) continue
        out[item.tokenAddress] = {
          updateTimestamp: timestampMs,
          token: item.tokenAddress,
          price: BigInt(item.maxPriceFull)
        }
      }
      return out
    })
  }),
  state()
)

const priceForCache = new Map<Address, IStream<bigint | null>>()
export function priceFor(address: Address): IStream<bigint | null> {
  const existing = priceForCache.get(address)
  if (existing) return existing
  const stream = op(
    latestPriceMap,
    map(pm => getMappedValueFallback(pm, address, null)?.price ?? null),
    skipRepeats,
    state(null)
  )
  priceForCache.set(address, stream)
  return stream
}

export function formatUsd(amount: bigint, price: bigint | null): string {
  if (price === null) return '-'
  if (amount === 0n) return '$0.00'
  const num = Number(formatUnits(amount * price, 30))
  if (num > 0 && num < 0.01) return '< $0.01'
  return `$${num.toFixed(2)}`
}
