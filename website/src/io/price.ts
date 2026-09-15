import type { ChainId } from '@puppet/sdk/const'
import { periodicRun } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { type ITokenMetaKey, tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { type IStream, just, map, op, skipRepeats } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, formatUnits, } from 'viem'
import { getPrice } from './context.js'

const PRICE_REFRESH_MS = 10_000

const priceStreamCache = new Map<ITokenMetaKey, IStream<bigint | null>>()
export function priceFor(chainId: ChainId, token: Address): IStream<bigint | null> {
  const key = tokenMetaKey(chainId, token)
  const existing = priceStreamCache.get(key)
  if (existing) return existing
  const stream = tokenMetaByChainToken.has(key)
    ? op(
        periodicRun({
          startImmediate: true,
          interval: PRICE_REFRESH_MS,
          actionOp: map(() =>
            getPrice(chainId, token, PRICE_REFRESH_MS).then(
              source => source.price,
              (): null => null
            )
          )
        }),
        skipRepeats,
        state(null)
      )
    : just<bigint | null>(null)
  priceStreamCache.set(key, stream)
  return stream
}

export function formatUsd(amount: bigint, price: bigint | null): string {
  if (price === null) return '-'
  if (amount === 0n) return '$0.00'
  const num = Number(formatUnits(amount * price, USD_PRICE_DECIMALS))
  const magnitude = Math.abs(num)
  if (magnitude > 0 && magnitude < 0.01) {
    const decimals = Math.min(-Math.floor(Math.log10(magnitude)) + 1, 18)
    return `$${num.toFixed(decimals)}`
  }
  return `$${num.toFixed(2)}`
}
