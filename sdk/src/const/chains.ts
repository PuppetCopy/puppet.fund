import { CHAIN_IDS, HUB_CHAIN_ID, SPOKE_CHAIN_IDS } from '@puppet/contracts/const'
import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'
import { groupListMap } from '../core/utils.js'

// Every chain is resolved from the contracts-generated CHAIN_IDS against viem/chains by id, so a chain added in
// const.toml flows through with no edit here. A configured chain viem has no entry for throws at load rather than
// silently dropping. Trade-off: the namespace import pulls viem's full chain set into the bundle (chosen over the
// per-chain hardcoded list).
const VIEM_CHAIN_BY_ID = new Map<number, Chain>(
  (Object.values(viemChains) as unknown[])
    .filter((c): c is Chain => typeof (c as { id?: unknown }).id === 'number')
    .map(c => [c.id, c] as const)
)

function resolveChain(id: number): Chain {
  const chain = VIEM_CHAIN_BY_ID.get(id)
  if (!chain) throw new Error(`[chains] no viem Chain for id ${id}`)
  return chain
}

type ChainOf<Id extends number> = Chain & { id: Id }
export type ChainId = (typeof CHAIN_IDS)[number]
export type SpokeChainId = (typeof SPOKE_CHAIN_IDS)[number]
export type SpokeChain = ChainOf<SpokeChainId>

// Runtime-sound: CHAIN_IDS is a non-empty literal tuple, and each resolved chain's id IS that CHAIN_ID, so the
// element ids carry ChainId (not bare number) and the tuple is non-empty — preserving the literal-tuple typing
// consumers relied on (wagmi's non-empty `chains`, ChainId-typed `chain.id`).
export const VIEM_CHAINS = CHAIN_IDS.map(resolveChain) as unknown as readonly [ChainOf<ChainId>, ...ChainOf<ChainId>[]]
export const CHAIN_LIST: readonly [Chain, ...Chain[]] = VIEM_CHAINS
export const CHAIN_ID_LIST: readonly ChainId[] = CHAIN_IDS
export const CHAIN_MAP = groupListMap(VIEM_CHAINS, 'id', c => c) as Record<ChainId, Chain>

export const HUB_CHAIN: ChainOf<typeof HUB_CHAIN_ID> = resolveChain(HUB_CHAIN_ID) as ChainOf<typeof HUB_CHAIN_ID>
export const SPOKE_CHAIN_LIST: readonly SpokeChain[] = SPOKE_CHAIN_IDS.map(id => resolveChain(id) as SpokeChain)
export const SPOKE_CHAIN_MAP = groupListMap(SPOKE_CHAIN_LIST, 'id', c => c) as Record<SpokeChainId, SpokeChain>
