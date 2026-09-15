export const PUPPET_EXTENSION_RDNS = 'fund.puppet'

export const WALLET_PROTOCOL_VERSION = 1

export const WALLET_MESSAGE = {
  GET_CONNECTIONS: 'PUPPET_GET_CONNECTIONS',
  HANDOFF_SESSION: 'PUPPET_HANDOFF_SESSION',
  REJECT_CONNECT: 'PUPPET_REJECT_CONNECT',
  CLEAR_ALL: 'PUPPET_CLEAR_ALL'
} as const

export const WALLET_EVENT = {
  ACCOUNTS_CHANGED: 'accountsChanged',
  SESSION_REQUEST: 'sessionRequest'
} as const
export type WalletEventName = (typeof WALLET_EVENT)[keyof typeof WALLET_EVENT]

export const WALLET_TARGET = {
  EXTENSION: 'puppet-extension',
  WEBSITE: 'puppet-website',
  WEBSITE_EVENT: 'puppet-website-event',
  CONTENT: 'puppet-content',
  INPAGE: 'puppet-inpage'
} as const

export interface IHandoffSessionRequest {
  user: string
  signerKey: string
  baseTokenId: string
  name: string
  approveOrigin?: string
}

export interface IRejectConnectRequest {
  origin: string
}

export interface IConnectionsResponse {
  version: number
  fund: string | null
  origins: string[]
}

export interface IHandoffSessionResponse {
  fund: string | null
}

export interface IWalletEventFrame {
  type: 'event'
  event: WalletEventName
  args: unknown[]
}
