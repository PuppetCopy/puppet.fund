import type { ChainId } from '@puppet/sdk/const'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { type ITokenMetaKey, tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { continueWith, type IStream, just, op, skipRepeats, switchMap, wait } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, formatUnits, } from 'viem'
import { getPrice } from './context.js'

const PRICE_REFRESH_MS = 10_000

const refreshPrice = (chainId: ChainId, token: Address, delay: number): IStream<bigint | null> =>
  continueWith(
    () => refreshPrice(chainId, token, PRICE_REFRESH_MS),
    switchMap(
      () =>
        getPrice(chainId, token, PRICE_REFRESH_MS).then(
          source => source.price,
          (): null => null
        ),
      wait(delay)
    )
  )

const priceStreamCache = new Map<ITokenMetaKey, IStream<bigint | null>>()
export function priceFor(chainId: ChainId, token: Address): IStream<bigint | null> {
  const key = tokenMetaKey(chainId, token)
  const existing = priceStreamCache.get(key)
  if (existing) return existing
  const stream = tokenMetaByChainToken.has(key)
    ? op(
        refreshPrice(chainId, token, 0),
        skipRepeats,
        state(null)
      )
    : just<bigint | null>(null)
  priceStreamCache.set(key, stream)
  return stream
}

export function formatUsdNumber(num: number): string {
  const magnitude = Math.abs(num)
  const sign = num < 0 ? '-' : ''
  if (magnitude > 0 && magnitude < 0.01) {
    const decimals = Math.min(-Math.floor(Math.log10(magnitude)) + 1, 18)
    return `${sign}$${magnitude.toFixed(decimals)}`
  }
  return `${sign}$${magnitude.toFixed(2)}`
}

export function formatUsd(amount: bigint, price: bigint | null): string {
  if (price === null) return '-'
  if (amount === 0n) return '$0.00'
  return formatUsdNumber(Number(formatUnits(amount * price, USD_PRICE_DECIMALS)))
}
