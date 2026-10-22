import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, ContractFunctionReturnType } from 'viem'
import type { ChainId } from '../const/index.js'

export type IViewFn<abi extends Abi> = ContractFunctionName<abi, 'pure' | 'view'>
export type IViewArgs<abi extends Abi, fn extends IViewFn<abi>> = ContractFunctionArgs<abi, 'pure' | 'view', fn>
export type IViewReturn<abi extends Abi, fn extends IViewFn<abi>, args extends IViewArgs<abi, fn>> = ContractFunctionReturnType<
  abi,
  'pure' | 'view',
  fn,
  args
>

export interface IViewCall<abi extends Abi, fn extends IViewFn<abi>, args extends IViewArgs<abi, fn>> {
  chainId: ChainId
  address: Address
  abi: abi
  functionName: fn
  args?: args
  maxAge?: number
  global?: boolean
  minBlock?: bigint
}

export type IViewRead = <const abi extends Abi, fn extends IViewFn<abi>, const args extends IViewArgs<abi, fn>>(
  req: IViewCall<abi, fn, args>
) => Promise<IViewReturn<abi, fn, args>>

export interface ITokenDescription {
  name: string
  symbol: string
  baseSymbol?: string
  isFiat?: boolean
  decimals: number
  address: Address
}
