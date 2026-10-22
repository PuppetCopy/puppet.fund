import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { Chain } from 'viem'
import { arbitrum, hyperEvm, mainnet, optimism, polygon, robinhood } from 'viem/chains'
import { groupList } from '../core/utils.js'

const VIEM_CHAIN_BY_ID = new Map<number, Chain>(
  [arbitrum, hyperEvm, mainnet, optimism, polygon, { ...robinhood, blockExplorers: { default: { name: 'Etherscan', url: 'https://robin.etherscan.io' } } }].map(
    (chain): [number, Chain] => [chain.id, chain]
  )
)

export const chainNameOf = (id: number): string | undefined => VIEM_CHAIN_BY_ID.get(id)?.name

function resolveChain(id: number): Chain {
  const chain = VIEM_CHAIN_BY_ID.get(id)
  if (!chain) throw new Error(`[chains] no viem Chain for id ${id}`)
  return chain
}

type ChainOf<Id extends number> = Chain & { id: Id }
export type ChainId = (typeof CHAIN_IDS)[number]

export const VIEM_CHAINS = CHAIN_IDS.map(resolveChain) as unknown as readonly [ChainOf<ChainId>, ...ChainOf<ChainId>[]]

export const CHAIN_ID_LIST: readonly ChainId[] = CHAIN_IDS
export const CHAIN_MAP = groupList(VIEM_CHAINS, 'id') as Record<ChainId, Chain>

export function resolveDispatchChainId(chainId: number): ChainId {
  const known = CHAIN_ID_LIST.find(id => id === chainId)
  if (known === undefined) throw new Error(`unknown dispatch chain ${chainId}`)
  return known
}

export const HUB_CHAIN: ChainOf<typeof HUB_CHAIN_ID> = resolveChain(HUB_CHAIN_ID) as ChainOf<typeof HUB_CHAIN_ID>

export const VENUE_CHAINS: readonly { chain: Chain; network: string }[] = [[999, 'hyperliquid'] as const].map(([id, network]) => ({ chain: resolveChain(id), network }))
