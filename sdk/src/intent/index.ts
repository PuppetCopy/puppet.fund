import type {
  IFund__AllocateIntent,
  IHubGate__MandateIntent,
  ILiquidityGate__RetireEscrowIntent,
  IRedeem__RedeemIntent,
  IRedeem__SellIntent,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import type { Hex } from 'viem'
import type { IFundProfile } from '../account/createAccount.js'
import type { IDepositSwapInput } from './depositSwap.js'
import type { IFundSwapInput } from './fundSwap.js'
import type { IWithdrawInput } from './withdraw.js'

export { approverOf, approvesWithoutCode, type IApprovalAuthority, recoverAccountSigner, revokedAtIn, sessionDigest, sessionEnvelopeOf, sessionExpiryOf, verifyApproval, verifyFundApproval, verifyRevokeSettled } from './approval.js'

export type IDerivedInputByKind = {
  operate: ISpokeGate__OperateIntent
  mandate: IHubGate__MandateIntent
  allocate: IFund__AllocateIntent & { ownerSignature: Hex | null }
  createFund: IFund__AllocateIntent & { profile: IFundProfile; ownerSignature: Hex | null }
  redeem: IRedeem__RedeemIntent
  retireEscrow: ILiquidityGate__RetireEscrowIntent
}

export type ISelfInputByKind = {
  depositAcross: IDepositSwapInput
  withdraw: IWithdrawInput
  sell: IRedeem__SellIntent
  fundSwap: IFundSwapInput
}

export { attestAllocateIntent } from './allocate.js'
export { verifyFulfil } from './fulfil.js'
export { attestDepositSwap, type IDepositSwapInput } from './depositSwap.js'
export { attestFundSwapIntent, type IFundSwapInput } from './fundSwap.js'
export { verifyDeadline, verifyOracleFed, verifyRelayFeeRatio } from './intentLib.js'
export { attestMandateIntent } from './mandate.js'
export { allowanceTokensOf, attestOperateIntent, operateTokenList } from './operate.js'
export { attestRetireEscrowIntent } from './retireEscrow.js'
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
export {
  buildSwapParams,
  type ISwapRoute,
  type IWithdrawRoute,
  routeCalldataBytes,
  routeProvider,
  routeQuoteExpiry,
  routeSwaps,
  wrapCallData
} from './route/swap.js'
export { bestRoutePlan, type IRouteCandidate, type IRoutePlan, quoteSwapRoutes } from './route/swapRoute.js'
export { attestRedeemIntent, claimantsOf, type IRedeemSizeInput, type IRedeemSizing, planCohortLists, REDEEM_BRIDGE_MARGIN_BPS, REDEEM_FEE_BAND_BPS, redeemFeeFor, redeemLegFloorOf, redeemValuationOf, sizeRedeem, sizeRedeemAt } from './redeem.js'
export { attestSellIntent } from './sell.js'
export type {
  IAccountState,
  IActionKind,
  IDerivedAction,
  IDraftContext,
  IHeaderContext,
  IIntentByKind,
  ISealedAction
} from './shared.js'
export {
  accountDomain,
  creditTotalTypedData,
  GENESIS_NONCE,
  type IAccountBinding,
  intentTypedData,
  isActionKind,
  isDerivedAction,
  mandateDigest,
  mandateOfRow,
  verifyHeader,
  verifyHeaderOrGenesis
} from './shared.js'
export {
  ACROSS_FILLED,
  allocationTermsOf,
  clientOf,
  composeValuation,
  creditableOf,
  fromChain,
  type IAllocationCandidate,
  type IEscrowCredit,
  type IFundBook,
  type IFundState,
  type IHolderState,
  type IMandated,
  type IMandateStanding,
  type ITermsDeps,
  mandateStandingOf,
  markPrice,
  openEscrowOf,
  pinBlocks,
  readAllocationCandidates,
  readBoundParent,
  readCreditBook,
  readEscrowCredit,
  readFundBook,
  readReleased,
  exitingSharesOf,
  readFundState,
  readHolderStates,
  readMandateWindow,
  readOpening,
  readTransits,
  uncreditedOf,
  assertNoOpenTransit,
  requireFolded,
  requireFoldedOn,
  SPOKE_POOL_ABI,
  valuationRatesOf
} from './terms.js'
export { shadeQuote } from './valuation.js'
export { attestWithdrawIntent, type IWithdrawInput } from './withdraw.js'
