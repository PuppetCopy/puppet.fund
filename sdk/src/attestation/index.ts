import type { IAllocateInput } from './allocate.js'
import type { IBridgeInput } from './bridge.js'
import type { IBridgeToWalletInput } from './bridgeToWallet.js'
import type { IClaimInput } from './claim.js'
import type { ICreatePuppetAccountInput } from './createAccount.js'
import type { ICreateMasterInput } from './createMaster.js'
import type { ICreateMasterAccountInput } from './createMasterAccount.js'
import type { IDepositRoute } from './depositRoute.js'
import type { IFulfillInput } from './fulfill.js'
import type { IOperateInput } from './operate.js'
import type { IRecognizeBalanceInput } from './recognizeBalance.js'
import type { ISellInput } from './sell.js'
import type { ISubscribeInput } from './subscribe.js'
import type { IWithdrawInput } from './withdraw.js'

export type IInputByKind = {
  subscribe: ISubscribeInput
  createPuppetAccount: ICreatePuppetAccountInput
  createMasterAccount: ICreateMasterAccountInput
  seedMasterAccount: ICreateMasterInput
  allocate: IAllocateInput
  operate: IOperateInput
  sell: ISellInput
  claim: IClaimInput
  fulfill: IFulfillInput
  recognize: IRecognizeBalanceInput
  walletWithdraw: IWithdrawInput
  walletWithdrawWnt: IWithdrawInput
  bridge: IBridgeInput
  bridgeToWallet: IBridgeToWalletInput
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
export {
  attestBridgeToWalletIntent,
  type IBridgeToWalletAttestContext,
  type IBridgeToWalletInput
} from './bridgeToWallet.js'
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
  attestCreateMasterIntent,
  type ICreateMasterAttestContext,
  type ICreateMasterInput
} from './createMaster.js'
export {
  attestCreateMasterAccountIntent,
  type ICreateMasterAccountAttestContext,
  type ICreateMasterAccountInput
} from './createMasterAccount.js'
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
export { attestWithdrawIntent, type IWithdrawAttestContext, type IWithdrawInput } from './withdraw.js'
