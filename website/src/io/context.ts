import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { periodicRun } from '@puppet/sdk/core'
import {
  createIndexerHealthSource,
  createSdkContext,
  type RelayFeeMap,
  SUPPORTED_FEE_TOKEN_IDS
} from '@puppet/sdk/state'
import { type IStream, just, map, op } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import type { Address, Hex } from 'viem'
import { publicClientMap } from '../wallet/index.js'
import { sqlClient } from './indexer/sql.js'

const GAS_POLL_MS = 10_000
const RATE_POLL_MS = 60_000

const ctx = createSdkContext({
  sqlClient,
  publicClients: publicClientMap,
  gasTtlMs: GAS_POLL_MS,
  rateTtlMs: RATE_POLL_MS
})

export const tokenRegistryQuery = just(ctx.getTokenRegistry())

export const registeredCollateralListQuery: IStream<Promise<Address[]>> = map(
  registry => registry.then(reg => [...(reg.get(HUB_CHAIN_ID)?.values() ?? [])].map(info => info.token)),
  tokenRegistryQuery
)
export const indexerHealth = op(createIndexerHealthSource(sqlClient, 1000), state())
export const gasPrice = op(
  periodicRun({ interval: GAS_POLL_MS, actionOp: map(() => ctx.getGasPrice(HUB_CHAIN_ID)) }),
  state()
)

export const relayFeeMapByToken: Map<Hex, IStream<RelayFeeMap>> = new Map(
  SUPPORTED_FEE_TOKEN_IDS.map(token => [
    token,
    op(periodicRun({ interval: GAS_POLL_MS, actionOp: map(() => ctx.getRelayFeeMap(token)) }), state())
  ])
)

export function relayFeeMapForToken(baseTokenId: Hex): IStream<RelayFeeMap> {
  const stream = relayFeeMapByToken.get(baseTokenId)
  if (!stream) throw new Error(`no relay fee source for baseTokenId ${baseTokenId}`)
  return stream
}
