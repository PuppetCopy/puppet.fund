import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, type PublicClient } from 'viem'
import { CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { decodeErc20, isRegisteredToken } from './erc20.js'
import type { IGuardReason, IGuardResult, IScreenContext, IVenueFacts } from './types.js'
import { VENUES } from './venues.js'

export const NO_VENUE_FACTS: IVenueFacts = { markets: new Map(), tokens: new Map(), owners: new Map() }

export async function resolveOperate(
  client: PublicClient,
  chainId: ChainId,
  callList: readonly IIAccount__Call[],
  blockNumber: bigint | undefined
): Promise<IVenueFacts> {
  const resolved = await Promise.all(
    VENUES.flatMap(venue => (venue.resolve === undefined || !venue.chains.includes(chainId) ? [] : [venue.resolve(client, callList, blockNumber)]))
  )
  return {
    markets: new Map(resolved.flatMap(facts => [...facts.markets])),
    tokens: new Map(resolved.flatMap(facts => [...facts.tokens])),
    owners: new Map(resolved.flatMap(facts => [...facts.owners]))
  }
}

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

export function operateOutflows(account: Address, callList: readonly IIAccount__Call[]): { token: Address; amount: bigint }[] {
  const out: { token: Address; amount: bigint }[] = []
  for (const call of callList) {
    for (const venue of VENUES) out.push(...venue.outflows(account, call))
  }
  return out
}

export function operateExchange(chainId: ChainId, account: Address, callList: readonly IIAccount__Call[]): { spent: Map<Address, bigint>; received: Map<Address, bigint> } {
  const spent = new Map<Address, bigint>()
  const received = new Map<Address, bigint>()
  for (const call of callList) {
    for (const venue of VENUES) {
      const exchange = venue.exchange(chainId, account, call)
      for (const flow of exchange.spent) spent.set(getAddress(flow.token), (spent.get(getAddress(flow.token)) ?? 0n) + flow.amount)
      for (const flow of exchange.received) received.set(getAddress(flow.token), (received.get(getAddress(flow.token)) ?? 0n) + flow.amount)
    }
  }
  return { spent, received }
}

export function assertOperateSignable(result: IGuardResult | null): void {
  if (result === null) {
    throw new CompactError('UNKNOWN_OPERATE', 'operate is not a recognized accountable venue action', 'hard')
  }
  if (result.ok) return
  const first = result.reasons[0] as IGuardReason
  throw new CompactError(first.code, result.reasons.map(r => r.detail).join('; '), 'hard')
}
