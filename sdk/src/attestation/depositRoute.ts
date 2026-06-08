import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Address } from 'viem'

// How funds physically reach a route (all three are unsigned, permissionless sends):
//   erc20Gate     — PuppetGate/MasterGate.deposit(params, amount), needs approve(spender)
//   native        — PuppetGate/MasterGate.depositWnt(params), wraps msg.value
//   erc20Transfer — bare ERC20 transfer into the predicted route (master seed, NAV-only)
export type IDepositMode = 'erc20Gate' | 'native' | 'erc20Transfer'

// One descriptor for every wallet→route send, puppet or master. The route the funds
// land in is a function of (accountKind, mode): a master `native` send targets the
// share-eligible MasterDepositRoute; everything else targets the NAV-only TransientRoute.
export interface IDepositRoute {
  chainId: number
  params: IAccountLib__AccountInitParams
  accountKind: 'puppet' | 'master'
  mode: IDepositMode
  token: Address
  amount: bigint
  walletBalance: bigint
  spender?: Address
  walletAllowance?: bigint
}
