import { type Address, erc20Abi, multicall3Abi } from 'viem'
import { CHAIN_MAP, type ChainId } from '../const/index.js'
import { isNativeToken, type IViewRead } from '../core/index.js'

export type { IViewArgs, IViewCall, IViewFn, IViewRead, IViewReturn } from '../core/index.js'

export function readTokenAllowance(
  viewCall: IViewRead,
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
  viewCall: IViewRead,
  account: Address,
  chainId: ChainId,
  token: Address,
  maxAge?: number,
  minBlock?: bigint
): Promise<bigint> {
  if (!isNativeToken(token)) return viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account], maxAge, minBlock })
  const multicall3 = CHAIN_MAP[chainId].contracts?.multicall3?.address
  return multicall3 === undefined
    ? Promise.reject(new Error(`chain ${chainId} names no Multicall3, so its native balance cannot be read`))
    : viewCall({ chainId, address: multicall3, abi: multicall3Abi, functionName: 'getEthBalance', args: [account], maxAge, minBlock })
}
