import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { CompactError } from '../compact/error.js'
import { decodeErc20, isRegisteredToken } from './erc20.js'
import type { IGuardReason, IGuardResult, IScreenContext } from './types.js'
import { VENUES } from './venues.js'

export interface IScreenOperateInput extends IScreenContext {
  callList: readonly IIAccount__Call[]
}

export function screenOperate(input: IScreenOperateInput): IGuardResult | null {
  const reasons: IGuardReason[] = []
  const isRelease = (to: Address): boolean => input.releaseTargets.some(r => isAddressEqual(r, to))
  let touchesVenue = false

  for (const call of input.callList) {
    const target = call.target
    if (isRelease(target)) {
      touchesVenue = true
      if (call.callData !== '0x' || call.value === 0n) {
        reasons.push({ code: 'RELEASE_BAD_SHAPE', detail: `a release to the own route ${target} is a bare native transfer` })
      }
      continue
    }
    const venue = VENUES.find(v => v.claims(input, call))
    if (venue !== undefined) {
      touchesVenue = true
      reasons.push(...venue.screen(input, call))
      continue
    }
    const erc20 = isRegisteredToken(input, target) ? decodeErc20(call.callData) : undefined
    if (erc20?.functionName === 'transfer' && input.releaseTargets.length > 0) {
      touchesVenue = true
      const [to] = erc20.args as readonly [Address, bigint]
      if (!isRelease(to)) {
        reasons.push({ code: 'RELEASE_BAD_RECEIVER', detail: `transfer receiver ${to} must be a route of the user's own bodies` })
      }
      if (call.value !== 0n) {
        reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `transfer call to ${target} forwards native value ${call.value}` })
      }
      continue
    }
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
