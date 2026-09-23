import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableAddress, readableTokenAmountLabel } from '@puppet/sdk/core'
import { contractLabelOf } from '@puppet/sdk/state'
import { type IOperateStep, VENUES } from '@puppet/sdk/venue'
import { type Address, type Hex, isAddressEqual } from 'viem'

export interface ITokenFlow {
  token: { symbol: string; decimals: number }
  delta: bigint
}

export interface IStepField {
  label: string
  value: string
}

export interface IVenueAction {
  venueId: string
  venue: string
  label: string
  call: string
  fields: IStepField[]
  orderKey: Hex | null
}

export interface IOperationSummary {
  actions: IVenueAction[]
  flows: ITokenFlow[]
}

export const readableFlow = (f: ITokenFlow): string => `${f.delta > 0n ? '+' : ''}${readableTokenAmountLabel(f.token, f.delta)}`

const UNBOUNDED_ALLOWANCE = 2n ** 128n - 1n

const NATIVE: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const venueName = (venueId: string): string => VENUES.find(v => v.venueId === venueId)?.name ?? venueId

const labelled = (chainId: ChainId, address: Address): string => `${contractLabelOf(chainId, address).name} ${readableAddress(address)}`

export function operationSummary(chainId: ChainId, steps: readonly IOperateStep[]): IOperationSummary {
  const actions: IVenueAction[] = []
  const flows: ITokenFlow[] = []
  const paired = new Set<number>()
  steps.forEach((step, i) => {
    if (step.kind !== 'approve' || step.amount === 0n || paired.has(i)) return
    const reset = steps.findIndex(
      (later, j) =>
        j > i &&
        later.kind === 'approve' &&
        later.amount === 0n &&
        !paired.has(j) &&
        isAddressEqual(later.token, step.token) &&
        isAddressEqual(later.spender, step.spender)
    )
    if (reset === -1) return
    paired.add(i)
    paired.add(reset)
  })
  for (const [i, s] of steps.entries()) {
    switch (s.kind) {
      case 'venue':
        actions.push({
          venueId: s.venueId,
          venue: venueName(s.venueId),
          label: s.label,
          call: s.call,
          fields: [...s.fields],
          orderKey: s.key
        })
        for (const flow of s.flows) flows.push({ token: getTokenDescription(chainId, flow.token), delta: flow.delta })
        break
      case 'release':
        actions.push({
          venueId: '',
          venue: readableAddress(s.to),
          label: 'Release',
          call: s.token === null ? 'send' : 'transfer',
          fields: [
            { label: 'to', value: labelled(chainId, s.to) },
            { label: 'amount', value: readableTokenAmountLabel(getTokenDescription(chainId, s.token ?? NATIVE), s.amount) }
          ],
          orderKey: null
        })
        flows.push({ token: getTokenDescription(chainId, s.token ?? NATIVE), delta: -s.amount })
        break
      case 'approve': {
        if (paired.has(i)) break
        const desc = getTokenDescription(chainId, s.token)
        const amount = s.amount > UNBOUNDED_ALLOWANCE ? `unlimited ${desc.symbol}` : readableTokenAmountLabel(desc, s.amount)
        actions.push({
          venueId: '',
          venue: VENUES.find(v => v.contracts.some(c => c.pullsTokens === true && isAddressEqual(c.address, s.spender)))?.name ?? readableAddress(s.spender),
          label: s.amount === 0n ? `Revoke ${desc.symbol} approval` : `Approve ${amount}`,
          call: 'approve',
          fields: [
            { label: 'token', value: `${desc.symbol} ${readableAddress(s.token)}` },
            { label: 'spender', value: labelled(chainId, s.spender) },
            { label: 'amount', value: s.amount === 0n ? 'none, the approval is cleared' : amount }
          ],
          orderKey: null
        })
        break
      }
      case 'fee':
        break
      case 'call':
        actions.push({
          venueId: '',
          venue: readableAddress(s.target),
          label: 'Call',
          call: s.selector,
          fields: [
            { label: 'contract', value: labelled(chainId, s.target) },
            { label: 'selector', value: s.selector },
            ...(s.value === 0n ? [] : [{ label: 'value', value: readableTokenAmountLabel(getTokenDescription(chainId, NATIVE), s.value) }])
          ],
          orderKey: null
        })
        break
    }
  }
  return { actions, flows }
}
