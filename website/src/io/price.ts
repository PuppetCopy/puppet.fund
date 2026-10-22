import type { ChainId } from '@puppet/sdk/const'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import { type IStream, just, op } from 'aelea/stream'
import { type Address, formatUnits } from 'viem'
import { getPrice, localPrice } from './context.js'
import { answerState, localFirst } from './datastore/reads.js'

export const freshPrice = (chainId: ChainId, token: Address): Promise<bigint | null> =>
  tokenMetaByChainToken.has(tokenMetaKey(chainId, token)) ? getPrice(chainId, token).then(source => source.price) : Promise.resolve(null)

export const priceFor = (chainId: ChainId, token: Address): IStream<Promise<bigint | null>> =>
  tokenMetaByChainToken.has(tokenMetaKey(chainId, token))
    ? op(
        localFirst(
          () => localPrice(chainId, token).then(source => source.price),
          () => freshPrice(chainId, token)
        ),
        answerState
      )
    : just(Promise.resolve(null))

export const usdOf = (amount: bigint, price: Promise<bigint | null>): Promise<string> => price.then(at => formatUsd(amount, at))

const USD_CENTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const MINUS = '\u2212'
export const signedDollar = (sign: string): string => (sign === '' ? '$' : `${sign}\u2060$`)

export function formatUsdNumber(num: number): string {
  const magnitude = Math.abs(num)
  const dollar = signedDollar(num < 0 ? MINUS : '')
  if (magnitude > 0 && magnitude < 0.01) {
    const decimals = Math.min(-Math.floor(Math.log10(magnitude)) + 1, 18)
    return `${dollar}${magnitude.toFixed(decimals)}`
  }
  return `${dollar}${USD_CENTS.format(magnitude)}`
}

export function formatUsd(amount: bigint, price: bigint | null): string {
  if (price === null) return '-'
  if (amount === 0n) return '$0.00'
  return formatUsdNumber(Number(formatUnits(amount * price, USD_PRICE_DECIMALS)))
}

