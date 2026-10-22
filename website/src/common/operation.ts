import { type ITokenProfiles, tokenUnitOf } from '@puppet/sdk/client'
import type { ChainId } from '@puppet/sdk/const'
import { getAccountExplorerUrl, getTokenDescription, readableAddress, readableTokenAmountLabel } from '@puppet/sdk/core'
import { contractLabelOf } from '@puppet/sdk/state'
import { type IOperateStep, SAMPLEABLE_ALLOWANCE, VENUES } from '@puppet/sdk/venue'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { chainFor } from './$contract.js'

export interface IStepField {
  label: string
  value: string
  href?: string
}

export interface IVenueAction {
  venueId: string
  venue: string
  spender: Address | null
  label: string
  call: string
  fields: IStepField[]
  orderKey: Hex | null
}

export interface IOperationSummary {
  actions: IVenueAction[]
}

const NATIVE: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const venueName = (venueId: string): string => VENUES.find(v => v.venueId === venueId)?.name ?? venueId

const labelled = (chainId: ChainId, address: Address): string => `${contractLabelOf(chainId, address).name} ${readableAddress(address)}`

export function operationSummary(chainId: ChainId, steps: readonly IOperateStep[], profiles: ITokenProfiles): IOperationSummary {
  const actions: IVenueAction[] = []
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
          spender: null,
          label: s.label,
          call: s.call,
          fields: [
            ...s.fields,
            ...s.fees.map(fee => ({
              label: fee.payee === 'venue' ? `${venueName(s.venueId)} fee` : 'Route fee',
              value: `${fee.expected === null ? '' : `about ${readableTokenAmountLabel(tokenUnitOf(chainId, fee.token, profiles), fee.expected)}, `}up to ${readableTokenAmountLabel(tokenUnitOf(chainId, fee.token, profiles), fee.amount)}`
            }))
          ],
          orderKey: s.key
        })
        break
      case 'release':
        actions.push({
          venueId: '',
          venue: readableAddress(s.to),
          spender: null,
          label: 'Release',
          call: s.token === null ? 'send' : 'transfer',
          fields: [
            { label: 'to', value: labelled(chainId, s.to), href: getAccountExplorerUrl(s.to, chainFor(chainId)) },
            { label: 'amount', value: readableTokenAmountLabel(tokenUnitOf(chainId, s.token ?? NATIVE, profiles), s.amount) }
          ],
          orderKey: null
        })
        break
      case 'approve': {
        if (paired.has(i)) break
        const desc = tokenUnitOf(chainId, s.token, profiles)
        const amount = s.amount >= SAMPLEABLE_ALLOWANCE ? `unlimited ${desc.symbol}` : readableTokenAmountLabel(desc, s.amount)
        actions.push({
          venueId: '',
          venue: VENUES.find(v => v.contracts.some(c => isAddressEqual(c.address, s.spender)))?.name ?? readableAddress(s.spender),
          spender: getAddress(s.spender),
          label: s.amount === 0n ? `Revoke ${desc.symbol} approval` : `Approve ${amount}`,
          call: 'approve',
          fields: [
            { label: 'token', value: `${desc.symbol} ${readableAddress(s.token)}` },
            { label: 'spender', value: labelled(chainId, s.spender), href: getAccountExplorerUrl(s.spender, chainFor(chainId)) },
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
          spender: null,
          label: 'Call',
          call: s.selector,
          fields: [
            { label: 'contract', value: labelled(chainId, s.target), href: getAccountExplorerUrl(s.target, chainFor(chainId)) },
            { label: 'selector', value: s.selector },
            ...(s.value === 0n ? [] : [{ label: 'value', value: readableTokenAmountLabel(getTokenDescription(chainId, NATIVE), s.value) }])
          ],
          orderKey: null
        })
        break
    }
  }
  return { actions }
}
