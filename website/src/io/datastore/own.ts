import { PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { cashFor, settlePosition } from '@puppet/sdk/pool'
import { closedAccruedTable, fundTable, type IClosedAccruedRow, type IFundRow, type IQueueRow, queueTable } from '@puppet/sdk/schema'
import { type Address, getAddress, isAddressEqual } from 'viem'
import type { IOwnState } from '../journal/localFold.js'
import { client } from './reads.js'

export type IHoldingStanding =
  | { kind: 'behind' }
  | { kind: 'current'; fundRow: IFundRow; value: bigint; queued: bigint; queuedValue: bigint; payout: bigint; payoutFee: bigint }

export interface IHoldingView {
  master: Address
  units: bigint
  basis: bigint
  standing: IHoldingStanding
}

export function escrowSurplus(own: IOwnState, master: Address): { chainId: ChainId; token: Address; amount: bigint }[] {
  return own.escrows.flatMap(row => {
    if (!isAddressEqual(row.parent, own.account) || !isAddressEqual(row.master, master)) return []
    const credit = own.credits.find(c => isAddressEqual(c.master, row.master) && c.creditChainId === row.chainId && isAddressEqual(c.token, row.token))
    const taken = credit !== undefined && credit.credited > row.fulfilled ? credit.credited : row.fulfilled
    return row.escrowed > taken ? [{ chainId: Number(row.chainId) as ChainId, token: row.token, amount: row.escrowed - taken }] : []
  })
}

export async function ownHoldingViews(own: IOwnState, holder: Address): Promise<IHoldingView[]> {
  const self = getAddress(holder)
  const masters = [...new Set([...own.holdings, ...own.positions].filter(r => isAddressEqual(r.holder, self)).map(r => getAddress(r.master)))]
  const others = masters.filter(master => !isAddressEqual(master, self))
  const shared: [IFundRow[], IQueueRow[], IClosedAccruedRow[]] =
    others.length === 0
      ? [[], [], []]
      : await Promise.all([
          client.select(fundTable, { where: { master: { in: others } } }),
          client.select(queueTable, { where: { master: { in: others } } }),
          client.select(closedAccruedTable, { where: { master: { in: others } } })
        ])
  const fundRows = [...own.fundRows, ...shared[0]]
  const queues = [...own.queues, ...shared[1]]
  const closed = [...own.closedAccrued, ...shared[2]]
  return masters.map((master): IHoldingView => {
    const holding = own.holdings.find(h => isAddressEqual(h.master, master) && isAddressEqual(h.holder, self))
    const position = own.positions.find(p => isAddressEqual(p.master, master) && isAddressEqual(p.holder, self))
    const fundRow = fundRows.find(p => isAddressEqual(p.master, master))
    const queue = queues.find(q => isAddressEqual(q.master, master))
    const units = holding === undefined ? 0n : holding.units
    const basis = holding === undefined ? 0n : holding.basis
    const behind = { master, units, basis, standing: { kind: 'behind' } } as const
    if (fundRow === undefined || units > fundRow.totalUnits) return behind
    if (position === undefined) {
      const queued = isAddressEqual(master, self) && queue !== undefined && queue.weight > 0n ? (queue.masterWeight * queue.units) / queue.weight : 0n
      return {
        master,
        units,
        basis,
        standing: {
          kind: 'current',
          fundRow,
          value: cashFor(units, fundRow.totalUnits, fundRow.value),
          queued,
          queuedValue: cashFor(queued, fundRow.totalUnits, fundRow.value),
          payout: 0n,
          payoutFee: 0n
        }
      }
    }
    if (queue === undefined || position.epoch > queue.epoch || (position.epoch === queue.epoch && position.cursor > queue.accrued)) return behind
    const closedAccrued = position.epoch < queue.epoch ? closed.find(c => isAddressEqual(c.master, master) && c.epoch === position.epoch) : undefined
    if (position.epoch < queue.epoch && closedAccrued === undefined) return behind
    const settled = settlePosition(queue, position, queue.units, closedAccrued?.accrued, fundRow === undefined ? PROTOCOL.performanceFee : fundRow.performanceFee)
    return {
      master,
      units,
      basis,
      standing: {
        kind: 'current',
        fundRow,
        value: cashFor(units, fundRow.totalUnits, fundRow.value),
        queued: settled.position.units,
        queuedValue: cashFor(settled.position.units, fundRow.totalUnits, fundRow.value),
        payout: settled.payout,
        payoutFee: settled.fee
      }
    }
  })
}
