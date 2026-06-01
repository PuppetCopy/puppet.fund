import { type CHAIN_IDS, CHAIN_NETWORK_MAP, HUB_CHAIN_ID, SPOKE_CHAIN_IDS } from '@puppet/contracts/const'
import { type Chain, extractChain } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { groupListMap } from '../core/utils.js'

export const VIEM_CHAINS = [arbitrum, base] as const satisfies readonly Chain[]

export type ChainId = (typeof CHAIN_IDS)[number]
export type SpokeChainId = (typeof SPOKE_CHAIN_IDS)[number]
export type SpokeChain = Extract<(typeof VIEM_CHAINS)[number], { id: SpokeChainId }>

export type ChainNetwork = (typeof CHAIN_NETWORK_MAP)[ChainId]
export type SpokeChainNetwork = (typeof CHAIN_NETWORK_MAP)[SpokeChainId]
export const HUB_CHAIN_NETWORK = CHAIN_NETWORK_MAP[HUB_CHAIN_ID]

export const HUB_CHAIN = extractChain({ chains: VIEM_CHAINS, id: HUB_CHAIN_ID })
export const CHAIN_LIST: readonly [Chain, ...Chain[]] = VIEM_CHAINS
export const CHAIN_ID_LIST: readonly ChainId[] = VIEM_CHAINS.map(c => c.id) as readonly ChainId[]
export const CHAIN_MAP = groupListMap(VIEM_CHAINS, 'id', c => c) satisfies Record<ChainId, Chain>
export const SPOKE_CHAIN_LIST: readonly SpokeChain[] = SPOKE_CHAIN_IDS.map(
  id => extractChain({ chains: VIEM_CHAINS, id }) as SpokeChain
)
export const SPOKE_CHAIN_MAP = groupListMap(SPOKE_CHAIN_LIST, 'id', c => c) satisfies Record<SpokeChainId, SpokeChain>
