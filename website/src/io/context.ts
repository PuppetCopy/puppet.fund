import { HUB_CHAIN_ID, TOKEN_META } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { ChainId } from '@puppet/sdk/const'
import type { IGetRate, IPriceSource, IRate } from '@puppet/sdk/evaluate'
import type { ITokenRegistry } from '@puppet/sdk/schema'
import {
  cachedTokenRegistry,
  createSdkContext,
  fetchChainLiveness,
  nativeSymbolOf,
  type RelayFeeMap,
  staticTokenRegistry,
  symbolByAddress,
  ttlCached,
  NATIVE_PRECISION
} from '@puppet/sdk/state'
import { type Address, getAddress } from 'viem'
import { publicClientMap } from '../wallet/wallet.js'
import { viewCall } from './onchain/viewRead.js'

const chainIds = Object.keys(publicClientMap).map(Number) as ChainId[]
const USD_PROXY = TOKEN_META.USDC.symbol
const rateCache = new Map<string, IRate>()
const RATE_FAIL_TTL_MS = 5_000
const rateFailUntil = new Map<string, number>()
export const getRate: IGetRate = async (asset0, asset1, freshness = 10000) => {
  const key = `${asset0}-${asset1}`
  const cached = rateCache.get(key)
  if (cached && Date.now() - cached.time * 1000 < freshness) return cached
  const failUntil = rateFailUntil.get(key)
  if (failUntil !== undefined && Date.now() < failUntil) throw new Error(`no rate for ${asset0}/${asset1}`)

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
  }
}

export const getPrice = async (token: Address, freshness = 10000): Promise<IPriceSource> => {
  const rate = await getRate(symbolByAddress(token), USD_PROXY, freshness)
  return { price: rate.token0, time: rate.time }
}

const HUB_NATIVE_SYMBOL = nativeSymbolOf(HUB_CHAIN_ID)
const getTokenPerNativeToken = async (token: Address): Promise<bigint> => {
  const symbol = symbolByAddress(token)
  if (symbol === HUB_NATIVE_SYMBOL) return NATIVE_PRECISION
  const [native, tok] = await Promise.all([getRate(HUB_NATIVE_SYMBOL, USD_PROXY), getRate(symbol, USD_PROXY)])
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
export const displayRelayFeeMap = (token: Address): Promise<RelayFeeMap | null> =>
  context.getRelayFeeMap(token).then(
    m => m,
    () => null
  )
