import { type Address, decodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual } from 'viem'
import { ACROSS_SPOKE_POOL, decodeAcrossDeposit } from '../attestation/acrossDeposit.js'
import { CompactError } from '../compact/error.js'
import { ADDRESS_ZERO } from '../const/common.js'
import {
  GMX_TOKEN_SPENDER,
  GMX_WNT,
  gmxVenue,
  GMX_ORDER_VAULT as ORDER_VAULT,
  GMX_ROUTER as ROUTER,
  GMX_ROUTER_ABI as ROUTER_ABI
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
}

export const LIFI_DIAMOND: Address = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

export interface IOperateTransfer {
  tokenId: Hex
  token: Address
  amountIn: bigint
  amountOut: bigint
}

export interface IScreenSwapInput {
  callList: readonly IOperateCall[]
  transferList: readonly IOperateTransfer[]
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
// execution-fee refund all settle back to the fund. baseTokens is the registered set of
// tokens the legs declare; collateral and any sendTokens token must be one of them.
export function screenGmxOperate(input: IScreenOperateInput): IGuardResult | null {
  const reasons: IGuardReason[] = []
  const bases = input.baseTokens.map(getAddress)
  const inBases = (token: Address): boolean => bases.some(b => isAddressEqual(b, getAddress(token)))
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
    // A native-ETH funding leg (token 0) backs a WETH collateral: GMX wraps the deposited
    // native value into WETH, so the WETH the order records is exactly the value the signed
    // ETH leg accounts. Strict membership for any other collateral.
    const collateral = addresses.initialCollateralToken as Address | undefined
    const collateralBacked =
      !!collateral &&
      (inBases(collateral) ||
        (isAddressEqual(getAddress(collateral), GMX_WNT) && bases.some(b => isAddressEqual(b, ADDRESS_ZERO))))
    if (!collateralBacked) {
      reasons.push({
        code: 'COLLATERAL_NOT_BASE',
        detail: `collateral ${collateral} must be a registered base token (or WETH backed by a native ETH leg)`
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

// The recognized shape is approve(tokenIn) -> provider swap -> approve(tokenIn, 0) with
// exactly two transfer legs: the declared tokenIn outflow covering the approval, and a
// positive tokenOut amountIn. Native input (token 0) collapses to the bare provider call
// carrying the declared outflow as msg.value; native output needs no shape change. The
// account's post-balance shortfall check turns the signed amountIn into an on-chain
// minimum-delivery guard, so output redirection or excess slippage reverts at execution.
export function screenSwapOperate(input: IScreenSwapInput): IGuardResult | null {
  if (!input.callList.some(c => isAddressEqual(getAddress(c.target), LIFI_DIAMOND))) return null

  const reasons: IGuardReason[] = []
  const fail = (code: string, detail: string): IGuardResult => ({ ok: false, reasons: [{ code, detail }] })

  if (input.transferList.length !== 2) {
    return fail('SWAP_BAD_SHAPE', `swap operate needs exactly 2 transfer legs, got ${input.transferList.length}`)
  }
  const [inLeg, outLeg] = input.transferList as [IOperateTransfer, IOperateTransfer]
  const nativeIn = isAddressEqual(getAddress(inLeg.token), ADDRESS_ZERO)

  if (input.callList.length !== (nativeIn ? 1 : 3)) {
    return fail(
      'SWAP_BAD_SHAPE',
      `swap operate needs exactly ${nativeIn ? 1 : 3} calls for ${nativeIn ? 'native' : 'erc20'} input, got ${input.callList.length}`
    )
  }
  const swapCall = (nativeIn ? input.callList[0] : input.callList[1]) as IOperateCall

  if (inLeg.tokenId === outLeg.tokenId || isAddressEqual(getAddress(inLeg.token), getAddress(outLeg.token))) {
    reasons.push({ code: 'SWAP_SAME_TOKEN', detail: 'swap legs must move two distinct tokens' })
  }
  if (inLeg.amountIn !== 0n || inLeg.amountOut <= 0n) {
    reasons.push({ code: 'SWAP_BAD_INPUT_LEG', detail: 'input leg must declare a positive amountOut and no amountIn' })
  }
  if (outLeg.amountOut !== 0n || outLeg.amountIn <= 0n) {
    reasons.push({
      code: 'SWAP_BAD_OUTPUT_LEG',
      detail: 'output leg must declare a positive amountIn and no amountOut'
    })
  }

  if (!isAddressEqual(getAddress(swapCall.target), LIFI_DIAMOND)) {
    reasons.push({ code: 'SWAP_BAD_PROVIDER', detail: `swap call target ${swapCall.target} is not the LI.FI diamond` })
  }
  if (nativeIn ? swapCall.value !== inLeg.amountOut : swapCall.value !== 0n) {
    reasons.push({
      code: nativeIn ? 'SWAP_BAD_NATIVE_VALUE' : 'NATIVE_VALUE_FORBIDDEN',
      detail: nativeIn
        ? `swap call value ${swapCall.value} must equal the declared native outflow ${inLeg.amountOut}`
        : `swap call forwards native value ${swapCall.value}`
    })
  }
  if (swapCall.callData === '0x') {
    reasons.push({ code: 'SWAP_EMPTY_CALLDATA', detail: 'swap provider calldata is empty' })
  }

  if (!nativeIn) {
    const [approveCall, , resetCall] = input.callList as [IOperateCall, IOperateCall, IOperateCall]
    screenApproveSandwich(reasons, approveCall, resetCall, inLeg.token, LIFI_DIAMOND, inLeg.amountOut)
  }

  return { ok: reasons.length === 0, reasons }
}

// The approve/reset pair around a provider call: both target the input token, both spend
// to the pinned provider, the opening grant covered by the declared outflow, the closing
// grant zero.
function screenApproveSandwich(
  reasons: IGuardReason[],
  approveCall: IOperateCall,
  resetCall: IOperateCall,
  token: Address,
  spenderTarget: Address,
  maxAmount: bigint
): void {
  for (const [label, call, expectedAmount] of [
    ['approve', approveCall, null],
    ['reset', resetCall, 0n]
  ] as const) {
    if (!isAddressEqual(getAddress(call.target), getAddress(token))) {
      reasons.push({ code: 'SWAP_BAD_APPROVE_TARGET', detail: `${label} call must target the input token` })
      continue
    }
    if (call.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `${label} call forwards native value ${call.value}` })
    }
    const dec = tryDecode(erc20Abi, call.callData)
    if (dec?.functionName !== 'approve') {
      reasons.push({ code: 'SWAP_BAD_APPROVE', detail: `${label} call must be an erc20 approve` })
      continue
    }
    const [spender, amount] = dec.args as readonly [Address, bigint]
    if (!isAddressEqual(getAddress(spender), spenderTarget)) {
      reasons.push({ code: 'APPROVE_BAD_SPENDER', detail: `${label} spender ${spender} must be ${spenderTarget}` })
    }
    if (expectedAmount === null ? amount > maxAmount : amount !== expectedAmount) {
      reasons.push({
        code: 'SWAP_BAD_APPROVE_AMOUNT',
        detail: `${label} amount ${amount} must ${expectedAmount === null ? `not exceed the declared outflow ${maxAmount}` : 'be zero'}`
      })
    }
  }
}

export interface IScreenBridgeInput {
  chainId: number
  account: Address
  callList: readonly IOperateCall[]
  transferList: readonly IOperateTransfer[]
}

// A fund bridge is an Across deposit the fund signs over its OWN balance: approve(token)
// -> SpokePool.deposit -> approve(token, 0) with ONE outflow leg covering the deposit.
// The calldata must round-trip through the strict builder decode so every field is
// pinnable: depositor AND recipient are the fund itself (same CREATE2 address on the
// destination chain), so the bridged value cannot leave the account's perimeter. The
// in/out amount ratio and destination-token registry binding are the matchmaker's checks,
// since they need a live registry.
export function screenBridgeOperate(input: IScreenBridgeInput): IGuardResult | null {
  const spokePool = ACROSS_SPOKE_POOL[input.chainId]
  if (!spokePool || !input.callList.some(c => isAddressEqual(getAddress(c.target), spokePool))) return null

  const fail = (code: string, detail: string): IGuardResult => ({ ok: false, reasons: [{ code, detail }] })
  if (input.callList.length !== 3) {
    return fail('BRIDGE_BAD_SHAPE', `bridge operate needs exactly 3 calls, got ${input.callList.length}`)
  }
  if (input.transferList.length !== 1) {
    return fail('BRIDGE_BAD_SHAPE', `bridge operate needs exactly 1 transfer leg, got ${input.transferList.length}`)
  }

  const reasons: IGuardReason[] = []
  const [approveCall, depositCall, resetCall] = input.callList as [IOperateCall, IOperateCall, IOperateCall]
  const leg = input.transferList[0] as IOperateTransfer

  if (leg.amountIn !== 0n || leg.amountOut <= 0n) {
    reasons.push({ code: 'BRIDGE_BAD_LEG', detail: 'bridge leg must declare a positive amountOut and no amountIn' })
  }
  if (!isAddressEqual(getAddress(depositCall.target), spokePool)) {
    reasons.push({
      code: 'BRIDGE_BAD_PROVIDER',
      detail: `deposit call target ${depositCall.target} is not the Across SpokePool`
    })
  }
  if (depositCall.value !== 0n) {
    reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `deposit call forwards native value ${depositCall.value}` })
  }

  const decoded = decodeAcrossDeposit(depositCall.callData)
  if (!decoded) {
    reasons.push({
      code: 'BRIDGE_UNDECODABLE',
      detail: 'deposit calldata does not match the canonical Across deposit shape'
    })
    return { ok: false, reasons }
  }
  if (!isAddressEqual(decoded.depositor, input.account) || !isAddressEqual(decoded.recipient, input.account)) {
    reasons.push({
      code: 'BRIDGE_BAD_RECIPIENT',
      detail: `depositor ${decoded.depositor} and recipient ${decoded.recipient} must both be the fund ${input.account}`
    })
  }
  if (!isAddressEqual(decoded.inputToken, getAddress(leg.token))) {
    reasons.push({
      code: 'BRIDGE_BAD_INPUT_TOKEN',
      detail: `deposit inputToken ${decoded.inputToken} must be the leg token ${leg.token}`
    })
  }
  // The signed outflow IS the deposit pull: equality keeps the fund's signed-balance
  // debit exactly matching what the SpokePool moves (an excess would self-strand value).
  if (decoded.inputAmount !== leg.amountOut) {
    reasons.push({
      code: 'BRIDGE_UNCOVERED_INPUT',
      detail: `deposit inputAmount ${decoded.inputAmount} must equal the declared outflow ${leg.amountOut}`
    })
  }
  // No exclusive relayer: an exclusivity grant would let a master route the in/out spread
  // to a relayer they control. Open-auction fill forces arms-length competition.
  if (!isAddressEqual(decoded.exclusiveRelayer, ADDRESS_ZERO) || decoded.exclusivityParameter !== 0) {
    reasons.push({
      code: 'BRIDGE_EXCLUSIVE_RELAYER',
      detail: `deposit must use open-auction fill (exclusiveRelayer ${decoded.exclusiveRelayer}, exclusivity ${decoded.exclusivityParameter})`
    })
  }
  if (decoded.destinationChainId === BigInt(input.chainId)) {
    reasons.push({ code: 'BRIDGE_SAME_CHAIN', detail: 'bridge destination must be a different chain' })
  }

  screenApproveSandwich(reasons, approveCall, resetCall, leg.token, spokePool, leg.amountOut)

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
// sendWnt contributes the native execution fee as the ETH leg (token 0), and a standalone
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
          add(ADDRESS_ZERO, amount)
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

export function assertOperateSignable(result: IGuardResult | null): void {
  if (result === null) {
    throw new CompactError('UNKNOWN_OPERATE', 'operate is not a recognized accountable venue action', 'hard')
  }
  if (result.ok) return
  const first = result.reasons[0] as IGuardReason
  throw new CompactError(first.code, result.reasons.map(r => r.detail).join('; '), 'hard')
}
