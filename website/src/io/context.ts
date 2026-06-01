import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import {
  createGasPriceSource,
  createIndexerHealthSource,
  createRelayFeeMapByTokenSource,
  loadTokenRegistry,
  type RelayFeeMap
} from '@puppet/sdk/state'
import { type IStream, just, map, op } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import type { Address, Hex } from 'viem'
import { homePublicClient } from '../wallet/index.js'
import { sqlClient } from './indexer/sql.js'

export const tokenRegistryQuery = just(loadTokenRegistry(sqlClient))

export const registeredCollateralListQuery: IStream<Promise<Address[]>> = map(
  registry => registry.then(reg => [...(reg.get(HUB_CHAIN_ID)?.values() ?? [])].map(info => info.token)),
  tokenRegistryQuery
)
export const indexerHealth = op(createIndexerHealthSource(sqlClient, 1000), state())
export const gasPrice = op(createGasPriceSource(homePublicClient, 10_000), state())

// Per-baseTokenId fee map stream. Each entry is independent — a USDC editor only
// recomputes when USDC rate or gas changes; a WETH editor only on gas changes.
// Map structure is static; values are reactive streams.
export const relayFeeMapByToken: Map<Hex, IStream<RelayFeeMap>> = createRelayFeeMapByTokenSource(
  gasPrice,
  homePublicClient
)

export function relayFeeMapForToken(baseTokenId: Hex): IStream<RelayFeeMap> {
  const stream = relayFeeMapByToken.get(baseTokenId)
  if (!stream) throw new Error(`no relay fee source for baseTokenId ${baseTokenId}`)
  return stream
}
