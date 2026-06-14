import { CHAIN_TOKEN_MAP, GMX_REFERRAL_CODE, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST, GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  zeroAddress
} from 'viem'
import { gmxEvaluator, resolveIndexToken } from '../evaluate/platform/gmx.js'
import type { IPlatformEvalParams, IPlatformValuation } from '../evaluate/types.js'
import type { IGuardReason, IGuardResult, IVenue, IVenueAction } from './types.js'

const VENUE_ID = 'gmx'

// The CALL target for createOrder/sendTokens/cancel/update — the mutable ExchangeRouter facade.
export const GMX_ROUTER = getAddress(GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address)
export const GMX_ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
export const GMX_ORDER_VAULT = getAddress(GMX_V2_CONTRACT_MAP.GmxOrderVault.address)
// The ERC-20 allowance SPENDER — the immutable SyntheticsRouter. ExchangeRouter.sendTokens
// pulls collateral via Router.pluginTransfer -> transferFrom, executed BY this Router, so the
// fund must approve THIS, not the ExchangeRouter. (Verified on-chain: ExchangeRouter.router().)
export const GMX_TOKEN_SPENDER = getAddress(GMX_V2_CONTRACT_MAP.GmxRouter.address)

// The fixed GMX UI-attribution marker app.gmx.io stamps on orders (0xff0000 prefix, not a
// payout address). Allowed as the only non-zero uiFeeReceiver: its on-chain uiFeeFactor is
// GMX-controlled and capped at MAX_UI_FEE_FACTOR (10 bps), so a master cannot point the fee
// at themselves. setUiFeeFactor has no access control, hence an arbitrary receiver is a self-skim.
const GMX_UI_FEE_RECEIVER = getAddress('0xff00000000000000000000000000000000000001')
// On-chain MAX_SWAP_PATH_LENGTH (gmx-synthetics): collateral may convert through at most 3 pools.
const GMX_MAX_SWAP_PATH_LENGTH = 3

// Hub WETH: GMX's wrapped-native (WNT). Native ETH collateral is wrapped to this, and the
// execution fee is always WNT, so a fund funding with native ETH backs a WETH collateral.
export const GMX_WNT = getAddress(CHAIN_TOKEN_MAP[HUB_CHAIN_ID].WETH as Address)

export const GMX_ORDER_TYPE = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  StopIncrease: 8
} as const

export const GMX_DECREASE_SWAP_TYPE = {
  NoSwap: 0,
  SwapPnlTokenToCollateralToken: 1,
  SwapCollateralTokenToPnlToken: 2
} as const

export const GMX_INCREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

export const GMX_DECREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketDecrease,
  GMX_ORDER_TYPE.LimitDecrease,
  GMX_ORDER_TYPE.StopLossDecrease
])

const ALLOWED_ORDER_TYPES: ReadonlySet<number> = new Set([...GMX_INCREASE_TYPES, ...GMX_DECREASE_TYPES])

const POSITION_KEY_TYPES = [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'bool' }] as const

export interface IGmxOrder {
  orderType: number
  market: Address
  isLong: boolean
  sizeDeltaUsd: bigint
  collateralDelta: bigint
  executionFee?: bigint
  acceptablePrice?: bigint
  triggerPrice?: bigint
  minOutputAmount?: bigint
  decreaseSwapType?: number
  swapPath?: Address[]
  autoCancel?: boolean
}

export interface IGmxBuildContext {
  master: Address
  baseToken: Address
  executionFee: bigint
}

export interface IGmxOutflow {
  token: Address
  amountOut: bigint
}

export interface IGmxBuildResult {
  callList: IIAccount__Call[]
  outflows: IGmxOutflow[]
}

function gmxCall(target: Address, callData: Hex, gasLimit: bigint, value = 0n): IIAccount__Call {
  return { target, value, gasLimit, callData }
}

function gmxApprove(amount: bigint): Hex {
  // Approve the immutable Router (the transferFrom spender), NOT the ExchangeRouter facade.
  return encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [GMX_TOKEN_SPENDER, amount] })
}

function gmxSendTokens(token: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'sendTokens', args: [token, GMX_ORDER_VAULT, amount] })
}

function gmxSendWnt(amount: bigint): Hex {
  return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'sendWnt', args: [GMX_ORDER_VAULT, amount] })
}

function encodeGmxCreateOrder(
  receiver: Address,
  collateralToken: Address,
  order: IGmxOrder,
  collateralDeltaAmount: bigint,
  executionFee: bigint,
  shouldUnwrapNativeToken: boolean
): Hex {
  return encodeFunctionData({
    abi: GMX_ROUTER_ABI,
    functionName: 'createOrder',
    args: [
      {
        addresses: {
          receiver,
          cancellationReceiver: receiver,
          callbackContract: zeroAddress,
          uiFeeReceiver: zeroAddress,
          market: order.market,
          initialCollateralToken: collateralToken,
          swapPath: order.swapPath ?? []
        },
        numbers: {
          sizeDeltaUsd: order.sizeDeltaUsd,
          initialCollateralDeltaAmount: collateralDeltaAmount,
          triggerPrice: order.triggerPrice ?? 0n,
          acceptablePrice: order.acceptablePrice ?? 0n,
          executionFee,
          callbackGasLimit: 0n,
          minOutputAmount: order.minOutputAmount ?? 0n,
          validFromTime: 0n
        },
        orderType: order.orderType,
        // Default closes to swap PnL into the collateral token so profit returns on the
        // signed base leg. With NoSwap, PnL of a position whose pnl token differs from the
        // collateral (e.g. a USDC-base long on a WETH market) pays out in a token with no
        // signed leg, leaving it fund-custodied but unrecognizable/unwithdrawable. A caller
        // who handles the pnl token itself can override to NoSwap.
        decreasePositionSwapType: order.decreaseSwapType ?? GMX_DECREASE_SWAP_TYPE.SwapPnlTokenToCollateralToken,
        isLong: order.isLong,
        shouldUnwrapNativeToken,
        autoCancel: order.autoCancel ?? false,
        referralCode: GMX_REFERRAL_CODE,
        dataList: []
      }
    ]
  })
}

// Builds the calls + per-token outflow legs for a GMX order over any registered base token.
// The execution fee is always WNT: a WETH base pays it (and the collateral) in WETH via
// sendTokens (WETH IS WNT); a native-ETH base funds collateral + fee with one sendWnt; any
// other ERC-20 base sends collateral via sendTokens and the fee as native ETH via sendWnt.
// shouldUnwrapNativeToken returns WNT outputs (freed collateral, fee refunds) as native ETH
// EXCEPT for a WETH base, which keeps them as WETH so they settle back onto its WETH leg.
// Outflows always include the base-token leg (amountOut 0 on a decrease) so a close re-signs
// the freed collateral on the next order. The collateral GMX records is the base token, or
// WETH when the base is native ETH (GMX wraps it).
export function buildGmxOrderCalls(order: IGmxOrder, ctx: IGmxBuildContext): IGmxBuildResult {
  const { master, executionFee } = ctx
  const base = getAddress(ctx.baseToken)
  const nativeBase = isAddressEqual(base, zeroAddress)
  const wethBase = isAddressEqual(base, GMX_WNT)
  const collateralToken = nativeBase ? GMX_WNT : base
  const unwrap = !wethBase

  if (GMX_INCREASE_TYPES.has(order.orderType)) {
    const collateral = order.collateralDelta
    if (wethBase) {
      const total = collateral + executionFee
      return {
        callList: [
          gmxCall(base, gmxApprove(total), 100_000n),
          gmxCall(GMX_ROUTER, gmxSendTokens(base, executionFee), 150_000n),
          gmxCall(GMX_ROUTER, gmxSendTokens(base, collateral), 150_000n),
          gmxCall(
            GMX_ROUTER,
            encodeGmxCreateOrder(master, collateralToken, order, 0n, executionFee, unwrap),
            1_000_000n
          )
        ],
        outflows: [{ token: base, amountOut: total }]
      }
    }
    if (nativeBase) {
      const total = collateral + executionFee
      return {
        callList: [
          gmxCall(GMX_ROUTER, gmxSendWnt(total), 200_000n, total),
          gmxCall(
            GMX_ROUTER,
            encodeGmxCreateOrder(master, collateralToken, order, 0n, executionFee, unwrap),
            1_000_000n
          )
        ],
        outflows: [{ token: zeroAddress, amountOut: total }]
      }
    }
    return {
      callList: [
        gmxCall(base, gmxApprove(collateral), 100_000n),
        gmxCall(GMX_ROUTER, gmxSendWnt(executionFee), 150_000n, executionFee),
        gmxCall(GMX_ROUTER, gmxSendTokens(base, collateral), 150_000n),
        gmxCall(GMX_ROUTER, encodeGmxCreateOrder(master, collateralToken, order, 0n, executionFee, unwrap), 1_000_000n)
      ],
      outflows: [
        { token: base, amountOut: collateral },
        { token: zeroAddress, amountOut: executionFee }
      ]
    }
  }
  if (GMX_DECREASE_TYPES.has(order.orderType)) {
    if (wethBase) {
      return {
        callList: [
          gmxCall(base, gmxApprove(executionFee), 100_000n),
          gmxCall(GMX_ROUTER, gmxSendTokens(base, executionFee), 150_000n),
          gmxCall(
            GMX_ROUTER,
            encodeGmxCreateOrder(master, collateralToken, order, order.collateralDelta, executionFee, unwrap),
            1_000_000n
          )
        ],
        outflows: [{ token: base, amountOut: executionFee }]
      }
    }
    const callList = [
      gmxCall(GMX_ROUTER, gmxSendWnt(executionFee), 150_000n, executionFee),
      gmxCall(
        GMX_ROUTER,
        encodeGmxCreateOrder(master, collateralToken, order, order.collateralDelta, executionFee, unwrap),
        1_000_000n
      )
    ]
    const outflows: IGmxOutflow[] = nativeBase
      ? [{ token: zeroAddress, amountOut: executionFee }]
      : [
          { token: base, amountOut: 0n },
          { token: zeroAddress, amountOut: executionFee }
        ]
    return { callList, outflows }
  }
  throw new Error(`unsupported GMX order type ${order.orderType} for a single-base-token operator`)
}

export function selectGmxMarket(baseToken: Address, indexToken: Address): Address {
  const matches = ARBITRUM_MARKET_LIST.filter(
    m =>
      isAddressEqual(m.indexToken as Address, indexToken) &&
      (isAddressEqual(m.longToken as Address, baseToken) || isAddressEqual(m.shortToken as Address, baseToken))
  )
  if (matches.length === 0) throw new Error(`GMX market not found for index=${indexToken} collateral=${baseToken}`)
  if (matches.length === 1) return matches[0].marketToken as Address
  const canonical = matches.filter(
    m => isAddressEqual(m.longToken as Address, baseToken) && !isAddressEqual(m.shortToken as Address, baseToken)
  )
  if (canonical.length === 1) return canonical[0].marketToken as Address
  throw new Error(
    `ambiguous GMX market for index=${indexToken} collateral=${baseToken} — pass the marketToken directly`
  )
}

export const gmxVenue: IVenue = {
  venueId: VENUE_ID,

  subkey(params: Record<string, unknown>): Hex {
    const account = getAddress(params.account as Address)
    const market = getAddress(params.market as Address)
    const collateralToken = getAddress(params.collateralToken as Address)
    const isLong = Boolean(params.isLong)
    return keccak256(encodeAbiParameters(POSITION_KEY_TYPES, [account, market, collateralToken, isLong]))
  },

  mark(params: IPlatformEvalParams): Promise<IPlatformValuation> {
    return gmxEvaluator.evaluate(params)
  },

  guard(action: IVenueAction): IGuardResult {
    const reasons: IGuardReason[] = []
    const p = action.params

    const orderType = p.orderType
    if (typeof orderType !== 'number' || !ALLOWED_ORDER_TYPES.has(orderType)) {
      reasons.push({
        code: 'ORDER_TYPE_FORBIDDEN',
        detail: `order type ${String(orderType)} not in the allowed increase/decrease set`
      })
    }

    const market = p.market as Address | undefined
    if (!market || resolveIndexToken(market) === undefined) {
      reasons.push({ code: 'UNKNOWN_MARKET', detail: `market ${market} not registered/priceable` })
    }

    const receiver = p.receiver as Address | undefined
    if (!receiver || getAddress(receiver) !== getAddress(action.account)) {
      reasons.push({
        code: 'RECEIVER_NOT_ACCOUNT',
        detail: `receiver ${receiver} must equal account ${action.account}`
      })
    }

    // Zero is the canonical value (app.gmx.io always sends it): on-chain it defaults to
    // order.account()/order.receiver(), both the fund, so the cancel refund cannot leave.
    // A non-zero address other than the fund WOULD drain the order's collateral on cancel.
    const cancellationReceiver = p.cancellationReceiver as Address | undefined
    if (
      cancellationReceiver &&
      getAddress(cancellationReceiver) !== zeroAddress &&
      getAddress(cancellationReceiver) !== getAddress(action.account)
    ) {
      reasons.push({
        code: 'CANCEL_RECEIVER_NOT_ACCOUNT',
        detail: `cancellationReceiver ${cancellationReceiver} must be zero or the account ${action.account}`
      })
    }

    const callback = p.callbackContract as Address | undefined
    if (callback && getAddress(callback) !== zeroAddress) {
      reasons.push({ code: 'CALLBACK_FORBIDDEN', detail: `callbackContract ${callback} must be zero` })
    }

    const uiFeeReceiver = p.uiFeeReceiver as Address | undefined
    if (
      uiFeeReceiver &&
      getAddress(uiFeeReceiver) !== zeroAddress &&
      getAddress(uiFeeReceiver) !== GMX_UI_FEE_RECEIVER
    ) {
      reasons.push({
        code: 'UI_FEE_FORBIDDEN',
        detail: `uiFeeReceiver ${uiFeeReceiver} must be zero or the GMX UI marker ${GMX_UI_FEE_RECEIVER}`
      })
    }

    // A swap path only converts the fund's collateral inside GMX (output credited to the
    // fund-owned position / order.receiver, never to the master), so it cannot exfiltrate.
    // Bound it: at most MAX_SWAP_PATH_LENGTH hops, each a registered GMX market.
    const swapPath = p.swapPath
    if (Array.isArray(swapPath) && swapPath.length > 0) {
      if (swapPath.length > GMX_MAX_SWAP_PATH_LENGTH) {
        reasons.push({
          code: 'SWAPPATH_TOO_LONG',
          detail: `swapPath length ${swapPath.length} exceeds ${GMX_MAX_SWAP_PATH_LENGTH}`
        })
      }
      for (const hop of swapPath as Address[]) {
        if (!ARBITRUM_MARKET_LIST.some(m => isAddressEqual(m.marketToken as Address, getAddress(hop)))) {
          reasons.push({
            code: 'SWAPPATH_UNKNOWN_MARKET',
            detail: `swapPath hop ${hop} is not a registered GMX market`
          })
        }
      }
    }

    const collateralToken = p.initialCollateralToken as Address | undefined
    if (collateralToken && getAddress(collateralToken) !== getAddress(action.baseToken)) {
      reasons.push({
        code: 'COLLATERAL_NOT_BASE',
        detail: `collateral ${collateralToken} must equal base ${action.baseToken}`
      })
    }

    return { ok: reasons.length === 0, reasons }
  }
}
