import { type Address, decodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual } from 'viem'
import { CompactError } from '../compact/error.js'
import { gmxVenue, GMX_ORDER_VAULT as ORDER_VAULT, GMX_ROUTER as ROUTER, GMX_ROUTER_ABI as ROUTER_ABI } from './gmx.js'
import type { IGuardReason, IGuardResult, IVenueAction } from './types.js'

export interface IOperateCall {
  target: Address
  value: bigint
  callData: Hex
}

export interface IScreenOperateInput {
  callList: readonly IOperateCall[]
  account: Address
  baseToken: Address
}

function tryDecode(abi: typeof ROUTER_ABI | typeof erc20Abi, callData: Hex) {
  try {
    return decodeFunctionData({ abi, data: callData })
  } catch {
    return undefined
  }
}

export function screenGmxOperate(input: IScreenOperateInput): IGuardResult | null {
  const reasons: IGuardReason[] = []
  const base = getAddress(input.baseToken)
  let touchesGmx = false
  let createOrder: Record<string, unknown> | undefined

  for (const c of input.callList) {
    const target = getAddress(c.target)
    if (c.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${target} forwards native value ${c.value}` })
    }

    if (isAddressEqual(target, ROUTER)) {
      touchesGmx = true
      const dec = tryDecode(ROUTER_ABI, c.callData)
      if (!dec) {
        reasons.push({ code: 'UNDECODABLE_ROUTER_CALL', detail: 'GMX router call not decodable' })
      } else if (dec.functionName === 'createOrder') {
        createOrder = (dec.args as readonly unknown[])[0] as Record<string, unknown>
      } else if (dec.functionName === 'sendTokens') {
        const [token, receiver] = dec.args as readonly [Address, Address, bigint]
        if (!isAddressEqual(getAddress(receiver), ORDER_VAULT)) {
          reasons.push({
            code: 'SENDTOKENS_BAD_RECEIVER',
            detail: `sendTokens receiver ${receiver} must be the GMX OrderVault`
          })
        }
        if (!isAddressEqual(getAddress(token), base)) {
          reasons.push({ code: 'SENDTOKENS_NOT_BASE', detail: `sendTokens token ${token} must be the base token` })
        }
      } else if (dec.functionName !== 'cancelOrder' && dec.functionName !== 'updateOrder') {
        reasons.push({ code: 'ROUTER_FN_FORBIDDEN', detail: `GMX router fn "${dec.functionName}" not allowed` })
      }
    } else if (isAddressEqual(target, base)) {
      const dec = tryDecode(erc20Abi, c.callData)
      if (dec?.functionName === 'approve') {
        const [spender] = dec.args as readonly [Address, bigint]
        if (!isAddressEqual(getAddress(spender), ROUTER)) {
          reasons.push({ code: 'APPROVE_BAD_SPENDER', detail: `approve spender ${spender} must be the GMX Router` })
        }
      } else {
        reasons.push({
          code: 'BASE_FN_FORBIDDEN',
          detail: `base-token fn "${dec?.functionName ?? 'unknown'}" not allowed`
        })
      }
    } else {
      reasons.push({ code: 'FOREIGN_TARGET', detail: `call to non-perimeter target ${target}` })
    }
  }

  if (!touchesGmx) return null

  if (createOrder) {
    const addresses = (createOrder.addresses ?? {}) as Record<string, unknown>
    const numbers = (createOrder.numbers ?? {}) as Record<string, unknown>
    const action: IVenueAction = {
      kind: 'increase',
      account: input.account,
      baseToken: input.baseToken,
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

export function assertOperateSignable(result: IGuardResult | null): void {
  if (result === null) {
    throw new CompactError('UNKNOWN_OPERATE', 'operate is not a recognized accountable venue action', 'hard')
  }
  if (result.ok) return
  const first = result.reasons[0] as IGuardReason
  throw new CompactError(first.code, result.reasons.map(r => r.detail).join('; '), 'hard')
}
