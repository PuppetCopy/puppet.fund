import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Address } from 'viem'

export interface IWalletDepositRoute {
  chainId: number
  params: IAccountLib__AccountInitParams
  token: Address
  amount: bigint
  router: Address
  spender: Address
  walletBalance: bigint
  walletAllowance: bigint
}

export interface IWalletDepositWntRoute {
  chainId: number
  params: IAccountLib__AccountInitParams
  amount: bigint
  router: Address
  walletBalance: bigint
}
