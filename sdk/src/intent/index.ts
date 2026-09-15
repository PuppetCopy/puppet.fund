import type { ICoreGate__OperateIntent, ICoreGate__SettleIntent, IHubGate__DrawIntent, IHubGate__MandateIntent, IHubGate__UnbondIntent } from '@puppet/contracts/types'
import type { IScheduledCredit } from './credit.js'
import type { IDepositSwapInput } from './depositSwap.js'
import type { IWithdrawInput } from './withdraw.js'

export type IDerivedInputByKind = {
  operate: ICoreGate__OperateIntent
  settle: ICoreGate__SettleIntent
  draw: IHubGate__DrawIntent
  mandate: IHubGate__MandateIntent
}

export type ISelfInputByKind = {
  depositAcross: IDepositSwapInput
  credit: IScheduledCredit
  withdraw: IWithdrawInput
  unbond: IHubGate__UnbondIntent
}

export {
  ACROSS_PERIPHERY,
  acrossSpokePoolOf,
  decodeAcrossDeposit,
  type IAcrossRouteFields,
  type IAcrossTiming,
  quoteAcrossDeposit,
  readAcrossBuffers
} from './acrossDeposit.js'
export { decodeAcrossSwapAndBridge, quoteAcrossSwapAndBridge } from './acrossSwapAndBridge.js'
export {
  attestScheduledCredit,
  type ICreditListContext,
  type IDepositCredit,
  type IScheduledCredit,
  MAX_SCHEDULE_TTL_SEC,
  SCHEDULED_CREDIT_TYPES,
  scheduledCreditTypedData,
  verifyClaimWindow,
  verifyCreditList
} from './credit.js'
export { attestDepositSwap, type IDepositSwapAttestContext, type IDepositSwapInput, routeHolding } from './depositSwap.js'
export {
  verifyDeadline,
  verifyRegisteredTokenCap,
  verifyRelayFeeRatio
} from './intentLib.js'
export { quoteLifiSwap } from './lifiSwap.js'
export { attestMandateIntent, type IMandateAttestContext } from './mandate.js'
export { attestOperateIntent, type IOperateAttestContext } from './operate.js'
export { attestDrawIntent, attestSettleIntent, type IDrawAttestContext, type ISettleAttestContext } from './settle.js'
export type {
  IActionKind,
  IBodyArgs,
  IDerivedAction,
  IDraftContext,
  IGenesisClaim,
  IHeaderContext,
  IIntentByKind,
  ISealedAction
} from './shared.js'
export {
  accountDomain,
  backingListHash,
  creditListHash,
  gainListHash,
  type IAccountBinding,
  intentTypedData,
  isActionKind,
  isDerivedAction,
  lossListHash,
  mandateDigest,
  mandateListHash,
  mandateTypedData,
  verifyBody,
  verifyGenesis,
  verifyHeader,
  verifyMandateRow
} from './shared.js'
export {
  type ISwapRoute,
  type IWithdrawRoute,
  routeCalldataBytes,
  routeProvider, 
  routeQuoteExpiry
} from './swap.js'
export {
  bestRoutePlan,
  deliveredLeg,
  type IRouteBoundsRequest,
  type IRouteCandidate,
  type IRouteEndpoints,
  type IRouteLane,
  type IRoutePlan,
  type ISignedLeg,
  quoteSwapRoutes
} from './swapRoute.js'
export {
  assertCycleSettled,
  COHORT_MIN_STAKE,
  carriedValue,
  fromChronicle,
  type IBookState,
  type IOperateTerms,
  type IOperateTermsContext,
  type ISettleTerms,
  type ISettleTermsContext,
  type ITermsDeps,
  mandateOf,
  openCycleOf,
  operateTermsOf,
  readBondStanding,
  readBonds,
  readBookState,
  readCollateral,
  readMandates,
  readOpenBacking,
  readOperateContext,
  readSettleContext,
  readSettlement,
  sealedValuationOf,
  settleTermsOf,
  valuationOf
} from './terms.js'
export { attestUnbondIntent, type IUnbondAttestContext } from './unbond.js'
export { type IAccountCallProof, type IBodyAuthority, landedSignature, recoverAccountSigner, verifyAccountCall } from './verify.js'
export {
  attestWithdrawIntent,
  type IWithdrawAttestContext,
  type IWithdrawInput,
  type IWithdrawLegs,
  withdrawSwapParams
} from './withdraw.js'
