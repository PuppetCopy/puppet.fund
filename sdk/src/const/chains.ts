import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'
import { groupListMap } from '../core/utils.js'

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

export const VIEM_CHAINS = CHAIN_IDS.map(resolveChain) as unknown as readonly [ChainOf<ChainId>, ...ChainOf<ChainId>[]]

export const CHAIN_ID_LIST: readonly ChainId[] = CHAIN_IDS
export const CHAIN_MAP = groupListMap(VIEM_CHAINS, 'id', c => c) as Record<ChainId, Chain>

export function resolveDispatchChainId(chainId: number): ChainId {
  const known = CHAIN_ID_LIST.find(id => id === chainId)
  if (known === undefined) throw new Error(`unknown dispatch chain ${chainId}`)
  return known
}

export const HUB_CHAIN: ChainOf<typeof HUB_CHAIN_ID> = resolveChain(HUB_CHAIN_ID) as ChainOf<typeof HUB_CHAIN_ID>
