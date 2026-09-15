import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, erc20Abi, isAddressEqual, type PublicClient } from 'viem'
import { getBalance, readContract } from 'viem/actions'

export async function fetchTokenBalance(publicClient: PublicClient, token: Address, holder: Address): Promise<bigint> {
  if (isAddressEqual(token, PROTOCOL.nativeToken)) return getBalance(publicClient, { address: holder })
  return readContract(publicClient, { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] })
}

