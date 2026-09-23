import { TOKEN_META } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { ChainId } from '@puppet/sdk/const'
import type { IGetRate, IPriceSource, IRate } from '@puppet/sdk/evaluate'
import { usdPriceFromRate } from '@puppet/sdk/evaluate'
import {
  cachedTokenRegistry,
  candidateTokens,
  createSdkContext,
  fetchChainLiveness,
  type ITokenRegistry,
  symbolOf,
  TOKEN_REGISTRY_TTL_MS,
  ttlCached
} from '@puppet/sdk/state'
import { type Address, getAddress } from 'viem'
import { publicClientMap } from '../wallet/wallet.js'
import { viewCall } from './onchain/viewRead.js'

const chainIds = Object.keys(publicClientMap).map(Number) as ChainId[]
const USD_PROXY = TOKEN_META.USDC.symbol
const rateCache = new Map<string, IRate>()
const rateInflight = new Map<string, Promise<IRate>>()
export const getRate: IGetRate = async (asset0, asset1, freshness = 10000) => {
  const key = `${asset0}-${asset1}`
  const cached = rateCache.get(key)
  if (cached && Date.now() - cached.time * 1000 < freshness) return cached
  const inflight = rateInflight.get(key)
  if (inflight) return inflight

  const pending = (async (): Promise<IRate> => {
    try {
      const res = await fetch(`/api/oracle/rate?token0=${asset0}&token1=${asset1}&freshness=${freshness}`)
      if (!res.ok) {
        const reason = res.headers.get('content-type')?.startsWith('text/plain') ? await res.text() : ''
        console.error(`[rate] ${asset0}/${asset1} refused (${res.status}) at freshness ${freshness}ms${reason ? `: ${reason}` : ''}`)
        throw new Error(`no rate for ${asset0}/${asset1} (${res.status})${reason ? `: ${reason}` : ''}`)
      }
      const data = (await res.json()) as { token0?: string | number; token1?: string | number; time?: number } | null
      if (!data?.token0 || !data?.token1 || !data.time) throw new Error(`no rate for ${asset0}/${asset1}`)
      const rate: IRate = { token0: BigInt(data.token0), token1: BigInt(data.token1), time: data.time }
      rateCache.set(key, rate)
      return rate
    } finally {
      rateInflight.delete(key)
    }
  })()
  rateInflight.set(key, pending)
  return pending
}

export const getPrice = async (chainId: ChainId, token: Address, freshness = 10000): Promise<IPriceSource> => {
  const rate = await getRate(symbolOf(chainId, token), USD_PROXY, freshness)
  return { price: usdPriceFromRate(rate, TOKEN_META.USDC.decimals), time: rate.time }
}

const context = createSdkContext(
  publicClientMap,

  {
    getRate,
    getTokenRegistry: cachedTokenRegistry(async () => {
      const rows: ITokenRegistry[] = []
      await Promise.all(
        [...candidateTokens()].map(async ([chainId, candidates]) => {
          const register = DEPLOYMENTS[`Register:${chainId}`]
          if (!register || Number(register.block) === 0) return
          await Promise.all(
            candidates.map(async candidate => {
              const [registeredCap, tokenId] = await Promise.all([
                viewCall({
                  chainId: chainId,
                  address: register.address,
                  abi: register.abi,
                  functionName: 'capMap',
                  args: [candidate],
                  global: true,
                  maxAge: TOKEN_REGISTRY_TTL_MS
                }),
                viewCall({
                  chainId: chainId,
                  address: register.address,
                  abi: register.abi,
                  functionName: 'tokenIdMap',
                  args: [candidate],
                  global: true,
                  maxAge: TOKEN_REGISTRY_TTL_MS
                })
              ])
              if (registeredCap === 0n) return
              rows.push({
                id: `${chainId}:${candidate}`,
                chainId: BigInt(chainId),
                token: getAddress(candidate),
                registeredCap,
                tokenId
              })
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

export const DISPLAY_QUOTE_TTL_MS = 300_000
