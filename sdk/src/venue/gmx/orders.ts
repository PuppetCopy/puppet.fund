import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, erc20Abi, type Hex, isAddressEqual, zeroAddress } from 'viem'
import { GMX_DECREASE_SWAP_TYPE, GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_ORDER_VAULT, GMX_REFERRAL_CODE, GMX_ROUTER, GMX_ROUTER_ABI, GMX_TOKEN_SPENDER, GMX_WNT } from './contracts.js'

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

interface IGmxBuildContext {
  master: Address
  baseToken: Address
  executionFee: bigint
}

interface IGmxOutflow {
  token: Address
  amountOut: bigint
}

interface IGmxBuildResult {
  callList: IIAccount__Call[]
  outflows: IGmxOutflow[]
}

function gmxCall(target: Address, callData: Hex, gasLimit: bigint, value = 0n): IIAccount__Call {
  return { target, value, gasLimit, callData }
}

function gmxApprove(amount: bigint): Hex {
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

export function buildGmxOrderCalls(order: IGmxOrder, ctx: IGmxBuildContext): IGmxBuildResult {
  const { master, executionFee } = ctx
  const base = ctx.baseToken
  const isIncrease = GMX_INCREASE_TYPES.has(order.orderType)
  if (!isIncrease && !GMX_DECREASE_TYPES.has(order.orderType)) {
    throw new Error(`unsupported GMX order type ${order.orderType} for a single-base-token operator`)
  }
  const deposit = isIncrease ? order.collateralDelta : 0n
  const withdraw = isIncrease ? 0n : order.collateralDelta
  const routerCall = (legs: readonly Hex[], value: bigint): IIAccount__Call =>
    gmxCall(GMX_ROUTER, encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'multicall', args: [legs] }), 1_000_000n + 150_000n * BigInt(legs.length - 1), value)

  if (isAddressEqual(base, PROTOCOL.nativeToken)) {
    const total = deposit + executionFee
    return {
      callList: [routerCall([gmxSendWnt(total), encodeGmxCreateOrder(master, GMX_WNT, order, withdraw, executionFee, true)], total)],
      outflows: [{ token: base, amountOut: total }]
    }
  }

  const wethBase = isAddressEqual(base, GMX_WNT)
  const createOrder = encodeGmxCreateOrder(master, base, order, withdraw, executionFee, !wethBase)

  if (wethBase) {
    const total = deposit + executionFee
    return {
      callList: [gmxCall(base, gmxApprove(total), 100_000n), routerCall([gmxSendTokens(base, total), createOrder], 0n), gmxCall(base, gmxApprove(0n), 100_000n)],
      outflows: [{ token: base, amountOut: total }]
    }
  }

  const router = routerCall(deposit > 0n ? [gmxSendWnt(executionFee), gmxSendTokens(base, deposit), createOrder] : [gmxSendWnt(executionFee), createOrder], executionFee)
  return {
    callList: deposit > 0n ? [gmxCall(base, gmxApprove(deposit), 100_000n), router, gmxCall(base, gmxApprove(0n), 100_000n)] : [router],
    outflows: [
      { token: PROTOCOL.nativeToken, amountOut: executionFee },
      { token: base, amountOut: deposit }
    ]
  }
}
