import type { Address } from 'viem/accounts'
import type { Chain } from 'viem/chains'
import { HUB_CHAIN } from '../const/chains.js'

export function readableHash(address: string, padLeft = 6, padRight = 8) {
  return `${address.slice(0, padLeft)}...${address.slice(address.length - padRight, address.length)}`
}

export function readableAddress(hash: string) {
  return `${hash.slice(0, 6)}-${hash.slice(-4)}`
}

const getExplorerUrl = (chain: Chain = HUB_CHAIN) => {
  return chain.blockExplorers?.default.url || chain.blockExplorers?.etherscan?.url
}

export const getTxExplorerUrl = (hash: string, chain: Chain = HUB_CHAIN) => {
  return `${getExplorerUrl(chain)}/tx/${hash}`
}

export function getAccountExplorerUrl(account: Address, chain: Chain = HUB_CHAIN) {
  return `${getExplorerUrl(chain)}/address/${account}`
}
