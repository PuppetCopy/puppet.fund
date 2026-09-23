import type {
  IFund__AllocateIntent,
  IFund__RedeemIntent,
  IFund__SellIntent,
  IHubGate__MandateIntent,
  ILiquidityGate__EscrowIntent,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import type { IFundProfile } from '../account/createAccount.js'
import type { IDepositSwapInput } from './depositSwap.js'
import type { IFundSwapInput } from './fundSwap.js'
import type { IWithdrawInput } from './withdraw.js'

export { approverOf, type IApprovalAuthority, sessionDigest, verifyApproval } from './approval.js'

export type IDerivedInputByKind = {
  operate: ISpokeGate__OperateIntent
  mandate: IHubGate__MandateIntent
  allocate: IFund__AllocateIntent
  createFund: IFund__AllocateIntent & { profile: IFundProfile }
  redeem: IFund__RedeemIntent
}

export type ISelfInputByKind = {
  depositAcross: IDepositSwapInput
  withdraw: IWithdrawInput
  sell: IFund__SellIntent
  escrow: ILiquidityGate__EscrowIntent
  fundSwap: IFundSwapInput
}

export {
  ACROSS_PERIPHERY,
  acrossSpokePoolOf,
  buildAcrossDeposit,
  type IAcrossRouteFields,
  type IAcrossTiming,
  quoteAcrossDeposit,
  readAcrossBuffers
} from './route/acrossDeposit.js'
export { decodeAcrossSwapAndBridge, quoteAcrossSwapAndBridge } from './route/acrossSwapAndBridge.js'
export { attestAllocateIntent } from './allocate.js'
export { attestDepositSwap, type IDepositSwapInput } from './depositSwap.js'
export { attestEscrowIntent } from './escrow.js'
export { attestFundSwapIntent, type IFundSwapInput } from './fundSwap.js'
export { verifyDeadline, verifyRegisteredTokenCap, verifyRelayFeeRatio } from './intentLib.js'
export { quoteKyberSwap } from './route/kyberSwap.js'
export { quoteLifiSwap } from './route/lifiSwap.js'
export { attestMandateIntent } from './mandate.js'
export { allowanceTokensOf, attestOperateIntent } from './operate.js'
export { attestRedeemIntent } from './redeem.js'
export { attestSellIntent } from './sell.js'
export type {
  IAccountState,
  IActionKind,
  IDerivedAction,
  IDraftContext,
  IHeaderContext,
  IIntentByKind,
  IScheduledKind,
  ISealedAction
} from './shared.js'
export {
  accountDomain,
  BODY_GENESIS_NONCE,
  type IAccountBinding,
  intentTypedData,
  isActionKind,
  isDerivedAction,
  mandateDigest,
  mandateOfRow,
  USER_GENESIS_NONCE,
  verifyHeader,
  verifyHeaderOrGenesis
} from './shared.js'
export {
  buildSwapParams,
  type ISwapRoute,
  type IWithdrawRoute,
  routeCalldataBytes,
  routeProvider,
  routeQuoteExpiry
} from './route/swap.js'
export {
  bestRoutePlan,
  deliveredLeg,
  type IRouteCandidate,
  type IRouteLane,
  type IRoutePlan,
  quoteSwapRoutes
} from './route/swapRoute.js'
export {
  allocationTermsOf,
  clientOf,
  composeValuation,
  creditableOf,
  fromChain,
  type IAllocationCandidate,
  type IEscrowCredit,
  type IFundState,
  type ITermsDeps,
  pinBlocks,
  readAllocationBlock,
  readAllocationCandidates,
  readBoundParent,
  readEscrowCredit,
  readFundState,
  readPoolPosition,
  readTransits,
  valuationRatesOf
} from './terms.js'
export { recoverAccountSigner, verifyAccountCall } from './verify.js'
export { attestWithdrawIntent, type IWithdrawInput } from './withdraw.js'
