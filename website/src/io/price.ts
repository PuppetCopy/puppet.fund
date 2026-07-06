import { periodicRun } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { type IStream, map, op, skipRepeats } from 'aelea/stream'
import { recover, state } from 'aelea/stream-extended'
import { type Address, formatUnits, getAddress } from 'viem'
import { getPrice } from './context.js'

const PRICE_REFRESH_MS = 10_000

// Reactive per-token price stream for DISPLAY: base-1e30 bigint, or null while it loads / when the oracle can't price
// it. Polls the shared getPrice (so display and NAV read one source), de-duped per token; getPrice resolves native and
// hub-wrapped variants itself.
const priceStreamCache = new Map<Address, IStream<bigint | null>>()
export function priceFor(token: Address): IStream<bigint | null> {
  const key = getAddress(token)
  const existing = priceStreamCache.get(key)
  if (existing) return existing
  const stream = op(
    periodicRun({
      startImmediate: true,
      interval: PRICE_REFRESH_MS,
      // Display fails SOFT: an unpriceable token (oracle has no market yet, e.g. a thin new listing) yields null -> '-'
      // rather than throwing a render error. NAV/attestation still reads getRate directly and fails closed.
      actionOp: map(() => getPrice(key, PRICE_REFRESH_MS).then(source => source.price).catch(() => null))
    }),
    skipRepeats,
    recover({}),
    state(null)
  )
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
