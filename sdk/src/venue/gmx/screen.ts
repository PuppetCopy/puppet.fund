import { GMX, PROTOCOL } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeAbiParameters, getAddress, type Hex, isAddressEqual, size, zeroAddress } from 'viem'
import type { ChainId } from '../../const/index.js'
import { resolveIndexToken } from '../../evaluate/platform/gmx.js'
import { decodeErc20, isRegisteredToken } from '../erc20.js'
import type { IGuardReason, IOperateStep, IScreenContext, IVenue } from '../types.js'
import {
  GMX_ADMITTED_ORDER_TYPES,
  GMX_DECREASE_TYPES,
  GMX_INCREASE_TYPES,
  GMX_MAX_SWAP_PATH_LENGTH,
  GMX_ORDER_VAULT,
  GMX_ROUTER,
  GMX_SWAP_TYPES,
  GMX_TOKEN_SPENDER,
  GMX_UI_FEE_RECEIVER,
  GMX_V2_CHAIN_ID,
  GMX_WNT
} from './contracts.js'
import { gmxOutflows, traceSwapPathOutput, unwrapRouterCalls } from './decode.js'

const MULTICALL_SELECTOR = '0xac9650d8'
const BYTES_LIST_HEAD = '0x0000000000000000000000000000000000000000000000000000000000000020'

type ICreateOrderParams = {
  addresses: {
    receiver: Address
    cancellationReceiver: Address
    callbackContract: Address
    uiFeeReceiver: Address
    market: Address
    initialCollateralToken: Address
    swapPath: readonly Address[]
  }
  numbers: { sizeDeltaUsd: bigint; initialCollateralDeltaAmount: bigint; triggerPrice: bigint; acceptablePrice: bigint; executionFee: bigint }
  orderType: number
  decreasePositionSwapType: number
  isLong: boolean
  shouldUnwrapNativeToken: boolean
  referralCode: Hex
}

function screenCreateOrder(ctx: IScreenContext, order: ICreateOrderParams): IGuardReason[] {
  const reasons: IGuardReason[] = []
  const { addresses } = order
  const orderType = Number(order.orderType)
  const collateral = addresses.initialCollateralToken
  const swapPath = addresses.swapPath
  const arrives = (token: Address | undefined): boolean =>
    token !== undefined &&
    (isAddressEqual(token, GMX_WNT) ? isRegisteredToken(ctx, order.shouldUnwrapNativeToken ? PROTOCOL.nativeToken : GMX_WNT) : isRegisteredToken(ctx, token))
  const swapOutput = swapPath.length > 0 ? traceSwapPathOutput(collateral, swapPath) : undefined

  if (!GMX_ADMITTED_ORDER_TYPES.has(orderType)) {
    reasons.push({ code: 'ORDER_TYPE_FORBIDDEN', detail: `order type ${orderType} is not an admitted GMX order type` })
  }
  if (GMX_SWAP_TYPES.has(orderType)) {
    if (swapPath.length === 0) reasons.push({ code: 'SWAP_OUTPUT_NOT_REGISTERED', detail: 'a swap order carries no swap path, so nothing arrives' })
    else if (!arrives(swapOutput)) {
      reasons.push({ code: 'SWAP_OUTPUT_NOT_REGISTERED', detail: `swap output ${swapOutput ?? 'untraceable'} is not a registered token; it would arrive unvalued` })
    }
  } else {
    if (resolveIndexToken(addresses.market) === undefined) {
      reasons.push({ code: 'UNKNOWN_MARKET', detail: `market ${addresses.market} is not a priceable GMX market` })
    }
    if (GMX_INCREASE_TYPES.has(orderType)) {
      const positionCollateral = swapPath.length > 0 ? swapOutput : collateral
      if (!arrives(positionCollateral)) {
        reasons.push({
          code: 'COLLATERAL_NOT_REGISTERED',
          detail: `position collateral ${positionCollateral ?? 'missing'} is not a registered token; it would come back unvalued`
        })
      }
    } else if (GMX_DECREASE_TYPES.has(orderType)) {
      const market = ARBITRUM_MARKET_LIST.find(m => isAddressEqual(m.marketToken as Address, addresses.market))
      const pnlToken = market ? ((order.isLong ? market.longToken : market.shortToken) as Address) : undefined
      if (!arrives(collateral)) {
        reasons.push({ code: 'COLLATERAL_NOT_REGISTERED', detail: `collateral ${collateral} is not a registered token; it would come back unvalued` })
      }
      if (!arrives(pnlToken)) {
        reasons.push({
          code: 'PNL_TOKEN_NOT_REGISTERED',
          detail: `pnl token ${pnlToken ?? 'unknown'} of a ${order.isLong ? 'long' : 'short'} on ${addresses.market} is not a registered token; profit would arrive unvalued`
        })
      }
      if (swapPath.length > 0 && !arrives(swapOutput)) {
        reasons.push({ code: 'SWAP_OUTPUT_NOT_REGISTERED', detail: `swap output ${swapOutput ?? 'untraceable'} is not a registered token; it would arrive unvalued` })
      }
    }
  }
  if (!isAddressEqual(addresses.receiver, ctx.account)) {
    reasons.push({ code: 'RECEIVER_NOT_ACCOUNT', detail: `receiver ${addresses.receiver} must equal the account ${ctx.account}` })
  }
  if (!isAddressEqual(addresses.cancellationReceiver, zeroAddress) && !isAddressEqual(addresses.cancellationReceiver, ctx.account)) {
    reasons.push({ code: 'CANCEL_RECEIVER_NOT_ACCOUNT', detail: `cancellationReceiver ${addresses.cancellationReceiver} must be zero or the account ${ctx.account}` })
  }
  if (!isAddressEqual(addresses.callbackContract, zeroAddress)) {
    reasons.push({ code: 'CALLBACK_FORBIDDEN', detail: `callbackContract ${addresses.callbackContract} must be zero` })
  }
  if (!isAddressEqual(addresses.uiFeeReceiver, zeroAddress) && !isAddressEqual(addresses.uiFeeReceiver, GMX_UI_FEE_RECEIVER)) {
    reasons.push({ code: 'UI_FEE_FORBIDDEN', detail: `uiFeeReceiver ${addresses.uiFeeReceiver} must be zero or the GMX UI marker ${GMX_UI_FEE_RECEIVER}` })
  }
  if (swapPath.length > GMX_MAX_SWAP_PATH_LENGTH) {
    reasons.push({ code: 'SWAPPATH_TOO_LONG', detail: `swapPath length ${swapPath.length} exceeds ${GMX_MAX_SWAP_PATH_LENGTH}` })
  }
  for (const hop of swapPath) {
    if (!ARBITRUM_MARKET_LIST.some(m => isAddressEqual(m.marketToken as Address, hop))) {
      reasons.push({ code: 'SWAPPATH_UNKNOWN_MARKET', detail: `swapPath hop ${hop} is not a registered GMX market` })
    }
  }
  if (order.referralCode.toLowerCase() !== GMX.referralCode.toLowerCase()) {
    reasons.push({
      code: 'REFERRAL_CODE_FORBIDDEN',
      detail: `referralCode ${order.referralCode} must be the protocol code ${GMX.referralCode}; any other code routes affiliate rebates on the account's fees elsewhere`
    })
  }
  return reasons
}

function screenRouterCall(ctx: IScreenContext, call: IIAccount__Call): IGuardReason[] {
  const reasons: IGuardReason[] = []
  const inner = unwrapRouterCalls(call.callData)
  if (!inner) return [{ code: 'UNDECODABLE_ROUTER_CALL', detail: 'GMX router call not decodable' }]
  let sendWntTotal = 0n
  for (const dec of inner) {
    if (dec.functionName === 'createOrder') {
      reasons.push(...screenCreateOrder(ctx, dec.args[0] as ICreateOrderParams))
    } else if (dec.functionName === 'sendTokens') {
      const [token, receiver] = dec.args as readonly [Address, Address, bigint]
      if (!isAddressEqual(receiver, GMX_ORDER_VAULT)) {
        reasons.push({ code: 'SENDTOKENS_BAD_RECEIVER', detail: `sendTokens receiver ${receiver} must be the GMX OrderVault` })
      }
      if (!isRegisteredToken(ctx, token)) {
        reasons.push({ code: 'SENDTOKENS_NOT_BASE', detail: `sendTokens token ${token} must be a registered token` })
      }
    } else if (dec.functionName === 'sendWnt') {
      const [receiver, amount] = dec.args as readonly [Address, bigint]
      if (!isAddressEqual(receiver, GMX_ORDER_VAULT)) {
        reasons.push({ code: 'SENDWNT_BAD_RECEIVER', detail: `sendWnt receiver ${receiver} must be the GMX OrderVault` })
      }
      sendWntTotal += amount
    } else if (dec.functionName === 'claimFundingFees' || dec.functionName === 'claimCollateral') {
      const receiver = dec.args[dec.args.length - 1] as Address
      if (!isAddressEqual(receiver, ctx.account)) {
        reasons.push({ code: 'CLAIM_BAD_RECEIVER', detail: `${dec.functionName} receiver ${receiver} must be the account ${ctx.account}` })
      }
    } else if (dec.functionName !== 'cancelOrder' && dec.functionName !== 'updateOrder') {
      reasons.push({ code: 'ROUTER_FN_FORBIDDEN', detail: `GMX router fn "${dec.functionName}" not allowed` })
    }
  }
  if (call.value !== sendWntTotal) {
    reasons.push({ code: 'NATIVE_VALUE_MISMATCH', detail: `router call value ${call.value} must equal the sendWnt total ${sendWntTotal} forwarded to the OrderVault` })
  }
  return reasons
}

function screenApproval(call: IIAccount__Call): IGuardReason[] {
  const reasons: IGuardReason[] = []
  if (call.value !== 0n) {
    reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `approve call to ${call.target} forwards native value ${call.value}` })
  }
  const dec = decodeErc20(call.callData)
  if (dec?.functionName !== 'approve') return reasons
  const [spender] = dec.args as readonly [Address, bigint]
  if (!isAddressEqual(spender, GMX_TOKEN_SPENDER)) {
    reasons.push({ code: 'APPROVE_BAD_SPENDER', detail: `approve spender ${spender} must be the GMX Router ${GMX_TOKEN_SPENDER}` })
  }
  return reasons
}

function describeRouterCall(call: IIAccount__Call, returned: Hex | undefined, sent: Map<Address, bigint>): IOperateStep[] {
  const innerResults: readonly Hex[] =
    returned === undefined
      ? []
      : call.callData.startsWith(MULTICALL_SELECTOR)
        ? returned.startsWith(BYTES_LIST_HEAD)
          ? decodeAbiParameters([{ type: 'bytes[]' }], returned)[0]
          : []
        : [returned]
  const steps: IOperateStep[] = []
  ;(unwrapRouterCalls(call.callData) ?? []).forEach((dec, j) => {
    if (dec.functionName === 'sendTokens') {
      const [token, , amount] = dec.args as readonly [Address, Address, bigint]
      sent.set(getAddress(token), (sent.get(getAddress(token)) ?? 0n) + amount)
    } else if (dec.functionName === 'sendWnt') {
      const [, amount] = dec.args as readonly [Address, bigint]
      sent.set(GMX_WNT, (sent.get(GMX_WNT) ?? 0n) + amount)
    } else if (dec.functionName === 'createOrder') {
      const p = dec.args[0] as ICreateOrderParams
      const collateralToken = getAddress(p.addresses.initialCollateralToken)
      const swapPath = p.addresses.swapPath.map(h => getAddress(h))
      const increase = GMX_INCREASE_TYPES.has(Number(p.orderType))
      const funded = (sent.get(collateralToken) ?? 0n) - (isAddressEqual(collateralToken, GMX_WNT) ? p.numbers.executionFee : 0n)
      sent.clear()
      const key = innerResults[j]
      steps.push({
        kind: 'gmx-order',
        key: key !== undefined && size(key) === 32 ? key : null,
        orderType: Number(p.orderType),
        market: getAddress(p.addresses.market),
        isLong: p.isLong,
        sizeDeltaUsd: p.numbers.sizeDeltaUsd,
        collateralToken,
        collateralDelta: increase ? funded : p.numbers.initialCollateralDeltaAmount,
        positionCollateralToken: swapPath.length > 0 ? traceSwapPathOutput(collateralToken, swapPath) : collateralToken,
        triggerPrice: p.numbers.triggerPrice,
        acceptablePrice: p.numbers.acceptablePrice,
        executionFee: p.numbers.executionFee,
        swapPath,
        decreasePositionSwapType: Number(p.decreasePositionSwapType)
      })
    } else if (dec.functionName === 'cancelOrder') {
      steps.push({ kind: 'gmx-cancel', key: dec.args[0] as Hex })
    } else if (dec.functionName === 'updateOrder') {
      const [key, sizeDeltaUsd, acceptablePrice, triggerPrice] = dec.args as readonly [Hex, bigint, bigint, bigint]
      steps.push({ kind: 'gmx-update', key, sizeDeltaUsd, acceptablePrice, triggerPrice })
    } else if (dec.functionName === 'claimFundingFees' || dec.functionName === 'claimCollateral') {
      const [markets, tokens] = dec.args as readonly [readonly Address[], readonly Address[]]
      steps.push({
        kind: 'gmx-claim',
        claim: dec.functionName === 'claimFundingFees' ? 'funding' : 'collateral',
        markets: markets.map(m => getAddress(m)),
        tokens: tokens.map(t => getAddress(t))
      })
    }
  })
  return steps
}

export const gmxVenue: IVenue = {
  venueId: 'gmx',
  claims(ctx, call) {
    if (ctx.chainId !== GMX_V2_CHAIN_ID) return false
    if (isAddressEqual(call.target, GMX_ROUTER)) return true
    return isRegisteredToken(ctx, call.target) && decodeErc20(call.callData)?.functionName === 'approve'
  },
  screen(ctx, call) {
    return isAddressEqual(call.target, GMX_ROUTER) ? screenRouterCall(ctx, call) : screenApproval(call)
  },
  outflows: gmxOutflows,
  describe(chainId: ChainId, callList, resultList) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== GMX_V2_CHAIN_ID) return out
    const sent = new Map<Address, bigint>()
    callList.forEach((call, i) => {
      if (!isAddressEqual(call.target, GMX_ROUTER)) return
      out.set(i, describeRouterCall(call, resultList?.[i], sent))
    })
    return out
  },
  typedData() {
    return null
  }
}
