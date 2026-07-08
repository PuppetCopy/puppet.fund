import type { ChainId } from '@puppet/sdk/const'
import { isNativeToken } from '@puppet/sdk/core'
import { type Abi, type Address, erc20Abi, getAddress, } from 'viem'
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

const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const ETH_BALANCE_ABI: Abi = [
  {
    type: 'function',
    name: 'getEthBalance',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
]

// Raw wallet balance through the same SW view-cache as every self read: ERC-20 via balanceOf, the native
// marker via Multicall3.getEthBalance (eth_getBalance is not an eth_call, so it has no calldata to key on).
export function readTokenBalance(account: Address, chainId: ChainId, token: Address, refresh?: boolean): Promise<bigint> {
  return isNativeToken(token)
    ? (viewCall({ chainId, address: MULTICALL3, abi: ETH_BALANCE_ABI, functionName: 'getEthBalance', args: [account], refresh }) as Promise<bigint>)
    : (viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account], refresh }) as Promise<bigint>)
}

// True once the account has code on-chain. signedBalanceOf reverts with no data on an undeployed account (lazy
// onboarding deploys the PA/FA on its first intent), so a signing read probes this first and treats a not-yet-deployed
// account as a provable empty signed balance rather than a failed read.
export async function readAccountDeployed(account: Address, chainId: ChainId, refresh?: boolean): Promise<boolean> {
  const code = await viewCode(chainId, getAddress(account), refresh)
  return code !== undefined && code !== '0x'
}
