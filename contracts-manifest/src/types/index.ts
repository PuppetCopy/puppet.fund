import type { Address, Hex } from 'viem'

export interface IGateConfig {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxIntentTtl: bigint
  maxRelayFeeBps: bigint
}

export interface IAccountLib__Genesis {
  parent: Address
  key: Hex
  approval: Hex
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
}

export interface IAccountModule__Tip {
  blockNumber: bigint
  digest: Hex
}

export interface IBalanceLib__Balance {
  token: Address
  amount: bigint
}

export interface IDeposit__SwapIntent {
  header: IAccountLib__IntentHeader
  destinationChainId: bigint
  swap: ISwapLib__SwapParams
}

export interface IFund__AllocateIntent {
  header: IAccountLib__IntentHeader
  share: Address
  valuation: IFund__Valuation
  price: IFund__Price
  credit: IFund__Credit
  allocationList: IFund__Allocation[]
}

export interface IFund__Allocation {
  puppet: Address
  mandate: IAccountLib__Mandate
  amount: bigint
}

export interface IFund__Asset {
  chainId: bigint
  token: Address
  amount: bigint
}

export interface IFund__Credit {
  chainId: bigint
  token: Address
  amount: bigint
}

export interface IFund__Position {
  chainId: bigint
  venue: Hex
  id: Hex
  valueInUsd: bigint
}

export interface IFund__Price {
  token: Address
  amount: bigint
  value: bigint
}

export interface IFund__RedeemIntent {
  header: IAccountLib__IntentHeader
  share: Address
  valuation: IFund__Valuation
  price: IFund__Price
  retire: bigint
  drain: bigint
}

export interface IFund__SellIntent {
  header: IAccountLib__IntentHeader
  master: Address
  share: Address
  units: bigint
}

export interface IFund__Valuation {
  value: bigint
  assetList: IFund__Asset[]
  positionList: IFund__Position[]
}

export interface IFundAccount__Bound {
  module: Address
  parent: Address
  nonce: bigint
}

export interface IFundStore__Holding {
  basis: bigint
  allocatedAt: bigint
}

export interface IFundStore__Position {
  epoch: bigint
  cursor: bigint
  weight: bigint
  basis: bigint
  shortfall: bigint
}

export interface IFundStore__Queue {
  epoch: bigint
  weight: bigint
}

export interface IHubGate__MandateIntent {
  header: IAccountLib__IntentHeader
  mandateList: IAccountLib__Mandate[]
  signatureList: Hex[]
  tokenList: Address[]
  arm: boolean
}

export interface IIAccount__Call {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}

export interface ILiquidityGate__EscrowIntent {
  header: IAccountLib__IntentHeader
  master: Address
  token: Address
  amount: bigint
}

export interface ISpokeGate__OperateIntent {
  header: IAccountLib__IntentHeader
  callList: IIAccount__Call[]
  tokenList: Address[]
}

export interface ISwapLib__SwapParams {
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  provider: Address
  providerCallData: Hex
}

export interface IUserAccount__State {
  epoch: bigint
  nonce: bigint
  withdrawRequestedAt: bigint
}

export type IAccountCall__HubGate_mandate = { selector: '0x5dd72fb6'; size: number; mandateList: { master: Address; skin: bigint; allocationRate: bigint; cooldownPeriod: bigint; expiry: bigint }[]; signatureList: Hex[]; tokenList: Address[]; arm: boolean; feeToken: Address; fee: bigint }

export type IAccountCall__HubGate_createFund = { selector: '0x9108fff3'; size: number; clone: Address; symbol: Hex; pixels: Hex; performanceFee: bigint }

export type IAccountCall__HubGate_payOwed = { selector: '0x21b3e4ee'; size: 96; token: Address; amount: bigint }

export type IAccountCall__HubGate_refund = { selector: '0x82ad6f35'; size: 128; master: Address; token: Address; amount: bigint }

export type IAccountCall__SpokeGate_operate = { selector: '0x06635442'; size: 96; feeToken: Address; fee: bigint }

export type IAccountCall__SpokeGate_fulfil = { selector: '0x64600a32'; size: 224; parent: Address; token: Address; round: Hex; fromTotal: bigint; fulfilledTotal: bigint; fee: bigint }

export type IAccountCall__LiquidityGate_escrow = { selector: '0x818d17ac'; size: 192; master: Address; token: Address; amount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__AccountModule_createUserAccount = { selector: '0x95fba7f6'; size: 64; user: Address }

export type IAccountCall__AccountModule_createAccount = { selector: '0xfb603535'; size: 64; parent: Address }

export type IAccountCall__Deposit_depositAcross = { selector: '0x20fa0073'; size: 256; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Deposit_fundSwap = { selector: '0x1de2ca56'; size: 256; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Deposit_withdraw = { selector: '0xead1ce83'; size: 256; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Deposit_depositEscrow = { selector: '0xe3c2a826'; size: 128; master: Address; token: Address; amount: bigint }

export type IAccountCall__Deposit_deposit = { selector: '0x1e831bdc'; size: 160; user: Address; token: Address; amount: bigint; msgValue: bigint }

export type IAccountCall__Fund_allocateMaster = { selector: '0x4a021968'; size: 448; value: bigint; price: { token: Address; amount: bigint; value: bigint }; credit: { chainId: bigint; token: Address; amount: bigint }; creditedTotal: bigint; minted: bigint; skin: bigint; slice: bigint; billed: bigint; masterBilled: bigint }

export type IAccountCall__Fund_allocatePuppet = { selector: '0x4a021968'; size: 256; master: Address; amount: bigint; value: bigint; slice: bigint; units: bigint; holding: { basis: bigint; allocatedAt: bigint } }

export type IAccountCall__Fund_redeemMaster = { selector: '0x396d37c6'; size: 480; value: bigint; price: { token: Address; amount: bigint; value: bigint }; retire: bigint; fromPool: boolean; drained: bigint; cashValue: bigint; feeValue: bigint; queue: { epoch: bigint; weight: bigint }; retired: bigint; accrued: bigint; tokenAccrued: bigint }

export type IAccountCall__Fund_redeemOwner = { selector: '0x396d37c6'; size: 128; master: Address; token: Address; net: bigint }

export type IAccountCall__Fund_sellMaster = { selector: '0xf8d3c9a6'; size: 160; puppet: Address; queue: { epoch: bigint; weight: bigint }; pool: bigint }

export type IAccountCall__Fund_sellOwner = { selector: '0xf8d3c9a6'; size: 128; master: Address; puppet: Address; feeValue: bigint }

export type IAccountCall__Fund_sellPuppet = { selector: '0xf8d3c9a6'; size: 480; master: Address; units: bigint; basis: bigint; payoutValue: bigint; feeValue: bigint; holding: { basis: bigint; allocatedAt: bigint }; position: { epoch: bigint; cursor: bigint; weight: bigint; basis: bigint; shortfall: bigint }; feeToken: Address; fee: bigint }

export type IAccountCall__Fund_claimHolder = { selector: '0x8a72c442'; size: 288; master: Address; payoutValue: bigint; feeValue: bigint; position: { epoch: bigint; cursor: bigint; weight: bigint; basis: bigint; shortfall: bigint } }

export type IAccountCall__Fund_claimOwner = { selector: '0x8a72c442'; size: 128; master: Address; holder: Address; feeValue: bigint }

export type IAccountCall__UserAccount_revokeSessions = { selector: '0xac2d5d4b'; size: 64; epoch: bigint }

export type IAccountCall__UserAccount_requestWithdraw = { selector: '0xb3423eec'; size: 64; requestedAt: bigint }

export type IAccountCall__UserAccount_withdraw = { selector: '0xb5c5f672'; size: 96; token: Address; amount: bigint }

export type IAccountCallEntry =
  | IAccountCall__AccountModule_createAccount
  | IAccountCall__AccountModule_createUserAccount
  | IAccountCall__Deposit_deposit
  | IAccountCall__Deposit_depositAcross
  | IAccountCall__Deposit_depositEscrow
  | IAccountCall__Deposit_fundSwap
  | IAccountCall__Deposit_withdraw
  | IAccountCall__Fund_allocateMaster
  | IAccountCall__Fund_allocatePuppet
  | IAccountCall__Fund_claimHolder
  | IAccountCall__Fund_claimOwner
  | IAccountCall__Fund_redeemMaster
  | IAccountCall__Fund_redeemOwner
  | IAccountCall__Fund_sellMaster
  | IAccountCall__Fund_sellOwner
  | IAccountCall__Fund_sellPuppet
  | IAccountCall__HubGate_createFund
  | IAccountCall__HubGate_mandate
  | IAccountCall__HubGate_payOwed
  | IAccountCall__HubGate_refund
  | IAccountCall__LiquidityGate_escrow
  | IAccountCall__SpokeGate_fulfil
  | IAccountCall__SpokeGate_operate
  | IAccountCall__UserAccount_requestWithdraw
  | IAccountCall__UserAccount_revokeSessions
  | IAccountCall__UserAccount_withdraw
