import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Address, Hex } from 'viem'

export type IDepositMode = 'erc20Gate' | 'native' | 'erc20Transfer'

export interface IDepositRoute {
  chainId: number
  params: IAccountLib__AccountInitParams
  tokenId: Hex
  mode: IDepositMode
  token: Address
  amount: bigint
  walletBalance: bigint
  spender?: Address
  walletAllowance?: bigint
}
