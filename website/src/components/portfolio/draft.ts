import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type {
  IAllocateInput,
  IClaimInput,
  IDepositRoute,
  ILiquidateInput,
  IMandateInput,
  IOperateInput,
  IRecognizeBalanceInput,
  IRedeemInput,
  ISellInput,
  ISwapInput,
  IWithdrawInput
} from '@puppet/sdk/attestation'
import type { Address, Hex } from 'viem'
import type { ISubscribeRule } from './$MatchingRuleEditor.js'

export type StepInput =
  | { kind: 'walletTransfer'; input: IDepositRoute }
  | { kind: 'swap'; input: ISwapInput }
  | { kind: 'recognize'; input: IRecognizeBalanceInput }
  | { kind: 'withdraw'; input: IWithdrawInput }
  | { kind: 'mandate'; input: IMandateInput }
  | { kind: 'allocate'; input: IAllocateInput }
  | { kind: 'sell'; input: ISellInput }
  | { kind: 'claim'; input: IClaimInput }
  | { kind: 'redeem'; input: IRedeemInput }
  | { kind: 'liquidate'; input: ILiquidateInput }
  | { kind: 'recognizeFund'; input: IOperateInput }

export type StepKind = StepInput['kind']

export const STEP_LABEL: Record<StepKind, string> = {
  walletTransfer: 'Deposit',
  swap: 'Swap',
  recognize: 'Credit',
  withdraw: 'Withdraw',
  mandate: 'Follow',
  allocate: 'Allocate',
  sell: 'Sell',
  claim: 'Claim',
  redeem: 'Redeem',
  liquidate: 'Liquidate',
  recognizeFund: 'Recognize'
}

export const STEP_DESCRIPTION: Record<StepKind, string> = {
  walletTransfer: 'Sends funds from your wallet to your account. The next step confirms them into your balance.',
  swap:
    'Moves funds to your account on Arbitrum, usually within seconds. Your funds stay in transit and settle on-chain even if you wait. If it fails, they reappear in the deposit editor to recover.',
  recognize: 'Confirms the tokens you just sent so they show up in your balance.',
  withdraw:
    'Moves funds from your account to your wallet, optionally bridging to another chain. Cross-chain transfers usually settle within seconds and stay in transit on-chain even if you wait.',
  mandate:
    'Subscribes you to this trader under your rules and moves any funds you just deposited into your balance, so the trader can commit a share at each allocation. Funds stay in your balance until then; unfunded allocations are skipped.',
  allocate: 'A trader pulls allocated funds from puppets into their fund.',
  sell: 'Joins the exit queue. Payment arrives when the manager next processes redemptions.',
  claim: 'Settles the base currency accrued to you from past redemptions into your account.',
  redeem: 'Pays everyone in the queue their share of the chosen amount, at the fund’s verified value.',
  liquidate:
    'Ends this fund permanently. Every holder receives the identical closing price per share; investors claim theirs anytime.',
  recognizeFund:
    'Co-signs funds a closed position returned to your fund into your balance, so they count toward NAV and can be redeemed.'
}


export interface IDraftAmount {
  amount: bigint
  baseToken: Address
}

export interface IDraftOutput extends IDraftAmount {
  receiver: Address
  chainId: number
  approx: boolean
}

// Internal: common shape every draft kind carries.
interface IDraftBase {
  id: string
  account: Address
  title: string
  alert: string | null
}

export interface IDepositDraft extends IDraftBase {
  kind: 'deposit'
  params: IAccountLib__AccountInitParams
  inputAmount: IDraftAmount
  output: IDraftOutput
  wallet: IDepositRoute | null
  swap: ISwapInput | null
  surplus: bigint
}

export interface IWithdrawDraft extends IDraftBase {
  kind: 'withdraw'
  inputAmount: IDraftAmount
  output: IDraftOutput
  input: IWithdrawInput
}

export interface ISubscribeDraft extends IDraftBase, ISubscribeRule {
  kind: 'mandate'
}

export interface IAllocateDraft extends IDraftBase {
  kind: 'allocate'
  master: Address
  masterSigner: Address
  baseToken: Address
  name: Hex
  masterAmount: bigint
  inputAmount: bigint
  sourceChainId: number
  wallet: IDepositRoute | null
  swap: ISwapInput | null
}

export interface ISellDraft extends IDraftBase {
  kind: 'sell'
  master: Address
  masterAccount: Address
  baseToken: Address
  sharesOut: bigint
}

export interface IClaimDraft extends IDraftBase {
  kind: 'claim'
  master: Address
  masterAccount: Address
  baseToken: Address
}

export interface IRedeemDraft extends IDraftBase {
  kind: 'redeem'
  master: Address
  masterAccount: Address
  baseToken: Address
  sharesOut: bigint
  assetsOut: bigint
  fulfill: boolean
  liquidate: boolean
}

// Fund rebalance: swap one token the fund holds (signed balance) for another, in a single guarded
// FundGate.swap (fromRoute=false). Local same-chain only.
export interface IFundSwapDraft extends IDraftBase {
  kind: 'fundSwap'
  chainId: number
  destinationChainId?: number
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minOut: bigint
}

// Recognize a closed position's return: the funds landed in the fund account as raw ERC-20 (no signed-domain event),
// so they sit unrecognized until co-signed. A single pure-recognition operate (transferList amountIn = balanceOf -
// signedBalanceOf, empty callList) credits them into the signed balance.
export interface IRecognizeFundDraft extends IDraftBase {
  kind: 'recognizeFund'
  master: Address
  masterAccount: Address
  baseToken: Address
  surplus: bigint
}

// Public discriminated union — any draft kind.
export type IDraft =
  | IDepositDraft
  | IWithdrawDraft
  | ISubscribeDraft
  | IAllocateDraft
  | IFundSwapDraft
  | ISellDraft
  | IClaimDraft
  | IRedeemDraft
  | IRecognizeFundDraft

// Narrower union: amount-bearing drafts only (deposit + withdraw).
