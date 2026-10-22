import type { Address, Hex } from 'viem'

export interface IGateConfig {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxIntentTtl: bigint
  maxRelayFeeBps: bigint
  maxSwapRelayFeeBps: bigint
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
  shareToken: Address
  valuation: IFund__Valuation
  token: Address
  price: IFund__Price
  credit: IFund__Credit
  allocationList: IFund__Allocation[]
}

export interface IFund__Allocation {
  puppet: Address
  mandate: IMandateLib__Mandate
  amount: bigint
}

export interface IFund__Asset {
  chainId: bigint
  token: Address
  id: bigint
  amount: bigint
  value: bigint
}

export interface IFund__Credit {
  chainId: bigint
  token: Address
  total: bigint
  feeTotal: bigint
}

export interface IFund__Position {
  chainId: bigint
  venue: Hex
  id: Hex
  value: bigint
}

export interface IFund__Price {
  amount: bigint
  value: bigint
}

export interface IFund__Valuation {
  assetList: IFund__Asset[]
  positionList: IFund__Position[]
}

export interface IFundAccount__Bound {
  module: Address
  parent: Address
  nonce: bigint
}

export interface IFundStore__Credit {
  total: bigint
  feeTotal: bigint
}

export interface IFundStore__Holding {
  allocatedAt: number
  redeemedAt: number
  queued: bigint
  cost: bigint
}

export interface IFundStore__Redemption {
  id: bigint
  fraction: number
  fee: bigint
  masterPay: bigint
  queued: bigint
  owedLeft: bigint
  potLeft: bigint
  token: Address
  price: bigint
}

export interface IHubGate__MandateIntent {
  header: IAccountLib__IntentHeader
  epoch: bigint
  mandateList: IMandateLib__Mandate[]
}

export interface IIAccount__Call {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}

export interface ILiquidityGate__RetireEscrowIntent {
  header: IAccountLib__IntentHeader
  token: Address
  amount: bigint
}

export interface IMandateLib__Mandate {
  master: Address
  skin: bigint
  allocationRate: bigint
  exitCap: bigint
  cooldownPeriod: bigint
  expiry: bigint
}

export interface IRedeem__RedeemIntent {
  header: IAccountLib__IntentHeader
  shareToken: Address
  valuation: IFund__Valuation
  token: Address
  fraction: bigint
  join: bigint
}

export interface IRedeem__SellIntent {
  header: IAccountLib__IntentHeader
  shareToken: Address
  shares: bigint
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
  prevEpoch: bigint
  nonce: bigint
  revokedAt: bigint
}

export type IAccountCall__HubGate_mandate = { selector: '0x93638514'; size: number; epoch: bigint; mandateList: { master: Address; skin: bigint; allocationRate: bigint; exitCap: bigint; cooldownPeriod: bigint; expiry: bigint }[]; feeToken: Address; fee: bigint }

export type IAccountCall__HubGate_createFund = { selector: '0xa2697724'; size: number; clone: Address; symbol: Hex; pixels: Hex; performanceFee: bigint }

export type IAccountCall__SpokeGate_operate = { selector: '0x06635442'; size: 96; feeToken: Address; fee: bigint }

export type IAccountCall__SpokeGate_fulfil = { selector: '0xbf3783e4'; size: 128; token: Address; total: bigint; feeTotal: bigint }

export type IAccountCall__LiquidityGate_retireEscrow = { selector: '0xe70025ae'; size: 192; token: Address; amount: bigint; escrowed: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__LiquidityGate_deposit = { selector: '0x47e7ef24'; size: 128; token: Address; amount: bigint; msgValue: bigint }

export type IAccountCall__LiquidityGate_depositEscrow = { selector: '0xb324e80d'; size: 160; token: Address; amount: bigint; msgValue: bigint; escrowed: bigint }

export type IAccountCall__LiquidityGate_requestReturn = { selector: '0x7ec4a5a6'; size: 96; token: Address; returnAt: bigint }

export type IAccountCall__LiquidityGate_returnEscrow = { selector: '0x0e654357'; size: 96; token: Address; returned: bigint }

export type IAccountCall__AccountModule_createUserAccount = { selector: '0x95fba7f6'; size: 64; user: Address }

export type IAccountCall__AccountModule_createAccount = { selector: '0xfb603535'; size: 64; parent: Address }

export type IAccountCall__Deposit_depositAcross = { selector: '0x5ff54513'; size: 256; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Deposit_fundSwap = { selector: '0x167efc36'; size: 256; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Deposit_withdraw = { selector: '0x018c3c5a'; size: 256; destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Redeem_redeem = { selector: '0xa84ac486'; size: 544; valuation: bigint; join: bigint; active: bigint; masterShares: bigint; cash: bigint; redemption: { id: bigint; fraction: number; fee: bigint; masterPay: bigint; queued: bigint; owedLeft: bigint; potLeft: bigint; token: Address; price: bigint }; rate: { amount: bigint; value: bigint } }

export type IAccountCall__Redeem_sell = { selector: '0xd2795f55'; size: 736; master: Address; shares: bigint; holding: { allocatedAt: number; redeemedAt: number; queued: bigint; cost: bigint }; redemption: { id: bigint; fraction: number; fee: bigint; masterPay: bigint; queued: bigint; owedLeft: bigint; potLeft: bigint; token: Address; price: bigint }; queued: bigint; burned: bigint; payout: bigint; profitFee: bigint; protocolCut: bigint; feeToken: Address; fee: bigint }

export type IAccountCall__Redeem_redeemCohortHolder = { selector: '0x9ea840f8'; size: 544; master: Address; queued: bigint; burned: bigint; payout: bigint; profitFee: bigint; protocolCut: bigint; redemption: { id: bigint; fraction: number; fee: bigint; masterPay: bigint; queued: bigint; owedLeft: bigint; potLeft: bigint; token: Address; price: bigint }; refused: boolean }

export type IAccountCall__Redeem_redeemCohortMaster = { selector: '0x9ea840f8'; size: 416; payout: bigint; cut: bigint; redemption: { id: bigint; fraction: number; fee: bigint; masterPay: bigint; queued: bigint; owedLeft: bigint; potLeft: bigint; token: Address; price: bigint }; unburned: bigint }

export type IAccountCall__Redeem_redeemCohortOwner = { selector: '0x9ea840f8'; size: 128; master: Address; token: Address; paid: bigint }

export type IAccountCall__Fund_allocateMaster = { selector: '0xe1c82c76'; size: number; valuation: bigint; supply: bigint; token: Address; price: { amount: bigint; value: bigint }; credit: { chainId: bigint; token: Address; total: bigint; feeTotal: bigint }; ownerSignature: Hex; minted: bigint; slice: bigint; billed: bigint; masterBilled: bigint }

export type IAccountCall__Fund_allocateOwner = { selector: '0xe1c82c76'; size: 192; master: Address; credit: { chainId: bigint; token: Address; total: bigint; feeTotal: bigint } }

export type IAccountCall__Fund_allocatePuppet = { selector: '0xe1c82c76'; size: 320; master: Address; amount: bigint; value: bigint; slice: bigint; shares: bigint; holding: { allocatedAt: number; redeemedAt: number; queued: bigint; cost: bigint } }

export type IAccountCall__UserAccount_revokeSessions = { selector: '0xac2d5d4b'; size: 64; epoch: bigint }

export type IAccountCall__UserAccount_withdraw = { selector: '0xf3fef3a3'; size: 96; token: Address; amount: bigint }

export type IAccountCallEntry =
  | IAccountCall__AccountModule_createAccount
  | IAccountCall__AccountModule_createUserAccount
  | IAccountCall__Deposit_depositAcross
  | IAccountCall__Deposit_fundSwap
  | IAccountCall__Deposit_withdraw
  | IAccountCall__Fund_allocateMaster
  | IAccountCall__Fund_allocateOwner
  | IAccountCall__Fund_allocatePuppet
  | IAccountCall__HubGate_createFund
  | IAccountCall__HubGate_mandate
  | IAccountCall__LiquidityGate_deposit
  | IAccountCall__LiquidityGate_depositEscrow
  | IAccountCall__LiquidityGate_requestReturn
  | IAccountCall__LiquidityGate_retireEscrow
  | IAccountCall__LiquidityGate_returnEscrow
  | IAccountCall__Redeem_redeem
  | IAccountCall__Redeem_redeemCohortHolder
  | IAccountCall__Redeem_redeemCohortMaster
  | IAccountCall__Redeem_redeemCohortOwner
  | IAccountCall__Redeem_sell
  | IAccountCall__SpokeGate_fulfil
  | IAccountCall__SpokeGate_operate
  | IAccountCall__UserAccount_revokeSessions
  | IAccountCall__UserAccount_withdraw
