import type { ChainId } from '@puppet/sdk/const'
import { isNativeToken } from '@puppet/sdk/core'
import { type Address, erc20Abi } from 'viem'
import { viewCall } from './viewRead.js'

const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const ETH_BALANCE_ABI = [
  {
    type: 'function',
    name: 'getEthBalance',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
] as const

export function readTokenAllowance(
  account: Address,
  chainId: ChainId,
  token: Address,
  spender: Address,
  maxAge?: number
): Promise<bigint> {
  return isNativeToken(token)
    ? Promise.resolve(0n)
    : viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'allowance', args: [account, spender], maxAge })
}

export function readTokenBalance(
  account: Address,
  chainId: ChainId,
  token: Address,
  maxAge?: number,
  minBlock?: bigint
): Promise<bigint> {
  return isNativeToken(token)
    ? viewCall({ chainId, address: MULTICALL3, abi: ETH_BALANCE_ABI, functionName: 'getEthBalance', args: [account], maxAge, minBlock })
    : viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account], maxAge, minBlock })
}
