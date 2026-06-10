import type { IAllocateInput } from './allocate.js'
import type { IBridgeInput } from './bridge.js'
import type { IClaimInput } from './claim.js'
import type { ICreatePuppetAccountInput } from './createAccount.js'
import type { ICreateFundAccountInput } from './createFundAccount.js'
import type { IDepositRoute } from './depositRoute.js'
import type { IFulfillInput } from './fulfill.js'
import type { IOperateInput } from './operate.js'
import type { IRecognizeBalanceInput } from './recognizeBalance.js'
import type { ISellInput } from './sell.js'
import type { ISubscribeInput } from './subscribe.js'
import type { IWithdrawToBridgeInput } from './withdrawToBridge.js'
import type { IWithdrawToWalletInput } from './withdrawToWallet.js'

export type IInputByKind = {
  subscribe: ISubscribeInput
  createPuppetAccount: ICreatePuppetAccountInput
  createFundAccount: ICreateFundAccountInput
  allocate: IAllocateInput
  operate: IOperateInput
  sell: ISellInput
  claim: IClaimInput
  fulfill: IFulfillInput
  recognize: IRecognizeBalanceInput
  withdrawToWallet: IWithdrawToWalletInput
  bridge: IBridgeInput
  withdrawToBridge: IWithdrawToBridgeInput
  walletDeposit: IDepositRoute
  walletDepositWnt: IDepositRoute
}

export {
  attestAllocateIntent,
  type IAllocateAttestContext,
  type IAllocateInput,
  type IAllocateRulePosition
} from './allocate.js'
export { attestBridgeIntent, type IBridgeAttestContext, type IBridgeInput } from './bridge.js'
export { attestClaimIntent, type IClaimAttestContext, type IClaimInput } from './claim.js'
export {
  computeAllocation,
  type IAllocationPuppet,
  type IAllocationResult,
  type IComputeAllocationContext
} from './computeAllocation.js'
export {
  attestCreatePuppetAccountIntent,
  type ICreatePuppetAccountAttestContext,
  type ICreatePuppetAccountInput
} from './createAccount.js'
export {
  attestCreateFundAccountIntent,
  type ICreateFundAccountAttestContext,
  type ICreateFundAccountInput
} from './createFundAccount.js'
export type { IDepositMode, IDepositRoute } from './depositRoute.js'
export { resolveDispatchChainId, resolveDispatchNetwork } from './dispatch.js'
export { attestFulfillIntent, type IFulfillAttestContext, type IFulfillInput } from './fulfill.js'
export * as IntentLib from './intentLib.js'
export { attestOperateIntent, type IOperateAttestContext, type IOperateInput } from './operate.js'
export {
  attestRecognizeBalanceIntent,
  type IRecognizeBalanceAttestContext,
  type IRecognizeBalanceInput
} from './recognizeBalance.js'
export * from './rule.js'
export { attestSellIntent, type ISellAttestContext, type ISellInput } from './sell.js'
export type { IActionKind, IDraftContext, IIntentByKind } from './shared.js'
export { fetchAccount, fetchAccountOrThrow } from './shared.js'
export { attestSubscribeIntent, type ISubscribeAttestContext, type ISubscribeInput, signMandate } from './subscribe.js'
export {
  attestWithdrawToBridgeIntent,
  type IWithdrawToBridgeAttestContext,
  type IWithdrawToBridgeInput
} from './withdrawToBridge.js'
export {
  attestWithdrawToWalletIntent,
  type IWithdrawToWalletAttestContext,
  type IWithdrawToWalletInput
} from './withdrawToWallet.js'
