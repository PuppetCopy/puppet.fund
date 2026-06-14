import { SHARE_DECIMALS } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type {
  IAllocateInput,
  IBridgeInput,
  IClaimInput,
  ICreateFundAccountInput,
  ICreatePuppetAccountInput,
  IDepositRoute,
  ILiquidateInput,
  IOperateInput,
  IRecognizeBalanceInput,
  IRedeemInput,
  ISellInput,
  ISubscribeInput,
  IWithdrawToBridgeInput,
  IWithdrawToWalletInput
} from '@puppet/sdk/attestation'
import type { Address, Hex } from 'viem'
import type { ISubscribeRule } from './$MatchingRuleEditor.js'

export type StepInput =
  | { kind: 'walletDeposit'; input: IDepositRoute }
  | { kind: 'walletDepositWnt'; input: IDepositRoute }
  | { kind: 'transferToMaster'; input: IDepositRoute }
  | { kind: 'transferToMasterWnt'; input: IDepositRoute }
  | { kind: 'bridge'; input: IBridgeInput }
  | { kind: 'withdrawToBridge'; input: IWithdrawToBridgeInput }
  | { kind: 'recognize'; input: IRecognizeBalanceInput }
  | { kind: 'withdrawToWallet'; input: IWithdrawToWalletInput }
  | { kind: 'subscribe'; input: ISubscribeInput }
  | { kind: 'createPuppetAccount'; input: ICreatePuppetAccountInput }
  | { kind: 'createFundAccount'; input: ICreateFundAccountInput }
  | { kind: 'allocate'; input: IAllocateInput }
  | { kind: 'swap'; input: IOperateInput }
  | { kind: 'sell'; input: ISellInput }
  | { kind: 'claim'; input: IClaimInput }
  | { kind: 'redeem'; input: IRedeemInput }
  | { kind: 'liquidate'; input: ILiquidateInput }

export type StepKind = StepInput['kind']

export const STEP_LABEL: Record<StepKind, string> = {
  walletDeposit: 'Fund',
  walletDepositWnt: 'Fund',
  transferToMaster: 'Fund',
  transferToMasterWnt: 'Fund',
  bridge: 'Bridge',
  withdrawToBridge: 'Bridge',
  recognize: 'Credit',
  withdrawToWallet: 'Withdraw',
  subscribe: 'Subscribe',
  createPuppetAccount: 'Create Puppet Account',
  createFundAccount: 'Create fund account',
  allocate: 'Allocate',
  swap: 'Swap',
  sell: 'Sell',
  claim: 'Claim',
  redeem: 'Redeem',
  liquidate: 'Liquidate'
}

export const STEP_DESCRIPTION: Record<StepKind, string> = {
  walletDeposit:
    'Sends tokens from your wallet to your deposit address. The next step confirms them into your balance.',
  walletDepositWnt: 'Sends native ETH from your wallet to your account. The next step confirms it into your balance.',
  transferToMaster: 'Sends tokens from your wallet to seed your master account.',
  transferToMasterWnt: 'Sends native ETH from your wallet to seed your master account.',
  bridge:
    'Moves funds to your account on Arbitrum, usually within seconds. Your funds stay in transit and settle on-chain even if you wait. If it fails, they reappear in the deposit editor to recover.',
  withdrawToBridge:
    'Moves funds from your account to your wallet on another chain, usually within seconds. Your funds stay in transit and settle on-chain even if you wait.',
  recognize: 'Confirms the tokens you just sent so they show up in your balance.',
  withdrawToWallet: 'Moves funds from your account to your wallet.',
  subscribe:
    'Authorizes this trader to commit a share of your deposited balance when they trade, under your rules. Funds move only at each match, from your balance, never up front. Unfunded matches are skipped.',
  createPuppetAccount: 'Creates your account on-chain.',
  createFundAccount: 'Creates your fund account and sweeps its deposit route on this chain.',
  allocate: 'A trader pulls funds matched from subscribers into their fund.',
  swap: 'Swaps a token your fund holds for another registered token at the best quoted route. The quote refreshes at execution and the signed minimum output is enforced on-chain.',
  sell: 'Joins the exit queue. Payment arrives when the manager next processes redemptions.',
  claim: 'Settles the base currency accrued to you from past redemptions into your account.',
  redeem: 'Pays everyone in the queue their share of the chosen amount, at the fund’s verified value.',
  liquidate:
    'Ends this fund permanently. Every holder receives the identical closing price per share; investors claim theirs anytime.'
}

export const stepNonce = (step: StepInput): bigint | null => ('nonce' in step.input ? step.input.nonce : null)

export interface IDraftAmount {
  amount: bigint
  baseTokenId: Hex
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

// Internal: amount-bearing draft shape (deposit/withdraw).
interface IAmountDraftBase extends IDraftBase {
  inputAmount: IDraftAmount
  output: IDraftOutput
  inputSteps: StepInput[]
}

type IWalletStep = { kind: 'walletDeposit'; input: IDepositRoute } | { kind: 'walletDepositWnt'; input: IDepositRoute }
type IRecognizeStep = { kind: 'recognize'; input: IRecognizeBalanceInput }
type IBridgeStep = { kind: 'bridge'; input: IBridgeInput }
type ICreatePuppetStep = { kind: 'createPuppetAccount'; input: ICreatePuppetAccountInput }

export type IDepositStep = ICreatePuppetStep | IWalletStep | IRecognizeStep | IBridgeStep

export interface IDepositDraft extends IAmountDraftBase {
  kind: 'deposit'
  inputSteps: IDepositStep[]
  // Set when the draft was composed before a session signer was available.
  // Runner re-derives recipient (puppet account) and step `params.signer`
  // from ctx.session.signer after the bind step lands.
  lateBindDerivation?: Omit<IAccountLib__AccountInitParams, 'signer'>
}

export type IWithdrawStep =
  | ICreatePuppetStep
  | { kind: 'withdrawToWallet'; input: IWithdrawToWalletInput }
  | { kind: 'withdrawToBridge'; input: IWithdrawToBridgeInput }

export interface IWithdrawDraft extends IAmountDraftBase {
  kind: 'withdraw'
  inputSteps: IWithdrawStep[]
}

export interface ISubscribeDraft extends IDraftBase, ISubscribeRule {
  kind: 'subscribe'
}

export type IMasterFundStep =
  | { kind: 'transferToMaster'; input: IDepositRoute }
  | { kind: 'transferToMasterWnt'; input: IDepositRoute }
  | { kind: 'createPuppetAccount'; input: ICreatePuppetAccountInput }
  | { kind: 'createFundAccount'; input: ICreateFundAccountInput }
  | { kind: 'bridge'; input: IBridgeInput }

export interface IAllocateDraft extends IDraftBase {
  kind: 'allocate'
  master: Address
  masterSigner: Address
  baseToken: Address
  baseTokenId: Hex
  name: Hex
  masterAmount: bigint
  inputAmount: bigint
  sourceChainId: number
  inputSteps: IMasterFundStep[]
}

export interface ISwapDraft extends IDraftBase {
  kind: 'swap'
  chainId: number
  destinationChainId: number
  tokenInId: Hex
  tokenIn: Address
  tokenOutId: Hex
  tokenOut: Address
  amountIn: bigint
  minOut: bigint
}

export interface ISellDraft extends IDraftBase {
  kind: 'sell'
  master: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  sharesOut: bigint
}

export interface IClaimDraft extends IDraftBase {
  kind: 'claim'
  master: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  amount: bigint
}

export interface IRedeemDraft extends IDraftBase {
  kind: 'redeem'
  master: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  sharesOut: bigint
  assetsOut: bigint
  fulfill: boolean
  liquidate: boolean
}

// Public discriminated union — any draft kind.
export type IDraft =
  | IDepositDraft
  | IWithdrawDraft
  | ISubscribeDraft
  | IAllocateDraft
  | ISwapDraft
  | ISellDraft
  | IClaimDraft
  | IRedeemDraft

// Narrower union: amount-bearing drafts only (deposit + withdraw).

export { SHARE_DECIMALS }
