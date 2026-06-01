import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type {
  IAllocateInput,
  IBridgeHubInput,
  IBridgeInput,
  IBridgeToWalletInput,
  IClaimInput,
  ICreateMasterAccountInput,
  ICreateMasterInput,
  ICreatePuppetAccountInput,
  IFulfillInput,
  ISellInput,
  ISignTransientRouteBalanceInput,
  ISubscribeInput,
  IWalletDepositRoute,
  IWalletDepositWntRoute,
  IWithdrawInput
} from '@puppet/sdk/attestation'
import type { Address, Hex } from 'viem'
import type { ISubscribeRule } from './$MatchingRuleEditor.js'

export interface ITransferToMasterRoute {
  chainId: number
  master: Address
  baseTokenId: Hex
  amount: bigint
  walletBalance: bigint
}

export type StepInput =
  | { kind: 'walletDeposit'; input: IWalletDepositRoute }
  | { kind: 'walletDepositWnt'; input: IWalletDepositWntRoute }
  | { kind: 'transferToMaster'; input: ITransferToMasterRoute }
  | { kind: 'bridgeHub'; input: IBridgeHubInput }
  | { kind: 'bridge'; input: IBridgeInput }
  | { kind: 'bridgeToWallet'; input: IBridgeToWalletInput }
  | { kind: 'signTransientRouteBalance'; input: ISignTransientRouteBalanceInput }
  | { kind: 'walletWithdraw'; input: IWithdrawInput }
  | { kind: 'subscribe'; input: ISubscribeInput }
  | { kind: 'createPuppetAccount'; input: ICreatePuppetAccountInput }
  | { kind: 'createMasterAccount'; input: ICreateMasterAccountInput }
  | { kind: 'createMaster'; input: ICreateMasterInput }
  | { kind: 'allocate'; input: IAllocateInput }
  | { kind: 'sell'; input: ISellInput }
  | { kind: 'claim'; input: IClaimInput }
  | { kind: 'fulfill'; input: IFulfillInput }

export type StepKind = StepInput['kind']

export const STEP_LABEL: Record<StepKind, string> = {
  walletDeposit: 'Fund',
  walletDepositWnt: 'Fund',
  transferToMaster: 'Fund',
  bridgeHub: 'Bridge',
  bridge: 'Bridge',
  bridgeToWallet: 'Bridge',
  signTransientRouteBalance: 'Credit',
  walletWithdraw: 'Withdraw',
  subscribe: 'Subscribe',
  createPuppetAccount: 'Create Puppet Account',
  createMasterAccount: 'Create master account',
  createMaster: 'Create master account',
  allocate: 'Allocate',
  sell: 'Sell',
  claim: 'Claim',
  fulfill: 'Fulfill'
}

export const STEP_DESCRIPTION: Record<StepKind, string> = {
  walletDeposit:
    'Sends tokens from your wallet to your deposit address. The next step confirms them into your balance.',
  walletDepositWnt: 'Sends native ETH from your wallet to your account. The next step confirms it into your balance.',
  transferToMaster: 'Sends tokens from your wallet to seed your master account.',
  bridgeHub: 'Moves funds from this chain to your account on Arbitrum.',
  bridge: 'Moves the seed to your master account on Arbitrum.',
  bridgeToWallet: 'Moves funds from your account to your wallet on another chain.',
  signTransientRouteBalance: 'Confirms the tokens you just sent so they show up in your balance.',
  walletWithdraw: 'Moves funds from your account to your wallet.',
  subscribe: 'Lets a trader pull funds from your account under the rules you set.',
  createPuppetAccount: 'Creates your account on-chain.',
  createMasterAccount: 'Creates your master account on this chain.',
  createMaster: 'Creates your master account and seeds its initial allocation on-chain.',
  allocate: 'A trader pulls funds matched from subscribers into their pool.',
  sell: 'Queue your shares for redemption. The trader buys them back at the next fulfillment.',
  claim: 'Withdraw the base currency you accrued from a prior buyback.',
  fulfill: 'Pay base from the master pool to retire queued shares at the current NAV.'
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

type IWalletStep =
  | { kind: 'walletDeposit'; input: IWalletDepositRoute }
  | { kind: 'walletDepositWnt'; input: IWalletDepositWntRoute }
type ISignTransientRouteBalanceStep = { kind: 'signTransientRouteBalance'; input: ISignTransientRouteBalanceInput }
type IBridgeHubStep = { kind: 'bridgeHub'; input: IBridgeHubInput }
type ICreatePuppetStep = { kind: 'createPuppetAccount'; input: ICreatePuppetAccountInput }

export type IDepositStep = ICreatePuppetStep | IWalletStep | ISignTransientRouteBalanceStep | IBridgeHubStep

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
  | { kind: 'walletWithdraw'; input: IWithdrawInput }
  | { kind: 'bridgeToWallet'; input: IBridgeToWalletInput }

export interface IWithdrawDraft extends IAmountDraftBase {
  kind: 'withdraw'
  inputSteps: IWithdrawStep[]
}

export interface ISubscribeDraft extends IDraftBase, ISubscribeRule {
  kind: 'subscribe'
}

export type IMasterFundStep =
  | { kind: 'transferToMaster'; input: ITransferToMasterRoute }
  | { kind: 'createMasterAccount'; input: ICreateMasterAccountInput }
  | { kind: 'bridge'; input: IBridgeInput }

export interface ICreateMasterDraft extends IDraftBase {
  kind: 'createMaster'
  params: IAccountLib__AccountInitParams
  master: Address
  baseToken: Address
  baseTokenId: Hex
  masterAmount: bigint
  sourceChainId: number
  inputSteps: IMasterFundStep[]
}

export interface IAllocateDraft extends IDraftBase {
  kind: 'allocate'
  master: Address
  baseToken: Address
  baseTokenId: Hex
  masterAmount: bigint
  sourceChainId: number
  inputSteps: IMasterFundStep[]
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

export interface IFulfillDraft extends IDraftBase {
  kind: 'fulfill'
  master: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  acceptableShares: bigint
}

// Public discriminated union — any draft kind.
export type IDraft =
  | IDepositDraft
  | IWithdrawDraft
  | ISubscribeDraft
  | ICreateMasterDraft
  | IAllocateDraft
  | ISellDraft
  | IClaimDraft
  | IFulfillDraft

// Narrower union: amount-bearing drafts only (deposit + withdraw).
export type IAmountDraft = IDepositDraft | IWithdrawDraft
