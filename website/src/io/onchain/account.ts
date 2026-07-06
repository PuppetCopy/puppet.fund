import type { ChainId } from '@puppet/sdk/const'
import { type Abi, type Address, getAddress, } from 'viem'
import { viewCall, viewCode } from './viewRead.js'

// Self account-level signed-balance read, routed through the SW view-cache. signedBalanceOf lives on every Puppet/Fund
// account (BaseAccount), keyed by token address.
export const SIGNED_BALANCE_ABI: Abi = [
  {
    type: 'function',
    name: 'signedBalanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
]

export function readSignedBalance(
  account: Address,
  chainId: ChainId,
  token: Address,
  refresh?: boolean,
  minBlock?: bigint
): Promise<bigint> {
  return viewCall({
    chainId,
    address: account,
    abi: SIGNED_BALANCE_ABI,
    functionName: 'signedBalanceOf',
    args: [token],
    refresh,
    minBlock
  }) as Promise<bigint>
}

// True once the account has code on-chain. signedBalanceOf reverts with no data on an undeployed account (lazy
// onboarding deploys the PA/FA on its first intent), so a signing read probes this first and treats a not-yet-deployed
// account as a provable empty signed balance rather than a failed read.
export async function readAccountDeployed(account: Address, chainId: ChainId, refresh?: boolean): Promise<boolean> {
  const code = await viewCode(chainId, getAddress(account), refresh)
  return code !== undefined && code !== '0x'
}
