import { GMX, PROTOCOL } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeFunctionData, erc20Abi, type Hex, isAddressEqual, zeroAddress } from 'viem'
import { GMX_DECREASE_SWAP_TYPE, GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_ORDER_VAULT, GMX_ROUTER, GMX_ROUTER_ABI, GMX_TOKEN_SPENDER, GMX_WNT } from './contracts.js'

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
        referralCode: GMX.referralCode,
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

  if (isAddressEqual(base, PROTOCOL.nativeToken)) {
    const total = deposit + executionFee
    const createOrder = gmxCall(GMX_ROUTER, encodeGmxCreateOrder(master, GMX_WNT, order, withdraw, executionFee, true), 1_000_000n)
    return {
      callList: [gmxCall(GMX_ROUTER, gmxSendWnt(total), 150_000n, total), createOrder],
      outflows: [{ token: base, amountOut: total }]
    }
  }

  const wethBase = isAddressEqual(base, GMX_WNT)
  const createOrder = gmxCall(GMX_ROUTER, encodeGmxCreateOrder(master, base, order, withdraw, executionFee, !wethBase), 1_000_000n)

  if (wethBase) {
    const total = deposit + executionFee
    const funding = [
      gmxCall(base, gmxApprove(total), 100_000n),
      gmxCall(GMX_ROUTER, gmxSendTokens(base, executionFee), 150_000n)
    ]
    if (deposit > 0n) funding.push(gmxCall(GMX_ROUTER, gmxSendTokens(base, deposit), 150_000n))
    return {
      callList: [...funding, createOrder, gmxCall(base, gmxApprove(0n), 100_000n)],
      outflows: [{ token: base, amountOut: total }]
    }
  }

  const funding: IIAccount__Call[] = []
  if (deposit > 0n) funding.push(gmxCall(base, gmxApprove(deposit), 100_000n))
  funding.push(gmxCall(GMX_ROUTER, gmxSendWnt(executionFee), 150_000n, executionFee))
  if (deposit > 0n) funding.push(gmxCall(GMX_ROUTER, gmxSendTokens(base, deposit), 150_000n))
  const callList = [...funding, createOrder]
  if (deposit > 0n) callList.push(gmxCall(base, gmxApprove(0n), 100_000n))
  return {
    callList,
    outflows: [
      { token: PROTOCOL.nativeToken, amountOut: executionFee },
      { token: base, amountOut: deposit }
    ]
  }
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
  throw new Error(`ambiguous GMX market for index=${indexToken} collateral=${baseToken}; pass the marketToken directly`)
}
