import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress } from 'viem'
import { CompactError } from '../compact/error.js'
import { decodeErc20, isRegisteredToken } from './erc20.js'
import type { IGuardReason, IGuardResult, IScreenContext } from './types.js'
import { VENUES } from './venues.js'

interface IScreenOperateInput extends IScreenContext {
  callList: readonly IIAccount__Call[]
}

export function screenOperate(input: IScreenOperateInput): IGuardResult | null {
  const reasons: IGuardReason[] = []
  let touchesVenue = false

  for (const call of input.callList) {
    const target = call.target
    const venue = VENUES.find(v => v.claims(input, call))
    if (venue !== undefined) {
      touchesVenue = true
      reasons.push(...venue.screen(input, call))
      continue
    }
    const erc20 = isRegisteredToken(input, target) ? decodeErc20(call.callData) : undefined
    if (erc20 !== undefined) {
      reasons.push({ code: 'BASE_FN_FORBIDDEN', detail: `token fn "${erc20.functionName}" on ${target} is not an admitted venue action` })
      continue
    }
    reasons.push({ code: 'FOREIGN_TARGET', detail: `call to non-perimeter target ${target}` })
    if (call.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${target} forwards native value ${call.value}` })
    }
  }

  if (!touchesVenue) return reasons.length === 0 ? null : { ok: false, reasons }
  return { ok: reasons.length === 0, reasons }
}

export function operateOutflows(callList: readonly IIAccount__Call[]): { token: Address; amount: bigint }[] {
  const out: { token: Address; amount: bigint }[] = []
  for (const call of callList) {
    if (call.value > 0n) out.push({ token: getAddress(PROTOCOL.nativeToken), amount: call.value })
    for (const venue of VENUES) out.push(...venue.outflows(call))
  }
  return out
}

export function assertOperateSignable(result: IGuardResult | null): void {
  if (result === null) {
    throw new CompactError('UNKNOWN_OPERATE', 'operate is not a recognized accountable venue action', 'hard')
  }
  if (result.ok) return
  const first = result.reasons[0] as IGuardReason
  throw new CompactError(first.code, result.reasons.map(r => r.detail).join('; '), 'hard')
}
