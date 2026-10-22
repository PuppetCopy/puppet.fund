import { ACCOUNT_CALL_MAP, decodeAccountCall } from '@puppet/sdk/account'
import { type ChainId, PRECISION, TOKEN_META } from '@puppet/sdk/const'
import { formatFixed } from '@puppet/sdk/core'
import { type IFundValuation, isAllocationRecord, isRedeemHolderRecord, isSellRecord } from '@puppet/sdk/fold'
import { creditableOf } from '@puppet/sdk/intent'
import { HUB_CHAIN_ID, PRICE_PRECISION } from '@puppet/contracts/const'
import { cashFor, claimOf, profitFeeOf } from '@puppet/sdk/pool'
import { fundMetricTable, fundTable, type IFundMetricRow, type IFundRow, type IMandateRow, redemptionTable } from '@puppet/sdk/schema'
import { pnlEventsAcross } from '@puppet/sdk/state'
import { type Address, getAddress, isAddressEqual, slice } from 'viem'
import type { IJournalEntries, IOwnState } from '@puppet/sdk/client'
import type { IDigestClient } from '@puppet/sdk/datastore'

export type IHoldingStanding =
  | { kind: 'behind' }
  | { kind: 'current'; fundRow: IFundRow; metrics: IFundMetricRow[]; value: bigint; queued: bigint; queuedValue: bigint; payout: { token: Address; amount: bigint } | null }

export interface IHoldingView {
  master: Address
  shares: bigint
  standing: IHoldingStanding
}

export function mandatesInForce(own: IOwnState): IMandateRow[] {
  const hub = own.accounts.find(row => Number(row.chainId) === HUB_CHAIN_ID && isAddressEqual(row.account, own.account))
  if (hub === undefined) {
    if (own.mandates.length > 0) throw new Error(`the journal holds mandates from ${own.account} but no record of its hub account`)
    return []
  }
  return own.mandates.filter(row => isAddressEqual(row.puppet, own.account) && row.epoch === hub.epoch)
}

export function escrowSurplus(own: IOwnState, journal: IJournalEntries): { chainId: ChainId; token: Address; amount: bigint; returnAt: bigint }[] {
  const { requestReturn, depositEscrow, retireEscrow, returnEscrow } = ACCOUNT_CALL_MAP.LiquidityGate
  const escrowCalls = new Set<string>([requestReturn.selector, depositEscrow.selector, retireEscrow.selector, returnEscrow.selector])
  const pendingReturns = new Map<string, bigint>()
  for (const [chainId, list] of journal.entries) {
    const ordered = list
      .filter(entry => escrowCalls.has(slice(entry.executionData, 0, 4)))
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
    for (const entry of ordered) {
      const d = decodeAccountCall(entry)
      if (d.selector === requestReturn.selector) pendingReturns.set(`${chainId}:${getAddress(d.token)}`, d.returnAt)
      else if (d.selector === depositEscrow.selector || d.selector === retireEscrow.selector || d.selector === returnEscrow.selector) {
        pendingReturns.delete(`${chainId}:${getAddress(d.token)}`)
      }
    }
  }
  return own.escrows.flatMap(row => {
    if (!isAddressEqual(row.owner, own.account)) return []
    const credited = own.ownerCredits
      .filter(c => isAddressEqual(c.owner, own.account) && c.chainId === row.chainId && isAddressEqual(c.token, row.token))
      .reduce((total, c) => total + c.credited, 0n)
    const amount = creditableOf({ escrowed: row.escrowed, released: row.released, returned: row.returned, ownerCredited: credited })
    return amount > 0n ? [{ chainId: Number(row.chainId) as ChainId, token: row.token, amount, returnAt: pendingReturns.get(`${row.chainId}:${getAddress(row.token)}`) ?? 0n }] : []
  })
}

export async function ownHoldingViews(reader: IDigestClient, own: Pick<IOwnState, 'holdings' | 'fundRows' | 'redemptions'>, holder: Address): Promise<IHoldingView[]> {
  const self = getAddress(holder)
  const held = own.holdings.filter(h => isAddressEqual(h.holder, self))
  const others = [...new Set(held.map(h => getAddress(h.master)))].filter(master => !isAddressEqual(master, self))
  const [shared, redeeming, metrics] = await Promise.all([
    others.length === 0 ? [] : reader.select(fundTable, { where: { master: { in: others } } }),
    others.length === 0 ? [] : reader.select(redemptionTable, { where: { master: { in: others } } }),
    others.length === 0 ? [] : reader.select(fundMetricTable, { where: { master: { in: others } } })
  ])
  const fundRows = [...own.fundRows, ...shared]
  const redemptions = [...own.redemptions, ...redeeming]
  return held.map((holding): IHoldingView => {
    const master = getAddress(holding.master)
    const fundRow = fundRows.find(p => isAddressEqual(p.master, master))
    const redemption = isAddressEqual(master, self) ? undefined : redemptions.find(r => isAddressEqual(r.master, master))
    const settling = redemption !== undefined && redemption.owedLeft > 0n && holding.redeemedAt !== redemption.id ? redemption : null
    const free = holding.shares - holding.queued
    const shares = settling === null ? free : free - (free * BigInt(settling.fraction)) / PRECISION.basisPoints
    const queued = settling === null ? holding.queued : 0n
    const claim = settling === null ? 0n : claimOf(holding, holding.shares, settling.fraction)
    if (fundRow === undefined || shares + queued > fundRow.totalShares) return { master, shares, standing: { kind: 'behind' } }
    const fundMetrics = metrics.filter(row => isAddressEqual(row.master, master))
    const [basis] = [...fundMetrics].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp)
    const nav = basis === undefined ? fundRow.value : basis.valuation
    const selfHeld = isAddressEqual(master, self)
    const price = cashFor(PRICE_PRECISION, fundRow.totalShares, nav)
    const exitValue = (amount: bigint): bigint => {
      const gross = cashFor(amount, fundRow.totalShares, nav)
      return selfHeld ? gross : gross - profitFeeOf(gross, holding.cost, price, fundRow.performanceFee)
    }
    const payout = settling === null || claim === 0n ? 0n : (settling.potLeft * claim) / settling.owedLeft
    const net = settling === null ? 0n : payout - profitFeeOf(payout, holding.cost, settling.price, fundRow.performanceFee)
    return {
      master,
      shares,
      standing: {
        kind: 'current',
        fundRow,
        metrics: fundMetrics,
        value: exitValue(shares),
        queued,
        queuedValue: exitValue(queued),
        payout: settling === null ? null : { token: getAddress(settling.token), amount: net - (net < settling.fee ? net : settling.fee) }
      }
    }
  })
}

export interface IMandateWorth {
  points: { time: number; worth: bigint; allocated: bigint; paid: bigint }[]
  allocated: bigint
  invested: bigint
  held: bigint
  exit: { shares: bigint; value: bigint; fee: bigint; since: number } | null
  paid: bigint
  worth: bigint
}

export function mandatePerformanceOf(perfs: readonly IMandateWorth[]) {
  const times = [...new Set(perfs.flatMap(perf => perf.points.map(point => point.time)))].sort((a, b) => a - b)
  const pnl = perfs.reduce((total, perf) => total + perf.worth - perf.allocated, 0n)
  const invested = perfs.reduce((total, perf) => total + perf.invested, 0n)
  const last = times[times.length - 1]
  return {
    pnl,
    roi: invested === 0n ? null : (Number(pnl) / Number(invested)) * 100,
    pnlPoints: times.map(time => ({
      time,
      value: formatFixed(
        TOKEN_META.WETH.decimals,
        perfs.reduce((total, perf) => {
          const point = perf.points.findLast(each => each.time <= time)
          return point === undefined ? total : total + point.worth - point.allocated
        }, 0n)
      )
    })),
    tip: last === undefined ? null : { time: last, value: formatFixed(TOKEN_META.WETH.decimals, pnl) }
  }
}

type IMandateStep = { block: number; logIndex: number; time: number } & (
  | { mark: IFundValuation }
  | { mark: null; bought: bigint; allocated: bigint; sold: bigint; burned: bigint; paid: bigint; queued: bigint; cost: bigint | null }
)

export function mandateWorth(
  own: IJournalEntries,
  valuations: readonly IFundValuation[],
  fundRow: IFundRow,
  metric: { rows: readonly IFundMetricRow[]; interval: number },
  nowSec: number
): IMandateWorth | null {
  const master = getAddress(fundRow.master)
  const records = [...own.entries.values()].flatMap(list =>
    list.flatMap((call): IMandateStep[] => {
      const d = decodeAccountCall(call)
      const at = { block: Number(call.blockNumber), logIndex: call.logIndex, time: call.blockTimestamp }
      if (isAllocationRecord(d) && isAddressEqual(d.master, master)) {
        return [{ ...at, mark: null, bought: d.shares, allocated: d.value, sold: 0n, burned: 0n, paid: 0n, queued: d.holding.queued, cost: d.holding.cost }]
      }
      if (isSellRecord(d) && isAddressEqual(d.master, master)) {
        return [{ ...at, mark: null, bought: 0n, allocated: 0n, sold: d.shares, burned: d.queued + d.burned, paid: d.payout - d.profitFee, queued: d.holding.queued, cost: d.holding.cost }]
      }
      if (isRedeemHolderRecord(d) && isAddressEqual(d.master, master)) {
        if (d.queued + d.burned === 0n) return []
        const net = d.payout - d.profitFee
        const fee = net < d.redemption.fee ? net : d.redemption.fee
        return [{ ...at, mark: null, bought: 0n, allocated: 0n, sold: 0n, burned: d.queued + d.burned, paid: net - fee, queued: 0n, cost: null }]
      }
      return []
    })
  )
  const marks = valuations.filter(row => isAddressEqual(row.master, master))
  const steps = [...records, ...marks.map((row): IMandateStep => ({ block: row.block, logIndex: row.logIndex, time: row.blockTimestamp, mark: row }))].sort(
    (a, b) => a.block - b.block || a.logIndex - b.logIndex
  )
  let balance = 0n
  let queued = 0n
  let cost = 0n
  let since: number | null = null
  let paid = 0n
  let allocated = 0n
  let invested = 0n
  let joined = false
  let mark: IFundValuation | null = null
  const snapshots: { time: number; balance: bigint; paid: bigint; allocated: bigint; mark: IFundValuation }[] = []
  for (const step of steps) {
    if (step.mark !== null) {
      mark = step.mark
    } else {
      joined = true
      balance += step.bought - step.burned
      queued = step.queued
      if (step.cost !== null) cost = step.cost
      allocated += step.allocated
      paid += step.paid
      if (step.sold > 0n) since = step.time
      if (allocated - paid > invested) invested = allocated - paid
    }
    if (!joined || mark === null) continue
    const snapshot = { time: step.time, balance, paid, allocated, mark }
    const last = snapshots[snapshots.length - 1]
    if (last !== undefined && last.time === step.time) snapshots[snapshots.length - 1] = snapshot
    else snapshots.push(snapshot)
  }
  if (!joined || mark === null) return null
  if (queued > 0n && since === null) throw new Error(`${master} holds ${queued} queued shares without a sell record`)
  const [basis] = [...metric.rows].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp)
  const anchor = basis !== undefined && basis.lastUpdatedTimestamp >= mark.blockTimestamp ? basis : null
  const start = nowSec - metric.interval
  const events = anchor === null ? [] : [...marks.map(row => ({ time: row.blockTimestamp, delta: row.after - row.value })), ...pnlEventsAcross(metric.rows, metric.interval)]
  const times = [...new Set([...snapshots.map(each => each.time), ...events.flatMap(event => (event.time >= start && event.time < nowSec ? [event.time] : []))])].sort((a, b) => a - b)
  const points = times.flatMap(time => {
    const at = snapshots.findLast(each => each.time <= time)
    if (at === undefined) return []
    const value = anchor === null || time < start ? at.mark.after : events.reduce((rest, event) => (event.time > time ? rest - event.delta : rest), anchor.valuation)
    return [{ time, worth: (at.mark.sharesAfter === 0n ? 0n : cashFor(at.balance, at.mark.sharesAfter, value)) + at.paid, allocated: at.allocated, paid: at.paid }]
  })
  const nav = basis === undefined ? fundRow.value : basis.valuation
  const price = cashFor(PRICE_PRECISION, fundRow.totalShares, nav)
  const net = (amount: bigint): bigint => {
    const gross = cashFor(amount, fundRow.totalShares, nav)
    return gross - profitFeeOf(gross, cost, price, fundRow.performanceFee)
  }
  const queuedValue = cashFor(queued, fundRow.totalShares, nav)
  const held = net(balance - queued)
  const worth = held + net(queued) + paid
  const last = points[points.length - 1]
  if (last !== undefined && last.time >= nowSec) {
    last.worth = worth
    last.allocated = allocated
    last.paid = paid
  } else points.push({ time: nowSec, worth, allocated, paid })
  const exit = queued === 0n || since === null ? null : { shares: queued, value: queuedValue, fee: queuedValue - net(queued), since }
  return { points, allocated, invested, held, exit, paid, worth }
}
