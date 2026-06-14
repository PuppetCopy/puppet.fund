import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ADDRESS_ZERO } from '@puppet/sdk/const'
import { createAdapter, periodicRun } from '@puppet/sdk/core'
import {
  createIndexerHealthSource,
  createSdkContext,
  type RelayFeeMap,
  SUPPORTED_FEE_TOKEN_IDS
} from '@puppet/sdk/state'
import { type IStream, just, map, op, skipRepeats, skipRepeatsWith } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import type { Address, Hex } from 'viem'
import { publicClientMap } from '../wallet/wallet.js'
import { sqlClient } from './indexer/sql.js'

const GAS_POLL_MS = 10_000
const RATE_POLL_MS = 60_000

const ctx = createSdkContext({
  sqlClient,
  publicClients: publicClientMap,
  gasTtlMs: GAS_POLL_MS,
  rateTtlMs: RATE_POLL_MS
})

export const getTokenRegistry = ctx.getTokenRegistry
export const tokenRegistryQuery = just(ctx.getTokenRegistry())

// Native (token 0) is a holdable balance, never a GMX collateral: keep it out of the filter.
export const registeredCollateralListQuery: IStream<Promise<Address[]>> = map(
  registry =>
    registry.then(reg =>
      [...(reg.get(HUB_CHAIN_ID)?.values() ?? [])].map(info => info.token).filter(token => token !== ADDRESS_ZERO)
    ),
  tokenRegistryQuery
)
// Indexer status polls at a slow idle heartbeat; the action drawer bumps urgency while
// it has pending work (signing needs fresh block numbers), which also refetches instantly.
const INDEXER_POLL_IDLE_MS = 30_000
const INDEXER_POLL_ACTIVE_MS = 2_000
const indexerUrgency = createAdapter<'high' | 'idle'>()
export const setIndexerUrgency = indexerUrgency[0]
export const indexerHealth = op(
  createIndexerHealthSource(
    sqlClient,
    map(u => (u === 'high' ? INDEXER_POLL_ACTIVE_MS : INDEXER_POLL_IDLE_MS), state('idle', indexerUrgency[1]))
  ),
  state()
)
// Polling sources dedupe at the source: an unchanged gas price (or an equal fee map
// rebuilt as a fresh object each poll) must not re-fire every downstream combine,
// which previously respammed swap-quote requests with no input change.
export const gasPrice = op(
  periodicRun({ interval: GAS_POLL_MS, actionOp: map(() => ctx.getGasPrice(HUB_CHAIN_ID)) }),
  skipRepeats,
  state()
)

const feeMapEq = (a: RelayFeeMap, b: RelayFeeMap): boolean => {
  for (const method of Object.keys(a) as (keyof RelayFeeMap)[]) {
    if (a[method].relayFee !== b[method].relayFee) return false
  }
  return true
}

export const relayFeeMapByToken: Map<Hex, IStream<RelayFeeMap>> = new Map(
  SUPPORTED_FEE_TOKEN_IDS.map(token => [
    token,
    op(
      periodicRun({ interval: GAS_POLL_MS, actionOp: map(() => ctx.getRelayFeeMap(token)) }),
      skipRepeatsWith(feeMapEq),
      state()
    )
  ])
)

export function relayFeeMapForToken(baseTokenId: Hex): IStream<RelayFeeMap> {
  const stream = relayFeeMapByToken.get(baseTokenId)
  if (!stream) throw new Error(`no relay fee source for baseTokenId ${baseTokenId}`)
  return stream
}
