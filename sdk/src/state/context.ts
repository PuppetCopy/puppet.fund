import type { Address, } from 'viem'
import { getBlockNumber as fetchBlockNumber, getGasPrice as fetchGasPrice } from 'viem/actions'
import { accountNonce } from '../account/accountLog.js'
import { type IAcrossTiming, readAcrossBuffers } from '../intent/route/acrossDeposit.js'

export type { IAcrossTiming }

import type { ChainId } from '../const/index.js'
import type { IGetRate } from '../evaluate/index.js'
import { ttlCached, ttlCachedByKey } from './cache.js'
import { type FeeClient, feeConverter, type IFeeConvert, type IRelayFeeQuote, relayFeeOf } from './fee.js'
import type { IChainLiveness } from './health.js'

const ACROSS_BUFFER_TTL_MS = 60 * 60 * 1000

export function createSdkContext(
  publicClients: Record<number, FeeClient>,
  config: {
    getRate: IGetRate
    getChainLiveness?: () => Promise<IChainLiveness>
  }
) {
  const { getRate } = config
  const getChainLiveness =
    config.getChainLiveness ??
    ((): Promise<IChainLiveness> => {
      throw new Error('createSdkContext: getChainLiveness was not configured')
    })

  const clientFor = (chainId: number): FeeClient => {
    const client = publicClients[chainId]
    if (!client) throw new Error(`createSdkContext: no public client for chain ${chainId}`)
    return client
  }

  const getChainGasPrice = ttlCachedByKey(200, (chainId: number) => fetchGasPrice(clientFor(chainId)))
  const getBlockNumber = ttlCachedByKey(350, (chainId: number) => fetchBlockNumber(clientFor(chainId)))

  const acrossTimingByChain = new Map<number, () => Promise<IAcrossTiming>>()
  const getAcrossTiming = (chainId: ChainId): Promise<IAcrossTiming> => {
    let read = acrossTimingByChain.get(chainId)
    if (!read) {
      read = ttlCached(
        () =>
          readAcrossBuffers(clientFor(chainId), chainId),
        ACROSS_BUFFER_TTL_MS
      )
      acrossTimingByChain.set(chainId, read)
    }
    return read()
  }

  const getFeeConverter = (chainId: ChainId, token: Address, maxStaleMs: number): Promise<IFeeConvert> =>
    feeConverter(getRate, chainId, token, maxStaleMs)

  const getAccountNonce = (chainId: number, account: Address): Promise<bigint> =>
    accountNonce(clientFor(chainId), account)

  const getRelayFeeQuote = async (chainId: ChainId, token: Address, maxStaleMs: number): Promise<IRelayFeeQuote> => {
    const convert = await getFeeConverter(chainId, token, maxStaleMs).catch((e: unknown) => {
      throw new Error(`relayFee rate(chain ${chainId}, token ${token}): ${e instanceof Error ? e.message : String(e)}`)
    })
    return (kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength) =>
      relayFeeOf(convert, chainId, kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength)
  }

  return {
    getRate,
    getAcrossTiming,
    getChainGasPrice,
    getFeeConverter,
    getRelayFeeQuote,
    getAccountNonce,
    getBlockNumber,
    getChainLiveness
  }
}
