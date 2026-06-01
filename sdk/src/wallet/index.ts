export const PUPPET_EXTENSION_RDNS = 'tech.puppet'

export const WALLET_MESSAGE = {
  GET_ACTIVE_WALLET: 'PUPPET_GET_ACTIVE_WALLET',
  SET_ACTIVE_WALLET: 'PUPPET_SET_ACTIVE_WALLET',
  CLEAR_ALL: 'PUPPET_CLEAR_ALL'
} as const

export type WalletMessage = (typeof WALLET_MESSAGE)[keyof typeof WALLET_MESSAGE]

export const WALLET_TARGET = {
  EXTENSION: 'puppet-extension',
  WEBSITE: 'puppet-website',
  WEBSITE_EVENT: 'puppet-website-event',
  CONTENT: 'puppet-content',
  INPAGE: 'puppet-inpage'
} as const

export type WalletTarget = (typeof WALLET_TARGET)[keyof typeof WALLET_TARGET]

export const WALLET_EVENT_ACCOUNTS_CHANGED = 'accountsChanged'
