import type { IAllocateInput } from './allocate.js'
import type { IClaimInput } from './claim.js'
import type { IDepositRoute } from './depositRoute.js'
import type { ILiquidateInput } from './liquidate.js'
import type { IMandateInput } from './mandate.js'
import type { IOperateInput } from './operate.js'
import type { IFundRecognizeInput, IRecognizeBalanceInput } from './recognizeBalance.js'
import type { IRedeemInput } from './redeem.js'
import type { ISellInput } from './sell.js'
import type { IFundSwapInput, ISwapInput } from './swap.js'
import type { IWithdrawInput } from './withdraw.js'
import type { IWrapInput } from './wrap.js'

export type IInputByKind = {
  mandate: IMandateInput
  allocate: IAllocateInput
  operate: IOperateInput
  sell: ISellInput
  claim: IClaimInput
  redeem: IRedeemInput
  liquidate: ILiquidateInput
  recognize: IRecognizeBalanceInput
  fundRecognize: IFundRecognizeInput
  swap: ISwapInput
  fundSwap: IFundSwapInput
  wrap: IWrapInput
  withdraw: IWithdrawInput
  walletDeposit: IDepositRoute
  walletDepositWnt: IDepositRoute
}

export { ACROSS_PERIPHERY, acrossSpokePoolOf, buildAcrossDeposit, decodeAcrossDeposit } from './acrossDeposit.js'
export {
  decodeAcrossSwapAndBridge,
  type IAcrossSwapAndBridgeData,
  type IAcrossSwapPin,
  verifyAcrossSwapAndBridge
} from './acrossSwapAndBridge.js'
export { attestAllocateIntent, type IAllocateInput, type IAllocateRulePosition } from './allocate.js'
export { attestClaimIntent, type IClaimInput } from './claim.js'
export {
  computeAllocation,
  type IAllocationPuppet,
  type IAllocationResult,
  type IComputeAllocationContext,
  permittedAllocationCap
} from './computeAllocation.js'
export type { IDepositMode, IDepositRoute } from './depositRoute.js'
export { resolveDispatchChainId } from './dispatch.js'
export * as IntentLib from './intentLib.js'
export { attestLiquidateIntent, type ILiquidateInput } from './liquidate.js'
export {
  attestMandateIntent,
  type IMandateInput,
  type IMandateRule,
  signMandate,
  verifyMandateRuleSignatures
} from './mandate.js'
export { attestOperateIntent, type IOperateInput } from './operate.js'
export {
  attestFundRecognizeIntent,
  attestRecognizeBalanceIntent,
  type IFundRecognizeInput,
  type IRecognizeBalanceInput
} from './recognizeBalance.js'
export { attestRedeemIntent, type IRedeemInput } from './redeem.js'
export * from './rule.js'
export { attestSellIntent, type ISellInput } from './sell.js'
export type { IActionKind, IDraftContext, IIntentByKind } from './shared.js'
export { WEIGHT_RATIO_CAP } from './shared.js'
export {
  attestFundSwapIntent,
  attestSwapIntent,
  type IFundSwapInput,
  type ISwapInput,
  type ISwapRoute
} from './swap.js'
export { SWAP_MAX_SLIPPAGE_BPS, verifyOutputFloor, verifyQuoteFreshness, verifySwapQuoteRatio } from './swapGuard.js'
export { attestWithdrawIntent, type IAcrossSwapRoute, type IWithdrawInput, type IWithdrawRoute } from './withdraw.js'
export { attestWrapIntent, type IWrapInput } from './wrap.js'
