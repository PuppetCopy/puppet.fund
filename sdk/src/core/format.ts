import type { Address } from 'viem/accounts'
import type { Chain } from 'viem/chains'
import { HUB_CHAIN } from '../const/chains.js'

export function readableHash(address: string, padLeft = 6, padRight = 8) {
  return `${address.slice(0, padLeft)}...${address.slice(address.length - padRight, address.length)}`
}

export function readableAddress(hash: string) {
  return `${hash.slice(0, 6)}-${hash.slice(-4)}`
}

export const getExplorerUrl = (chain: Chain = HUB_CHAIN) => {
  return chain.blockExplorers?.default.url || chain.blockExplorers?.etherscan?.url
}

export const getTxExplorerUrl = (hash: string, chain: Chain = HUB_CHAIN) => {
  return `${getExplorerUrl(chain)}/tx/${hash}`
}

export function getAccountExplorerUrl(account: Address, chain: Chain = HUB_CHAIN) {
  return `${getExplorerUrl(chain)}/address/${account}`
}

export function getEtherscanMultichainUrl(account: Address) {
  return `https://etherscan.io/address/${account}#asset-multichain`
}

function padZero(str: string | number, len = 2) {
  const zeros = new Array(len).join('0')
  return (zeros + str).slice(-len)
}

export function invertColor(hex: string, bw = true) {
  if (hex.indexOf('#') === 0) {
    hex = hex.slice(1)
  }
  // convert 3-digit hex to 6-digits.
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  if (hex.length !== 6) {
    throw new Error('Invalid HEX color.')
  }
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)

  if (bw) {
    // https://stackoverflow.com/a/3943023/112731
    return r * 0.299 + g * 0.587 + b * 0.114 > 186 ? '#000000' : '#FFFFFF'
  }

  // pad each with zeros and return
  return `#${padZero((255 - r).toString(16))}${padZero((255 - g).toString(16))}${padZero((255 - b).toString(16))}`
}
