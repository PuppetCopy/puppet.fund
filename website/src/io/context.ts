import { HUB_CHAIN_ID, TOKEN_META } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { ChainId } from '@puppet/sdk/const'
import { isNativeToken, periodicRun } from '@puppet/sdk/core'
import type { IGetRate, IPriceSource, IRate } from '@puppet/sdk/evaluate'
import type { ITokenRegistry } from '@puppet/sdk/schema'
import {
  cachedTokenRegistry,
  createSdkContext,
  fetchChainLiveness,
  NATIVE_PRECISION, 
  nativeSymbolOf,
  type RelayFeeMap,
  staticTokenRegistry,
  symbolByAddress,
  ttlCached
} from '@puppet/sdk/state'
import { type IStream, map, op, skipRepeatsWith } from 'aelea/stream'
import { recover, state } from 'aelea/stream-extended'
import { type Address, getAddress } from 'viem'
import { publicClientMap } from '../wallet/wallet.js'
import { viewCall } from './onchain/viewRead.js'

const chainIds = Object.keys(publicClientMap).map(Number) as ChainId[]
const USD_PROXY = TOKEN_META.USDC.symbol
const rateCache = new Map<string, IRate>()
const RATE_FAIL_TTL_MS = 5_000
const rateFailUntil = new Map<string, number>()
// Concurrent lookups for the SAME pair share one fetch. Without it, callers that all miss the not-yet-populated
// rateCache in the same tick each fire the request — a stampede, e.g. the per-token relay-fee map all pricing the
// native token (MON/USDC) at once. Keyed by pair (matching rateCache); freshness is still honoured by the cache gate
// above before joining, so a joiner never gets a staler value than it asked for beyond the in-flight fetch itself.
const rateInflight = new Map<string, Promise<IRate>>()
export const getRate: IGetRate = async (asset0, asset1, freshness = 10000) => {
  const key = `${asset0}-${asset1}`
  const cached = rateCache.get(key)
  if (cached && Date.now() - cached.time * 1000 < freshness) return cached
  const failUntil = rateFailUntil.get(key)
  if (failUntil !== undefined && Date.now() < failUntil) throw new Error(`no rate for ${asset0}/${asset1}`)
  const inflight = rateInflight.get(key)
  if (inflight) return inflight

  const pending = (async (): Promise<IRate> => {
    try {
      const res = await fetch(`/api/journal/rate?token0=${asset0}&token1=${asset1}&freshness=${freshness}`)
      if (!res.ok) throw new Error(`no rate for ${asset0}/${asset1}`)
      const data = (await res.json()) as { token0?: string | number; token1?: string | number; time?: number } | null
      if (!data?.token0 || !data?.token1) throw new Error(`no rate for ${asset0}/${asset1}`)
      const rate: IRate = { token0: BigInt(data.token0), token1: BigInt(data.token1), time: data.time ?? 0 }
      rateCache.set(key, rate)
      rateFailUntil.delete(key)
      return rate
    } catch (err) {
      rateFailUntil.set(key, Date.now() + RATE_FAIL_TTL_MS)
      throw err
    } finally {
      rateInflight.delete(key)
    }
  })()
  rateInflight.set(key, pending)
  return pending
}

const HUB_NATIVE_SYMBOL = nativeSymbolOf(HUB_CHAIN_ID)
// The native marker is the same address on every chain, so symbolByAddress can't tell MON from ETH; signed balances and
// fees live on the hub, so price/quote the marker as the hub's native asset (Monad -> MON) rather than the stray ETH.
const priceSymbolOf = (token: Address): string => (isNativeToken(token) ? HUB_NATIVE_SYMBOL : symbolByAddress(token))

export const getPrice = async (token: Address, freshness = 10000): Promise<IPriceSource> => {
  const rate = await getRate(priceSymbolOf(token), USD_PROXY, freshness)
  return { price: rate.token0, time: rate.time }
}

const getTokenPerNativeToken = async (chainId: number, token: Address): Promise<bigint> => {
  const nativeSymbol = nativeSymbolOf(chainId as ChainId)
  const symbol = isNativeToken(token) ? nativeSymbol : symbolByAddress(token)
  if (symbol === nativeSymbol) return NATIVE_PRECISION
  const [native, tok] = await Promise.all([getRate(nativeSymbol, USD_PROXY), getRate(symbol, USD_PROXY)])
  if (native.token0 === 0n || tok.token0 === 0n) throw new Error(`no price for fee token ${token}`)
  return (native.token0 * NATIVE_PRECISION) / tok.token0
}

const context = createSdkContext(
  publicClientMap,

  {
    getRate,
    getTokenPerNativeToken,
    getTokenRegistry: cachedTokenRegistry(async () => {
      const rows: ITokenRegistry[] = []
      await Promise.all(
        [...staticTokenRegistry()].map(async ([chainId, candidates]) => {
          const register = DEPLOYMENTS[`Register:${chainId as ChainId}`]
          if (!register || Number(register.block) === 0) return
          await Promise.all(
            [...candidates.values()].map(async candidate => {
              const cap = (await viewCall({
                chainId: chainId as ChainId,
                address: register.address,
                abi: register.abi,
                functionName: 'tokenCapMap',
                args: [candidate.token],
                global: true
              }).catch(() => null)) as bigint | null
              if (cap === null || cap === 0n) return
              rows.push({ id: candidate.id, chainId: candidate.chainId, token: getAddress(candidate.token), cap })
            })
          )
        })
      )
      return rows
    }),
    getChainLiveness: ttlCached(async () => {
      const health = await fetchChainLiveness({
        chainIds,
        chainHead: (cid: ChainId) => publicClientMap[cid].getBlockNumber()
      })
      const chains = Object.fromEntries(Object.entries(health.chains).filter(([, c]) => c.block.number > 0n))
      return { ...health, chains, reachable: Object.keys(chains).length > 0 }
    }, 1000)
  }
)

export default context

// Fail-SOFT relay-fee map for DISPLAY streams: an unpriceable fee token yields null (-> the editor shows '-' and
// the action is gated) instead of letting the rejection cascade through the reactive graph and flood the console.
// The SUBMIT path must keep using context.getRelayFeeMap directly so signing fails closed on a missing price.
// Display accepts a 5-minute-old gas/rate quote (fees on screen don't chase gas); the step run passes maxAge 0 and
// re-derives fresh at execution.
export const DISPLAY_QUOTE_TTL_MS = 300_000
export const displayRelayFeeMap = (token: Address): Promise<RelayFeeMap | null> =>
  context.getRelayFeeMap(HUB_CHAIN_ID, token, DISPLAY_QUOTE_TTL_MS).then(
    m => m,
    () => null
  )

// Retrying per-token relay-fee stream for DISPLAY pipelines: seeds null immediately (so combine() consumers are never
// blocked on the fetch), retries a failed/unpriceable fetch every interval, and HOLDS the first successful map for the
// stream's lifetime (the submit path re-derives fees at sign time; display does not chase gas). A one-shot
// fromPromise(displayRelayFeeMap) turns one transient oracle failure into a permanent null dead-end — this stream is
// the fix, shared per token.
const relayFeeStreamCache = new Map<Address, IStream<RelayFeeMap | null>>()
const RELAY_FEE_RETRY_MS = 5_000
export function relayFeeFor(token: Address): IStream<RelayFeeMap | null> {
  const key = getAddress(token)
  const existing = relayFeeStreamCache.get(key)
  if (existing) return existing
  const stream = op(
    periodicRun({
      startImmediate: true,
      interval: RELAY_FEE_RETRY_MS,
      actionOp: map(() => displayRelayFeeMap(key))
    }),
    skipRepeatsWith(prev => prev !== null),
    recover({}),
    state(null)
  )
  relayFeeStreamCache.set(key, stream)
  return stream
}
