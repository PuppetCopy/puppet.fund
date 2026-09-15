import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, isAddress, isAddressEqual } from 'viem'
import { decodeErc20, isRegisteredToken } from '../erc20.js'
import type { IGuardReason, IOperateStep, IScreenContext, IVenue } from '../types.js'
import {
  HYPERLIQUID_ACTION_DOMAIN,
  HYPERLIQUID_ADMITTED_ACTIONS,
  HYPERLIQUID_BRIDGE,
  HYPERLIQUID_CHAIN_ID,
  HYPERLIQUID_DEPOSIT_MIN,
  HYPERLIQUID_DEPOSIT_TOKEN,
  HYPERLIQUID_USER_DOMAIN,
  HYPERLIQUID_WITHDRAW
} from './contracts.js'

function bridgeDeposit(call: IIAccount__Call): { amount: bigint } | null {
  const dec = decodeErc20(call.callData)
  if (dec?.functionName !== 'transfer') return null
  const [to, amount] = dec.args as readonly [Address, bigint]
  return isAddressEqual(to, HYPERLIQUID_BRIDGE) ? { amount } : null
}

export const hyperliquidVenue: IVenue = {
  venueId: 'hyperliquid',
  claims(ctx: IScreenContext, call) {
    return ctx.chainId === HYPERLIQUID_CHAIN_ID && isRegisteredToken(ctx, call.target) && bridgeDeposit(call) !== null
  },
  screen(_ctx, call) {
    const reasons: IGuardReason[] = []
    const deposit = bridgeDeposit(call)
    if (deposit === null) return reasons
    if (!isAddressEqual(call.target, HYPERLIQUID_DEPOSIT_TOKEN)) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `the Hyperliquid bridge takes ${HYPERLIQUID_DEPOSIT_TOKEN} only, not ${call.target}` })
    } else if (deposit.amount < HYPERLIQUID_DEPOSIT_MIN) {
      reasons.push({ code: 'VENUE_DEPOSIT_BELOW_MIN', detail: `Hyperliquid forfeits bridge deposits below ${HYPERLIQUID_DEPOSIT_MIN}; ${deposit.amount} would be lost` })
    }
    if (call.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `transfer call to ${call.target} forwards native value ${call.value}` })
    }
    return reasons
  },
  outflows(call) {
    const deposit = bridgeDeposit(call)
    return deposit === null ? [] : [{ token: getAddress(call.target), amount: deposit.amount }]
  },
  describe(chainId, callList) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== HYPERLIQUID_CHAIN_ID) return out
    callList.forEach((call, i) => {
      const deposit = bridgeDeposit(call)
      if (deposit === null) return
      out.set(i, [{ kind: 'venue-deposit', venue: 'hyperliquid', token: getAddress(call.target), amount: deposit.amount }])
    })
    return out
  },
  typedData(account, typedData) {
    const name = typedData.domain?.name
    if (name === HYPERLIQUID_ACTION_DOMAIN && typedData.primaryType === 'Agent') return []
    if (name !== HYPERLIQUID_USER_DOMAIN) return null
    if (typedData.primaryType === HYPERLIQUID_WITHDRAW) {
      const destination = typedData.message.destination
      if (typeof destination !== 'string' || !isAddress(destination) || !isAddressEqual(destination, account)) {
        return [{ code: 'DAPP_EXIT_DESTINATION', detail: `a Hyperliquid withdrawal may only return to the account itself (${account}), not to ${String(destination)}` }]
      }
      return []
    }
    if (HYPERLIQUID_ADMITTED_ACTIONS.has(typedData.primaryType)) return []
    return [
      {
        code: 'DAPP_ACTION_NOT_ADMITTED',
        detail: `${typedData.primaryType} (${Object.keys(typedData.message).join(', ')}) is not an admitted Hyperliquid action; anything unlisted may move value or control out of the gated account`
      }
    ]
  }
}
