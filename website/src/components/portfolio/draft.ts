import type { IAccountLib__Mandate, IIAccount__Call } from '@puppet/contracts/types'
import type { ChainId } from '@puppet/sdk/const'
import type { ISwapRoute, IWithdrawInput } from '@puppet/sdk/intent'
import type { Address } from 'viem'
import type { ISettledTx } from '../../wallet/root.js'

export type IUnsealed<T> = T extends unknown ? Omit<T, 'header'> : never

export type StepKind =
  | 'approve'
  | 'fund'
  | 'key'
  | 'session'
  | 'swap'
  | 'withdraw'
  | 'mandate'
  | 'operate'
  | 'allocate'
  | 'sell'
  | 'redeem'
  | 'fundSwap'
  | 'escrow'
  | 'fulfil'

export type IReportWalletTx = (kind: StepKind, landed: ISettledTx | null) => void

export interface IDraftAmount {
  amount: bigint
  token: Address
}

export interface IDraftOutput extends IDraftAmount {
  expected: bigint
  approx: boolean
}

interface IDraftBase {
  id: string
}

export interface IDepositLeg {
  chainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  routeInput: bigint
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute | null
  fillDeadline: number
}

export interface IDepositFunding {
  deposit: IDepositLeg
  nativeValue: bigint
  expectedOutput: bigint
}

export const depositArrivalToken = (funding: IDepositFunding): Address => funding.deposit.outputToken

export interface IArrival {
  chainId: ChainId
  token: Address
  amount: bigint
}

export interface IDepositDraft extends IDraftBase, IDepositFunding {
  kind: 'deposit'
  source: 'wallet' | 'account'
  toEscrow: boolean
  identity?: IFundIdentityDraft
}

export interface IWithdrawDraft extends IDraftBase {
  kind: 'withdraw'
  chainId: ChainId
  balanceBefore: bigint
  inputAmount: IDraftAmount
  output: IDraftOutput & { receiver: Address; chainId: ChainId }
  input: IUnsealed<IWithdrawInput>
}

export type IEditorDraft = IDepositDraft | IWithdrawDraft

export interface IMandateDraft extends IDraftBase {
  kind: 'mandate'
  mandate: IAccountLib__Mandate
}

export interface IOperateDraft extends IDraftBase {
  kind: 'operate'
  chainId: ChainId
  feeToken: Address
  callList: IIAccount__Call[]
}

export interface IFundIdentityDraft {
  symbol: string
  cells: readonly string[]
}

export interface IAllocateDraft extends IDraftBase {
  kind: 'allocate'
  escrowChainId: ChainId
  escrowToken: Address
  contribution: bigint
  backers: bigint
  identity: IFundIdentityDraft | null
}

export interface ISellDraft extends IDraftBase {
  kind: 'sell'
  master: Address
  share: Address
  units: bigint
  value: bigint
}

export interface IRedeemDraft extends IDraftBase {
  kind: 'redeem'
  retire: bigint
  drain: bigint
  value: bigint
}

export interface IFundSwapDraft extends IDraftBase {
  kind: 'fundSwap'
  chainId: ChainId
  destinationChainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  expectedOutput: bigint
  route: ISwapRoute
  fillDeadline: number
}

export type ITradeDraft = IOperateDraft | IAllocateDraft | ISellDraft | IRedeemDraft | IFundSwapDraft
export type IDraft = IEditorDraft | IMandateDraft | ITradeDraft
