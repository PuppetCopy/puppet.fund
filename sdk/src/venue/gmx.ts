import { GMX_REFERRAL_CODE } from '@puppet/contracts/const'
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
import { gmxEvaluator, resolveIndexToken } from '../evaluation/platform/gmx.js'
import type { IPlatformEvalParams, IPlatformValuation } from '../evaluation/types.js'
import type { IGuardReason, IGuardResult, IVenue, IVenueAction } from './types.js'

const VENUE_ID = 'gmx'

export const GMX_ROUTER = getAddress(GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address)
export const GMX_ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
export const GMX_ORDER_VAULT = getAddress(GMX_V2_CONTRACT_MAP.GmxOrderVault.address)

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

export interface IGmxBuildResult {
  callList: IIAccount__Call[]
  amountIn: bigint
  amountOut: bigint
}

function gmxCall(target: Address, callData: Hex, gasLimit: bigint): IIAccount__Call {
  return { target, value: 0n, gasLimit, callData }
}

function gmxApprove(amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [GMX_ROUTER, amount] })
}

function gmxSendTokens(token: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'sendTokens', args: [token, GMX_ORDER_VAULT, amount] })
}

function encodeGmxCreateOrder(
  receiver: Address,
  collateralToken: Address,
  order: IGmxOrder,
  collateralDeltaAmount: bigint,
  executionFee: bigint
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
        decreasePositionSwapType: order.decreaseSwapType ?? 0,
        isLong: order.isLong,
        shouldUnwrapNativeToken: false,
        autoCancel: order.autoCancel ?? false,
        referralCode: GMX_REFERRAL_CODE,
        dataList: []
      }
    ]
  })
}

export function buildGmxOrderCalls(order: IGmxOrder, ctx: IGmxBuildContext): IGmxBuildResult {
  const { master, baseToken, executionFee } = ctx
  if (GMX_INCREASE_TYPES.has(order.orderType)) {
    const total = order.collateralDelta + executionFee
    return {
      callList: [
        gmxCall(baseToken, gmxApprove(total), 100_000n),
        gmxCall(GMX_ROUTER, gmxSendTokens(baseToken, executionFee), 150_000n),
        gmxCall(GMX_ROUTER, gmxSendTokens(baseToken, order.collateralDelta), 150_000n),
        gmxCall(GMX_ROUTER, encodeGmxCreateOrder(master, baseToken, order, 0n, executionFee), 1_000_000n)
      ],
      amountIn: 0n,
      amountOut: total
    }
  }
  if (GMX_DECREASE_TYPES.has(order.orderType)) {
    return {
      callList: [
        gmxCall(baseToken, gmxApprove(executionFee), 100_000n),
        gmxCall(GMX_ROUTER, gmxSendTokens(baseToken, executionFee), 150_000n),
        gmxCall(
          GMX_ROUTER,
          encodeGmxCreateOrder(master, baseToken, order, order.collateralDelta, executionFee),
          1_000_000n
        )
      ],
      amountIn: 0n,
      amountOut: executionFee
    }
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

    const cancellationReceiver = p.cancellationReceiver as Address | undefined
    if (cancellationReceiver && getAddress(cancellationReceiver) !== getAddress(action.account)) {
      reasons.push({
        code: 'CANCEL_RECEIVER_NOT_ACCOUNT',
        detail: `cancellationReceiver must equal account ${action.account}`
      })
    }

    const callback = p.callbackContract as Address | undefined
    if (callback && getAddress(callback) !== zeroAddress) {
      reasons.push({ code: 'CALLBACK_FORBIDDEN', detail: `callbackContract ${callback} must be zero` })
    }

    const uiFeeReceiver = p.uiFeeReceiver as Address | undefined
    if (uiFeeReceiver && getAddress(uiFeeReceiver) !== zeroAddress) {
      reasons.push({ code: 'UI_FEE_FORBIDDEN', detail: 'uiFeeReceiver must be zero' })
    }

    const swapPath = p.swapPath
    if (Array.isArray(swapPath) && swapPath.length > 0) {
      reasons.push({ code: 'SWAPPATH_FORBIDDEN', detail: 'swapPath must be empty in v1' })
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
