import type { IAccountLib__Mandate, IIAccount__Call } from '@puppet/contracts/types'
import type { ChainId } from '@puppet/sdk/const'
import type { ISwapRoute, IWithdrawInput } from '@puppet/sdk/intent'
import type { Address } from 'viem'

export type IUnsealed<T> = T extends unknown ? Omit<T, 'header'> : never

export type StepKind =
  | 'approve'
  | 'fund'
  | 'key'
  | 'session'
  | 'deposit'
  | 'swap'
  | 'credit'
  | 'withdraw'
  | 'mandate'
  | 'unbond'
  | 'operate'
  | 'settle'

export type IReportWalletTx = (kind: StepKind, hash: `0x${string}` | null, chainId: ChainId) => void

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
  outputAmount: bigint
  destinationChainId: bigint
  route: ISwapRoute | null
  fillDeadline: number
}

export interface IDepositFunding {
  deposit: IDepositLeg
  nativeValue: bigint
  expectedOutput: bigint
  hub: null
  arrival: 'credit' | 'bond'
}

export const arrivalFloor = (funding: IDepositFunding): bigint => funding.deposit.outputAmount

export const depositCreditToken = (funding: IDepositFunding): Address => funding.deposit.outputToken

export interface IDepositDraft extends IDraftBase, IDepositFunding {
  kind: 'deposit'
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
  bond: bigint
  mandate: IAccountLib__Mandate | null
}

export interface IUnbondDraft extends IDraftBase {
  kind: 'unbond'
  amount: bigint
}

export interface ICreditDraft extends IDraftBase {
  kind: 'credit'
  chainId: ChainId
  creditList: Address[]
}

export interface IOperateDraft extends IDraftBase {
  kind: 'operate'
  chainId: ChainId
  token: Address
  skin: bigint
  feeToken: Address
  callList: IIAccount__Call[]
}

export interface ISettleDraft extends IDraftBase {
  kind: 'settle'
  spokeChainId: ChainId
  token: Address
}

export type ITradeDraft = ICreditDraft | IOperateDraft | ISettleDraft
export type IDraft = IEditorDraft | IMandateDraft | IUnbondDraft | ITradeDraft
