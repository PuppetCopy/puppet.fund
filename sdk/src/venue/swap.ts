import { type Address, decodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual } from 'viem'
import { ACROSS_SPOKE_POOL, decodeAcrossDeposit } from '../attestation/acrossDeposit.js'
import { ADDRESS_ZERO } from '../const/common.js'
import type { IOperateCall, IOperateTransfer } from './operate.js'
import type { IGuardReason, IGuardResult } from './types.js'

// The focused swap venue: a same-chain swap (LI.FI) and a cross-chain swap (a bridge, via Across)
// are one external value-transformation interface. operate (trading/investing) delegates here rather
// than carrying this logic.
export const LIFI_DIAMOND: Address = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

function tryDecode(callData: Hex) {
  try {
    return decodeFunctionData({ abi: erc20Abi, data: callData })
  } catch {
    return undefined
  }
}

export interface IScreenSwapInput {
  chainId: number
  account: Address
  callList: readonly IOperateCall[]
  transferList: readonly IOperateTransfer[]
}

// The recognized shape is approve(tokenIn) -> provider swap -> approve(tokenIn, 0) with
// exactly two transfer legs: the declared tokenIn outflow covering the approval, and a
// positive tokenOut amountIn. Native input (token 0) collapses to the bare provider call
// carrying the declared outflow as msg.value; native output needs no shape change. The
// account's post-balance shortfall check turns the signed amountIn into an on-chain
// minimum-delivery guard, so output redirection or excess slippage reverts at execution.
export function screenSameChainSwap(input: IScreenSwapInput): IGuardResult | null {
  if (!input.callList.some(c => isAddressEqual(getAddress(c.target), LIFI_DIAMOND))) return null

  const reasons: IGuardReason[] = []
  const fail = (code: string, detail: string): IGuardResult => ({ ok: false, reasons: [{ code, detail }] })

  if (input.transferList.length !== 2) {
    return fail('SWAP_BAD_SHAPE', `swap needs exactly 2 transfer legs, got ${input.transferList.length}`)
  }
  const [inLeg, outLeg] = input.transferList as [IOperateTransfer, IOperateTransfer]
  const nativeIn = isAddressEqual(getAddress(inLeg.token), ADDRESS_ZERO)

  if (input.callList.length !== (nativeIn ? 1 : 3)) {
    return fail(
      'SWAP_BAD_SHAPE',
      `swap needs exactly ${nativeIn ? 1 : 3} calls for ${nativeIn ? 'native' : 'erc20'} input, got ${input.callList.length}`
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
    const dec = tryDecode(call.callData)
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

// A cross-chain swap is an Across deposit the fund signs over its OWN balance: approve(token)
// -> SpokePool.deposit -> approve(token, 0) with ONE outflow leg covering the deposit.
// The calldata must round-trip through the strict builder decode so every field is
// pinnable: depositor AND recipient are the fund itself (same CREATE2 address on the
// destination chain), so the value cannot leave the account's perimeter. The in/out amount
// ratio and destination-token registry binding are the matchmaker's checks, since they need
// a live registry.
export function screenCrossChainSwap(
  input: IScreenSwapInput
): { result: IGuardResult | null; decoded: ReturnType<typeof decodeAcrossDeposit> } {
  const spokePool = ACROSS_SPOKE_POOL[input.chainId]
  if (!spokePool || !input.callList.some(c => isAddressEqual(getAddress(c.target), spokePool))) {
    return { result: null, decoded: null }
  }

  const fail = (code: string, detail: string) => ({ result: { ok: false, reasons: [{ code, detail }] }, decoded: null })
  if (input.callList.length !== 3) {
    return fail('BRIDGE_BAD_SHAPE', `cross-chain swap needs exactly 3 calls, got ${input.callList.length}`)
  }
  if (input.transferList.length !== 1) {
    return fail('BRIDGE_BAD_SHAPE', `cross-chain swap needs exactly 1 transfer leg, got ${input.transferList.length}`)
  }

  const reasons: IGuardReason[] = []
  const [approveCall, depositCall, resetCall] = input.callList as [IOperateCall, IOperateCall, IOperateCall]
  const leg = input.transferList[0] as IOperateTransfer

  if (leg.amountIn !== 0n || leg.amountOut <= 0n) {
    reasons.push({ code: 'BRIDGE_BAD_LEG', detail: 'leg must declare a positive amountOut and no amountIn' })
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
    return { result: { ok: false, reasons }, decoded: null }
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
    reasons.push({ code: 'BRIDGE_SAME_CHAIN', detail: 'cross-chain swap destination must be a different chain' })
  }

  screenApproveSandwich(reasons, approveCall, resetCall, leg.token, spokePool, leg.amountOut)

  return { result: { ok: reasons.length === 0, reasons }, decoded }
}

// Single entry for an external value-transformation swap: same-chain (LI.FI) or cross-chain (Across).
// Dispatches on the provider target and, for a cross-chain swap, returns the decoded Across deposit so
// the caller never re-decodes. A null result means it is not a swap (the caller falls through to the
// GMX/operate screen).
export function screenSwap(input: IScreenSwapInput): {
  result: IGuardResult | null
  crossChain: ReturnType<typeof decodeAcrossDeposit>
} {
  if (input.callList.some(c => isAddressEqual(getAddress(c.target), LIFI_DIAMOND))) {
    return { result: screenSameChainSwap(input), crossChain: null }
  }
  const { result, decoded } = screenCrossChainSwap(input)
  return { result, crossChain: decoded }
}
