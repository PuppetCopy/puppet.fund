import { SWAP_PROVIDER } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { type Address, getAddress, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import { getTokenDescription } from '../core/token.js'
import { GMX_V2_CONTRACT_MAP } from '../venue/gmx/contractMap.js'
import { HYPERLIQUID_CONTRACTS } from '../venue/hyperliquid/contracts.js'

interface IContractLabel {
  name: string
  detail: string
  source: string
}

const words = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, first => first.toUpperCase())
    .trim()

const named = (source: string, key: string): string => {
  const spelled = words(key)
  const prefix = `${source} `
  return spelled.toLowerCase().startsWith(prefix.toLowerCase()) ? `${source}${spelled.slice(source.length)}` : `${source} ${spelled}`
}

const ownLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  for (const [key, entry] of Object.entries(DEPLOYMENTS as Record<string, { address: Address }>)) {
    const [name, deployed] = key.split(':')
    if (Number(deployed) !== chainId || !isAddressEqual(entry.address, address)) continue
    return { name: named('Puppet', name ?? key), detail: 'a Puppet protocol contract', source: 'puppet' }
  }
  return null
}

const gmxLabel = (address: Address): IContractLabel | null => {
  for (const [key, entry] of Object.entries(GMX_V2_CONTRACT_MAP as Record<string, { address: Address }>)) {
    if (!isAddressEqual(entry.address, address)) continue
    return { name: named('GMX', key), detail: 'a GMX contract', source: 'gmx' }
  }
  return null
}

const hyperliquidLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  const entry = HYPERLIQUID_CONTRACTS.find(c => c.chainId === chainId && isAddressEqual(c.address, address))
  return entry === undefined ? null : { name: entry.name, detail: entry.detail, source: 'hyperliquid' }
}

const routeLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  const providers = (SWAP_PROVIDER as Record<number, Record<string, Address> | undefined>)[chainId]
  if (providers === undefined) return null
  for (const [key, provider] of Object.entries(providers)) {
    if (!isAddressEqual(provider, address)) continue
    return { name: words(key), detail: 'a route provider this protocol swaps and bridges through', source: 'route' }
  }
  return null
}

const tokenLabel = (chainId: ChainId, address: Address): IContractLabel | null => {
  try {
    const token = getTokenDescription(chainId, address)
    return { name: token.symbol, detail: `a ${token.decimals}-decimal token this protocol values`, source: 'token' }
  } catch {
    return null
  }
}

export function contractLabelOf(chainId: ChainId, target: Address): IContractLabel {
  const address = getAddress(target)
  return (
    ownLabel(chainId, address) ??
    gmxLabel(address) ??
    hyperliquidLabel(chainId, address) ??
    routeLabel(chainId, address) ??
    tokenLabel(chainId, address) ?? { name: 'Unlabeled', detail: 'this protocol does not recognise this contract', source: 'unknown' }
  )
}
