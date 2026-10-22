import type { IIAccount__Call, IMandateLib__Mandate } from '@puppet/contracts/types'
import type { Address, Hex } from 'viem'
import type { ChainId } from '../const/index.js'
import type { ISwapRoute, IWithdrawInput } from '../intent/index.js'
import type { IRedeemPlan } from '../pool/index.js'
import { type IAcrossBridge, type IVenue, type IVenueIntent, type IVenueIntentParams, type IVenueIntents, type IVenueWithdraw, VENUES } from '../venue/index.js'
import type { ISettledTx } from './root.js'

export type IUnsealed<T> = T extends unknown ? Omit<T, 'header'> : never

export type StepKind =
  | 'approve'
  | 'fund'
  | 'key'
  | 'session'
  | 'genesis'
  | 'swap'
  | 'withdraw'
  | 'mandate'
  | 'operate'
  | 'allocate'
  | 'credit'
  | 'fulfil'
  | 'sell'
  | 'redeem'
  | 'redeemCohort'
  | 'retireEscrow'
  | 'fundSwap'
  | 'venueWithdraw'
  | 'venueIntent'
  | 'escrowReturn'
  | 'revoke'
  | 'walletWithdraw'

export type ISentTx = { chainId: ChainId; hash: Hex } | { chainId: ChainId; batch: string }

export type IReportWalletTx = (kind: StepKind, landed: ISettledTx | { sent: ISentTx } | { missed: string } | null) => void

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
  routeInput: bigint
  output: IDraftOutput & { receiver: Address; chainId: ChainId }
  input: IUnsealed<IWithdrawInput>
}

export type IEditorDraft = IDepositDraft | IWithdrawDraft

export interface IMandateDraft extends IDraftBase {
  kind: 'mandate'
  mandate: IMandateLib__Mandate
}

export interface IOperateDraft extends IDraftBase {
  kind: 'operate'
  chainId: ChainId
  feeToken: Address | 'any'
  callList: IIAccount__Call[]
  sweepInto: string | null
  acceptedFee: bigint | null
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
  puppets: bigint
  identity: IFundIdentityDraft | null
}

export interface ISellDraft extends IDraftBase {
  kind: 'sell'
  master: Address
  shareToken: Address
  shares: bigint
  value: bigint
}

export type IRedeemLeg = Omit<IFundSwapDraft, 'kind' | 'id' | 'destinationChainId' | 'outputToken'>

export interface IRedeemDraft extends IDraftBase {
  kind: 'redeem'
  fraction: bigint
  join: bigint
  token: Address
  source: { chainId: ChainId; token: Address; amount: bigint; whole: boolean } | null
  leg: IRedeemLeg | null
  holders: bigint
  plan: IRedeemPlan | null
}


export interface IFundSwapDraft extends IDraftBase {
  kind: 'fundSwap'
  chainId: ChainId
  destinationChainId: ChainId
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  routeInput: bigint
  outputAmount: bigint
  expectedOutput: bigint
  route: ISwapRoute
  fillDeadline: number
}

export interface IOperateSwapDraft extends IDraftBase {
  kind: 'operateSwap'
  chainId: ChainId
  inputToken: Address
  outputToken: Address
  poolFee: number
  inputAmount: bigint
  outputAmount: bigint
  relayFee: bigint
  bridge: IAcrossBridge | null
}

export interface IVenueWithdrawDraft extends IDraftBase {
  kind: 'venueWithdraw'
  venueId: string
  amount: bigint
}

export function venueWithdrawOf(venueId: string): IVenue & { withdraw: IVenueWithdraw } {
  const venue = VENUES.find(v => v.venueId === venueId)
  if (venue?.withdraw === undefined) throw new Error(`${venueId} takes no withdrawals`)
  return { ...venue, withdraw: venue.withdraw }
}

export interface IVenueIntentDraft extends IDraftBase {
  kind: 'venueIntent'
  venueId: string
  intent: string
  params: IVenueIntentParams
}

export function venueIntentOf(venueId: string, intent: string): { venue: IVenue; intents: IVenueIntents; intent: IVenueIntent } {
  const venue = VENUES.find(v => v.venueId === venueId)
  const found = venue?.intents?.list.find(each => each.intent === intent)
  if (venue?.intents === undefined || found === undefined) throw new Error(`${venueId} has no ${intent} action`)
  return { venue, intents: venue.intents, intent: found }
}


export interface IEscrowReturnDraft extends IDraftBase {
  kind: 'escrowReturn'
  chainId: ChainId
  token: Address
  phase: 'request' | 'claim'
}

export interface ISessionDraft extends IDraftBase {
  kind: 'session'
}

export interface IRevokeDraft extends IDraftBase {
  kind: 'revoke'
  chainId: ChainId
}

export interface IWalletWithdrawDraft extends IDraftBase {
  kind: 'walletWithdraw'
  chainId: ChainId
  token: Address
  amount: bigint
}

export type ITradeDraft = IOperateDraft | IAllocateDraft | ISellDraft | IRedeemDraft | IFundSwapDraft | IOperateSwapDraft | IVenueWithdrawDraft | IVenueIntentDraft | IEscrowReturnDraft | IWalletWithdrawDraft
export type IDraft = IEditorDraft | IMandateDraft | ITradeDraft | ISessionDraft | IRevokeDraft
