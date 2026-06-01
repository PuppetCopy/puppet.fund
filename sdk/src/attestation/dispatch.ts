import { CHAIN_NETWORK_MAP, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '../const/index.js'

export function resolveDispatchChainId(chainId: number | undefined): ChainId {
  return (chainId ?? HUB_CHAIN_ID) as ChainId
}

export function resolveDispatchNetwork(chainId: ChainId): string {
  return CHAIN_NETWORK_MAP[chainId]
}
