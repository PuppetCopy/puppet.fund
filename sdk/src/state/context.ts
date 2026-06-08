import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { Hex } from 'viem'
import { getGasPrice as fetchGasPrice } from 'viem/actions'
import type { ChainId } from '../const/index.js'
import { ttlCached, ttlCachedByKey } from './cache.js'
import {
  type FeeClient,
  getRelayFeeQuoteSource,
  getTokenPerEthForId,
  type RelayFeeMap,
  SUPPORTED_FEE_TOKEN_IDS
} from './fee.js'
import type { IIndexerClient } from './shared.js'
import { type ITokenRegistryMap, loadTokenRegistry } from './tokenRegistry.js'

export interface ISdkContextConfig {
  sqlClient: IIndexerClient
  publicClients: Record<number, FeeClient>
  homeChainId?: number
  gasTtlMs?: number
  rateTtlMs?: number
  feeTokenIds?: readonly Hex[]
}

export interface ISdkContext {
  getTokenRegistry: () => Promise<ITokenRegistryMap>
  getGasPrice: (chainId: number) => Promise<bigint>
  getGasPriceByChain: () => Promise<Record<ChainId, bigint>>
  getTokenPerEth: (baseTokenId: Hex) => Promise<bigint>
  getTokenPerEthByToken: () => Promise<Record<Hex, bigint>>
  getRelayFeeMap: (baseTokenId: Hex) => Promise<RelayFeeMap>
}

export function createSdkContext(config: ISdkContextConfig): ISdkContext {
  const {
    sqlClient,
    publicClients,
    homeChainId = HUB_CHAIN_ID,
    gasTtlMs = 200,
    rateTtlMs = 60_000,
    feeTokenIds = SUPPORTED_FEE_TOKEN_IDS
  } = config

  const clientFor = (chainId: number): FeeClient => {
    const client = publicClients[chainId]
    if (!client) throw new Error(`createSdkContext: no public client for chain ${chainId}`)
    return client
  }
  const homeClient = clientFor(homeChainId)

  const getTokenRegistry = ttlCached(() => loadTokenRegistry(sqlClient), Number.POSITIVE_INFINITY)
  const getGasPrice = ttlCachedByKey((chainId: number) => fetchGasPrice(clientFor(chainId)), gasTtlMs)
  const getTokenPerEth = ttlCachedByKey((baseTokenId: Hex) => getTokenPerEthForId(baseTokenId, homeClient), rateTtlMs)

  const getGasPriceByChain = ttlCached(async (): Promise<Record<ChainId, bigint>> => {
    const entries = await Promise.all(
      Object.keys(publicClients).map(async chainId => [Number(chainId), await getGasPrice(Number(chainId))] as const)
    )
    return Object.fromEntries(entries) as Record<ChainId, bigint>
  }, gasTtlMs)

  const getTokenPerEthByToken = ttlCached(async (): Promise<Record<Hex, bigint>> => {
    const entries = await Promise.all(feeTokenIds.map(async token => [token, await getTokenPerEth(token)] as const))
    return Object.fromEntries(entries) as Record<Hex, bigint>
  }, rateTtlMs)

  const getRelayFeeMap = async (baseTokenId: Hex): Promise<RelayFeeMap> => {
    const [gas, rate] = await Promise.all([getGasPrice(homeChainId), getTokenPerEth(baseTokenId)])
    return getRelayFeeQuoteSource(rate, gas)
  }

  return {
    getTokenRegistry,
    getGasPrice,
    getGasPriceByChain,
    getTokenPerEth,
    getTokenPerEthByToken,
    getRelayFeeMap
  }
}
