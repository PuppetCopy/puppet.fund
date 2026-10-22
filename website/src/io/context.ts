import { createGetRate } from '@puppet/sdk/client'
import { type ChainId, USD_DECIMALS, USD_SYMBOL } from '@puppet/sdk/const'
import type { IGetRate, IPriceSource } from '@puppet/sdk/evaluate'
import { usdPriceFromRate } from '@puppet/sdk/evaluate'
import { createSdkContext, fetchChainLiveness, symbolOf, ttlCached } from '@puppet/sdk/state'
import type { Address } from 'viem'
import { ENDPOINTS } from '../app/endpoints.js'
import { publicClientMap } from '../wallet/wallet.js'
import { uiStorage } from '@/ui-storage'
import { notLocal } from './datastore/reads.js'

const chainIds = Object.keys(publicClientMap).map(Number) as ChainId[]
const rates = createGetRate(ENDPOINTS.oracle, {
  read: async pair => (await uiStorage.device.read<unknown>(`rate:${pair}`))?.value ?? null,
  write: (pair, data) => void uiStorage.device.write(`rate:${pair}`, data)
})
export const getRate = rates.getRate

export const PRICE_FRESHNESS_MS = 10_000

export const getPrice = async (chainId: ChainId, token: Address): Promise<IPriceSource> => {
  const rate = await getRate(symbolOf(chainId, token), USD_SYMBOL, PRICE_FRESHNESS_MS)
  return { price: usdPriceFromRate(rate, USD_DECIMALS), time: rate.time }
}

export const localGetRate: IGetRate = (asset0, asset1) => rates.cachedRate(asset0, asset1).then(rate => rate ?? notLocal)

export const localPrice = (chainId: ChainId, token: Address): Promise<IPriceSource> =>
  rates.cachedRate(symbolOf(chainId, token), USD_SYMBOL).then(rate => (rate === null ? notLocal : { price: usdPriceFromRate(rate, USD_DECIMALS), time: rate.time }))

const context = createSdkContext(
  publicClientMap,

  {
    getRate,
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
