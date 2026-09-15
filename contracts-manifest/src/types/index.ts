import type { Address, Hex } from 'viem'

export interface IAccount__Body {
  module: Address
  user: Address
  signer: Address
  nonce: bigint
}

export interface IAccountLib__Backing {
  puppet: Address
  matchable: bigint
  stake: bigint
  mandate: IAccountLib__Mandate
}

export interface IAccountLib__Genesis {
  signer: Address
  expiry: bigint
  key: Hex
  user: Hex
}

export interface IAccountLib__IntentHeader {
  account: Address
  user: Address
  nonce: bigint
  deadline: bigint
  feeToken: Address
  fee: bigint
}

export interface IAccountLib__Mandate {
  master: Address
  skin: bigint
  allocationRate: bigint
  cooldownPeriod: bigint
  expiry: bigint
  tokenIdList: Hex[]
}

export interface IBaseGate__Config {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxIntentTtl: bigint
  maxRelayFeeBps: bigint
  performanceFee: bigint
  maxCohortSize: bigint
}

export interface ICoreGate__OperateIntent {
  header: IAccountLib__IntentHeader
  creditList: Address[]
  cycle: bigint
  token: Address
  value: bigint
  collateral: bigint
  skin: bigint
  backed: bigint
  backingList: IAccountLib__Backing[]
  callList: IIAccount__Call[]
}

export interface ICoreGate__Outcome {
  puppet: Address
  amount: bigint
  mandate: IAccountLib__Mandate
}

export interface ICoreGate__SettleIntent {
  header: IAccountLib__IntentHeader
  cycle: bigint
  token: Address
  value: bigint
  gainList: ICoreGate__Outcome[]
}

export interface ICoreGate__WithdrawIntent {
  header: IAccountLib__IntentHeader
  swap: ISwapLib__SwapParams
  destinationChainId: bigint
}

export interface IDeposit__DepositSwap {
  header: IAccountLib__IntentHeader
  swap: ISwapLib__SwapParams
  destinationChainId: bigint
}

export interface IDeposit__ScheduledCredit {
  token: Address
  amount: bigint
  expiry: bigint
  fee: bigint
}

export interface IHubGate__DrawIntent {
  header: IAccountLib__IntentHeader
  spokeChainId: bigint
  cycle: bigint
  lossList: IHubGate__Loss[]
}

export interface IHubGate__Loss {
  puppet: Address
  amount: bigint
}

export interface IHubGate__MandateIntent {
  header: IAccountLib__IntentHeader
  creditList: Address[]
  bond: bigint
  mandateList: IAccountLib__Mandate[]
  signatureList: Hex[]
}

export interface IHubGate__UnbondIntent {
  header: IAccountLib__IntentHeader
  amount: bigint
}

export interface IIAccount__Call {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}

export interface ISwapLib__SwapParams {
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  provider: Address
  providerCallData: Hex
}

export type IAccountCall__HubGate_mandate = { selector: '0x35386618'; size: number; creditList: Address[]; amountList: bigint[]; bond: bigint; mandateList: { master: Address; skin: bigint; allocationRate: bigint; cooldownPeriod: bigint; expiry: bigint; tokenIdList: Hex[] }[]; signatureList: Hex[] }

export type IAccountCall__HubGate_unbond = { selector: '0xd6a467aa'; size: 64; amount: bigint }

export type IAccountCall__HubGate_drawMaster = { selector: '0x356faf5c'; size: 128; spokeChainId: bigint; cycle: bigint; drawn: bigint }

export type IAccountCall__HubGate_drawPuppet = { selector: '0x356faf5c'; size: 192; master: Address; spokeChainId: bigint; cycle: bigint; amount: bigint; loss: bigint }

export type IAccountCall__HubGate_deposit = { selector: '0x20e8c565'; size: 128; token: Address; amount: bigint; bond: bigint }

export type IAccountCall__CoreGate_withdraw = { selector: '0xd528ac5e'; size: 192; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint }

export type IAccountCall__CoreGate_operateMaster = { selector: '0x3c344ad3'; size: number; creditList: Address[]; amountList: bigint[]; cycle: bigint; token: Address; value: bigint; collateral: bigint; skin: bigint; backed: bigint }

export type IAccountCall__CoreGate_operatePuppet = { selector: '0x3c344ad3'; size: 128; master: Address; cycle: bigint; stake: bigint }

export type IAccountCall__CoreGate_settleMaster = { selector: '0x8199f35c'; size: 128; cycle: bigint; token: Address; value: bigint }

export type IAccountCall__CoreGate_settlePuppet = { selector: '0x8199f35c'; size: 192; master: Address; cycle: bigint; token: Address; amount: bigint; amount2: bigint }

export type IAccountCall__CoreGate_deposit = { selector: '0x8340f549'; size: 96; token: Address; amount: bigint }

export type IAccountCall__AccountModule_createAccount = { selector: '0x1bd2a04d'; size: 96; user: Address; signer: Address }

export type IAccountCall__AccountModule_forcedWithdrawal = { selector: '0xf7b0e76f'; size: 128; token: Address; amount: bigint; to: Address }

export type IAccountCall__Deposit_depositAcross = { selector: '0x8cf164fa'; size: 192; destinationChainId: bigint; input: Address; inputAmount: bigint; outputToken: Address; outputFloor: bigint }

export type IAccountCall__Deposit_settleCredit = { selector: '0xa4a1728d'; size: 192; token: Address; amount: bigint; expiry: bigint; fee: bigint; arrived: bigint }

export type IAccountCallEntry =
  | IAccountCall__AccountModule_createAccount
  | IAccountCall__AccountModule_forcedWithdrawal
  | IAccountCall__CoreGate_deposit
  | IAccountCall__CoreGate_operateMaster
  | IAccountCall__CoreGate_operatePuppet
  | IAccountCall__CoreGate_settleMaster
  | IAccountCall__CoreGate_settlePuppet
  | IAccountCall__CoreGate_withdraw
  | IAccountCall__Deposit_depositAcross
  | IAccountCall__Deposit_settleCredit
  | IAccountCall__HubGate_deposit
  | IAccountCall__HubGate_drawMaster
  | IAccountCall__HubGate_drawPuppet
  | IAccountCall__HubGate_mandate
  | IAccountCall__HubGate_unbond
