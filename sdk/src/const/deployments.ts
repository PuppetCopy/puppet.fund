import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS, { hub } from '@puppet/contracts/deployments'
import type { Address } from 'viem'

const DEPLOYMENT_ADDRESS: Record<string, { address: Address } | undefined> = {
  ...DEPLOYMENTS,
  ...Object.fromEntries(Object.entries(hub).map(([name, entry]) => [`${name}:${HUB_CHAIN_ID}`, entry]))
}

export function deploymentAddress(name: string, chainId: number): Address {
  const entry = DEPLOYMENT_ADDRESS[`${name}:${chainId}`]
  if (!entry) throw new Error(`no deployment for ${name} on chain ${chainId}; regenerate @puppet/contracts`)
  return entry.address
}
