import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, decodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual } from 'viem'
import { CompactError } from '../compact/error.js'
import { ADDRESS_ZERO } from '../const/common.js'
import {
  GMX_DECREASE_TYPES,
  GMX_TOKEN_SPENDER,
  GMX_WNT,
  gmxVenue,
  GMX_ORDER_VAULT as ORDER_VAULT,
  GMX_ROUTER as ROUTER,
  GMX_ROUTER_ABI as ROUTER_ABI,
  traceSwapPathOutput
} from './gmx.js'
import type { IGuardReason, IGuardResult, IVenueAction } from './types.js'

export interface IOperateCall {
  target: Address
  value: bigint
  callData: Hex
}

export interface IScreenOperateInput {
  callList: readonly IOperateCall[]
  account: Address
  baseTokens: readonly Address[]
  registeredTokens: readonly Address[]
}

export interface IOperateTransfer {
  token: Address
  amountIn: bigint
  amountOut: bigint
}

function tryDecode(abi: typeof ROUTER_ABI | typeof erc20Abi, callData: Hex) {
  try {
    return decodeFunctionData({ abi, data: callData })
  } catch {
    return undefined
  }
}

function decodeRouter(callData: Hex): { functionName: string; args: readonly unknown[] } | undefined {
  const dec = tryDecode(ROUTER_ABI, callData)
  return dec ? { functionName: dec.functionName as string, args: dec.args as readonly unknown[] } : undefined
}

// One ExchangeRouter call flattened into the inner ABI calls it actually performs. A bare
// call is itself; a multicall (how app.gmx.io batches sendWnt + sendTokens + createOrder)
// becomes its decoded leg array. A nested multicall is NOT recursed: it stays a
// "multicall" leg and so trips the screen's allowlist below, which is the safe default.
function unwrapRouterCalls(callData: Hex): Array<{ functionName: string; args: readonly unknown[] }> | undefined {
  const dec = decodeRouter(callData)
  if (!dec) return undefined
  if (dec.functionName !== 'multicall') return [dec]
  const inner = dec.args[0] as readonly Hex[]
  const out: Array<{ functionName: string; args: readonly unknown[] }> = []
  for (const data of inner) {
    const d = decodeRouter(data)
    if (!d) return undefined
    out.push(d)
  }
  return out
}

// Co-sign perimeter for a GMX action the fund signs over its OWN balance. The invariant
// is that nothing the master batches can move value OUT of the fund: every ExchangeRouter
// fn is allowlisted, sendTokens/sendWnt can only credit the GMX OrderVault, every wei of
// native value must be consumed by a sendWnt to that vault (none stranded or redirected),
// and createOrder is held to gmxVenue.guard (receiver + cancellationReceiver = the fund,
// callback/uiFee zero, swapPath empty) so the position, its collateral, PnL, and even the
// execution-fee refund all settle back to the fund. baseTokens is the set of tokens the tx's
// outflow legs declare (each guarded amount-wise by its own transferList leg); registeredTokens
// is the protocol's registered set, the only constraint on collateral (closing a position returns
// it to the fund, so any registered token NAV can value is safe).
export function screenGmxOperate(input: IScreenOperateInput): IGuardResult | null {
  const reasons: IGuardReason[] = []
  const bases = input.baseTokens.map(getAddress)
  const inBases = (token: Address): boolean => bases.some(b => isAddressEqual(b, getAddress(token)))
  const registered = input.registeredTokens.map(getAddress)
  const isRegistered = (token: Address): boolean => registered.some(r => isAddressEqual(r, getAddress(token)))
  let touchesGmx = false
  const createOrders: Record<string, unknown>[] = []

  for (const c of input.callList) {
    const target = getAddress(c.target)

    if (isAddressEqual(target, ROUTER)) {
      touchesGmx = true
      const inner = unwrapRouterCalls(c.callData)
      if (!inner) {
        reasons.push({ code: 'UNDECODABLE_ROUTER_CALL', detail: 'GMX router call not decodable' })
        continue
      }
      let sendWntTotal = 0n
      for (const dec of inner) {
        if (dec.functionName === 'createOrder') {
          createOrders.push(dec.args[0] as Record<string, unknown>)
        } else if (dec.functionName === 'sendTokens') {
          const [token, receiver] = dec.args as readonly [Address, Address, bigint]
          if (!isAddressEqual(getAddress(receiver), ORDER_VAULT)) {
            reasons.push({
              code: 'SENDTOKENS_BAD_RECEIVER',
              detail: `sendTokens receiver ${receiver} must be the GMX OrderVault`
            })
          }
          if (!inBases(token)) {
            reasons.push({
              code: 'SENDTOKENS_NOT_BASE',
              detail: `sendTokens token ${token} must be a registered base token`
            })
          }
        } else if (dec.functionName === 'sendWnt') {
          const [receiver, amount] = dec.args as readonly [Address, bigint]
          if (!isAddressEqual(getAddress(receiver), ORDER_VAULT)) {
            reasons.push({
              code: 'SENDWNT_BAD_RECEIVER',
              detail: `sendWnt receiver ${receiver} must be the GMX OrderVault`
            })
          }
          sendWntTotal += amount
        } else if (dec.functionName === 'claimFundingFees') {
          const [, , receiver] = dec.args as readonly [Address[], Address[], Address]
          if (!isAddressEqual(getAddress(receiver), getAddress(input.account))) {
            reasons.push({
              code: 'CLAIM_BAD_RECEIVER',
              detail: `claimFundingFees receiver ${receiver} must be the fund ${input.account}`
            })
          }
        } else if (dec.functionName !== 'cancelOrder' && dec.functionName !== 'updateOrder') {
          reasons.push({ code: 'ROUTER_FN_FORBIDDEN', detail: `GMX router fn "${dec.functionName}" not allowed` })
        }
      }
      // Native value is the GMX execution fee and only that: it must equal the WNT the
      // batch wraps and forwards to the OrderVault, so no native can be stranded in the
      // ExchangeRouter or redirected to the caller.
      if (c.value !== sendWntTotal) {
        reasons.push({
          code: 'NATIVE_VALUE_MISMATCH',
          detail: `router call value ${c.value} must equal the sendWnt total ${sendWntTotal} forwarded to the OrderVault`
        })
      }
    } else if (inBases(target)) {
      if (c.value !== 0n) {
        reasons.push({
          code: 'NATIVE_VALUE_FORBIDDEN',
          detail: `approve call to ${target} forwards native value ${c.value}`
        })
      }
      const dec = tryDecode(erc20Abi, c.callData)
      if (dec?.functionName === 'approve') {
        // A base-token approve to the immutable GMX Router IS a recognized GMX action: the
        // allowance the ExchangeRouter pulls collateral against (app.gmx.io sends it as a
        // standalone tx). Standing/maxUint is GMX's own UX and acceptable, the spender is
        // pinned to the immutable Router and the pull only fires plugin-gated, on a screened
        // sendTokens the fund itself signs.
        touchesGmx = true
        const [spender] = dec.args as readonly [Address, bigint]
        if (!isAddressEqual(getAddress(spender), GMX_TOKEN_SPENDER)) {
          reasons.push({
            code: 'APPROVE_BAD_SPENDER',
            detail: `approve spender ${spender} must be the GMX Router ${GMX_TOKEN_SPENDER}`
          })
        }
      } else {
        reasons.push({
          code: 'BASE_FN_FORBIDDEN',
          detail: `base-token fn "${dec?.functionName ?? 'unknown'}" not allowed`
        })
      }
    } else {
      reasons.push({ code: 'FOREIGN_TARGET', detail: `call to non-perimeter target ${target}` })
      if (c.value !== 0n) {
        reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${target} forwards native value ${c.value}` })
      }
    }
  }

  if (!touchesGmx) return null

  // EVERY createOrder in the batch directs fund value independently (a TP/SL bracket sends
  // several in one multicall), and a single sendTokens deposit is attributed by GMX to the
  // order that consumes it, so each must be guarded to the fund. Guarding only one would let
  // a master pair a self-receiving order with a clean decoy and drain the collateral.
  for (const createOrder of createOrders) {
    const addresses = (createOrder.addresses ?? {}) as Record<string, unknown>
    const numbers = (createOrder.numbers ?? {}) as Record<string, unknown>
    // Collateral the fund can account for: any registered token (closing a position returns the
    // collateral to the fund, and a registered token is one NAV can value), or WETH backed by a
    // native-ETH funding leg (the NATIVE_TOKEN marker) the batch wraps. The order receiver is pinned to the fund by
    // gmxVenue.guard, so registered collateral can only ever settle back to the fund. On a decrease
    // an unregistered collateral is also accountable when the order's swapPath converts it to a
    // registered token before it lands: the receiver is still pinned, so the only constraint is that
    // the proceeds are NAV-valuable, which the traced swap output guarantees.
    const collateral = addresses.initialCollateralToken as Address | undefined
    const swapPath = (addresses.swapPath as Address[] | undefined) ?? []
    const decreaseSwapOutput =
      collateral && GMX_DECREASE_TYPES.has(Number(createOrder.orderType)) && swapPath.length > 0
        ? traceSwapPathOutput(collateral, swapPath)
        : undefined
    const collateralBacked =
      !!collateral &&
      (isRegistered(collateral) ||
        (isAddressEqual(getAddress(collateral), GMX_WNT) && bases.some(b => isAddressEqual(b, PROTOCOL.nativeToken))) ||
        (!!decreaseSwapOutput && isRegistered(decreaseSwapOutput)))
    if (!collateralBacked) {
      reasons.push({
        code: 'COLLATERAL_NOT_REGISTERED',
        detail: `collateral ${collateral ?? 'missing'} is not a registered token`
      })
    }
    const action: IVenueAction = {
      kind: 'increase',
      account: input.account,
      baseToken: collateral ? getAddress(collateral) : ADDRESS_ZERO,
      baseDelta: (numbers.initialCollateralDeltaAmount as bigint) ?? 0n,
      params: {
        orderType: Number(createOrder.orderType),
        market: addresses.market,
        receiver: addresses.receiver,
        cancellationReceiver: addresses.cancellationReceiver,
        callbackContract: addresses.callbackContract,
        uiFeeReceiver: addresses.uiFeeReceiver,
        swapPath: addresses.swapPath,
        initialCollateralToken: addresses.initialCollateralToken
      }
    }
    for (const r of gmxVenue.guard(action).reasons) reasons.push(r)
  }

  return { ok: reasons.length === 0, reasons }
}

export interface IScreenRecognizeInput {
  callList: readonly IOperateCall[]
  transferList: readonly IOperateTransfer[]
}

// Pure recognition: no calls at all, every leg only signs balance ALREADY held by the
// account (the execute shortfall check proves custody). Nothing here can move value, so
// the shape is safe to co-sign generically; the matchmaker still pins each leg's
// token <-> tokenId registry binding.
export function screenRecognizeOperate(input: IScreenRecognizeInput): IGuardResult | null {
  if (input.callList.length !== 0) return null
  const reasons: IGuardReason[] = []
  if (input.transferList.length === 0) {
    reasons.push({ code: 'RECOGNIZE_EMPTY', detail: 'recognition operate needs at least one transfer leg' })
  }
  for (const leg of input.transferList) {
    if (leg.amountIn <= 0n || leg.amountOut !== 0n) {
      reasons.push({
        code: 'RECOGNIZE_BAD_LEG',
        detail: `recognition legs only sign held balance (amountIn > 0, amountOut 0), got in ${leg.amountIn} out ${leg.amountOut}`
      })
    }
  }
  return { ok: reasons.length === 0, reasons }
}

// The outflow legs a passthrough client (wallet bridge/extension) declares for a GMX tx,
// one per token the batch moves out of the fund. sendTokens contributes its ERC-20 token,
// sendWnt contributes the native execution fee as the NATIVE_TOKEN leg (matching the registry +
// contract + canonical builder, so tokenInfoFor resolves it instead of throwing on 0x0), and a standalone
// approval (no outflow) contributes its token with amountOut 0 so the leg/screen recognize
// the action rather than defaulting to a foreign target. Amounts aggregate per token; the
// caller maps each token to its tokenId and surplus.
export function deriveGmxOutflow(callList: readonly IOperateCall[]): Array<{ token: Address; amountOut: bigint }> {
  const byToken = new Map<Address, bigint>()
  const add = (token: Address, amount: bigint): void => {
    const key = getAddress(token)
    byToken.set(key, (byToken.get(key) ?? 0n) + amount)
  }
  for (const call of callList) {
    if (isAddressEqual(getAddress(call.target), ROUTER)) {
      const inner = unwrapRouterCalls(call.callData)
      if (!inner) continue
      for (const dec of inner) {
        if (dec.functionName === 'sendTokens') {
          const [outToken, , amount] = dec.args as readonly [Address, Address, bigint]
          add(outToken, amount)
        } else if (dec.functionName === 'sendWnt') {
          const [, amount] = dec.args as readonly [Address, bigint]
          add(PROTOCOL.nativeToken, amount)
        }
      }
      continue
    }
    const dec = tryDecode(erc20Abi, call.callData)
    if (dec?.functionName !== 'approve') continue
    const [spender] = dec.args as readonly [Address, bigint]
    if (isAddressEqual(getAddress(spender), GMX_TOKEN_SPENDER)) add(call.target, 0n)
  }
  return [...byToken.entries()].map(([token, amountOut]) => ({ token: getAddress(token), amountOut }))
}

export interface IGmxOrderSummary {
  orderType: number
  kind: 'increase' | 'decrease'
  isLong: boolean | undefined
  market: Address | undefined
  collateralToken: Address | undefined
  collateralDeltaAmount: bigint
  sizeDeltaUsd: bigint
}

export function describeGmxOrders(callList: readonly IOperateCall[]): IGmxOrderSummary[] {
  const orders: IGmxOrderSummary[] = []
  for (const call of callList) {
    const inner = unwrapRouterCalls(call.callData)
    if (!inner) continue
    for (const dec of inner) {
      if (dec.functionName !== 'createOrder') continue
      const p = dec.args[0] as Record<string, unknown>
      const addresses = (p.addresses ?? {}) as Record<string, unknown>
      const numbers = (p.numbers ?? {}) as Record<string, unknown>
      const orderType = Number(p.orderType)
      orders.push({
        orderType,
        kind: GMX_DECREASE_TYPES.has(orderType) ? 'decrease' : 'increase',
        isLong: typeof p.isLong === 'boolean' ? p.isLong : undefined,
        market: addresses.market as Address | undefined,
        collateralToken: addresses.initialCollateralToken as Address | undefined,
        collateralDeltaAmount: (numbers.initialCollateralDeltaAmount as bigint) ?? 0n,
        sizeDeltaUsd: (numbers.sizeDeltaUsd as bigint) ?? 0n
      })
    }
  }
  return orders
}

export function assertOperateSignable(result: IGuardResult | null): void {
  if (result === null) {
    throw new CompactError('UNKNOWN_OPERATE', 'operate is not a recognized accountable venue action', 'hard')
  }
  if (result.ok) return
  const first = result.reasons[0] as IGuardReason
  throw new CompactError(first.code, result.reasons.map(r => r.detail).join('; '), 'hard')
}
