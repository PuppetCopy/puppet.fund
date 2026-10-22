import { PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import type { IAgentTemplateId } from '@puppet/sdk/agent'
import type { ICells } from '@puppet/sdk/ui-components'
import type { Address } from 'viem'
import { AGENT_SLOT_PREFIX } from './secretSlots.js'

export type IPortfolioRole = 'puppet' | 'master'

export const LEADERBOARD_SORT_KEYS = ['performance', 'nav'] as const
export interface ILeaderboardSort {
  direction: 'asc' | 'desc'
  selector: (typeof LEADERBOARD_SORT_KEYS)[number]
}

export interface IChainAddress {
  chainId: ChainId
  address: `0x${string}`
}

export interface IStoredPath {
  source: IChainAddress
  dest: IChainAddress
}

export const editorChoiceKey = (owner: string, scope: string): string => `${scope}:${owner.toLowerCase()}`

export interface IAgentIdentity {
  secret: string
  port: number
  name: string
  cells: ICells
  fund: Address
  template: IAgentTemplateId
  strategy: string
}

export interface IAgentBook {
  list: readonly IAgentIdentity[]
  pending: IAgentIdentity | null
}

export const agentBookSlot = (wallet: string): string => `${AGENT_SLOT_PREFIX}agents:${PROTOCOL.version}:${wallet.toLowerCase()}`
