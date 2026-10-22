import type { IStoredAccountCall } from '@puppet/sdk/account'
import { type IViewRead, tokenUnitOf } from '@puppet/sdk/client'
import { encode, type IValuationOwner, valuationRequestDigest } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { readTokenProfiles } from '@puppet/sdk/core'
import { ACCOUNT_VENUE, type IAllowanceRow, type IPositionRow, positionSyncTable, positionTable, venueTable } from '@puppet/sdk/schema'
import { tokenMetaByChainToken, tokenMetaKey } from '@puppet/sdk/state'
import type { IDigestClient } from '@puppet/sdk/datastore'
import { VENUES } from '@puppet/sdk/venue'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { ENDPOINTS } from '../app/endpoints.js'
import { client } from './datastore/reads.js'

export const OWNER_SYNC_MS = 60_000
export const OWNER_SYNC_CHECK_MS = 15_000

export interface ISyncFailure {
  venue: string
  reason: string
}

export type ISyncWithdrawable = { venue: string; total: string; free: string; at: number } | { venue: string; reason: string }

export async function openPositionsOf(
  reader: IDigestClient,
  account: Address,
  failed: readonly ISyncFailure[],
  withdrawable: readonly ISyncWithdrawable[] | null,
  after: number | null
) {
  const [ledger, rows, syncs] = await Promise.all([
    reader.select(venueTable, { where: { account } }),
    reader.select(positionTable, { where: { account } }),
    reader.select(positionSyncTable, { where: { account } })
  ])
  const round = syncs.find(row => row.venue === ACCOUNT_VENUE)
  const holdings = rows.filter(row => row.venue === ACCOUNT_VENUE && (row.kind === 'cash' || row.kind === 'spot'))
  const unlisted = holdings.filter(
    (row): row is IPositionRow & { chainId: NonNullable<IPositionRow['chainId']>; contract: NonNullable<IPositionRow['contract']> } =>
      row.chainId !== undefined && row.contract !== undefined && !tokenMetaByChainToken.has(tokenMetaKey(Number(row.chainId) as ChainId, row.contract))
  )
  return {
    failed,
    holdings: { syncedAt: round === undefined ? null : round.time, rows: holdings },
    selfCustody: unlisted,
    venues: VENUES.flatMap(venue => {
      const own = ledger.filter(row => row.venue === venue.venueId)
      const read = syncs.find(row => row.venue === venue.venueId)
      const positions = rows.filter(row => row.venue === venue.venueId)
      if (own.length === 0 && read === undefined && positions.length === 0) return []
      const values = positions.map(row => row.value)
      const fresh = withdrawable?.find(entry => entry.venue === venue.venueId)
      return [
        {
          venue,
          syncedAt: read === undefined ? null : read.time,
          waiting: after !== null && (read === undefined || read.time < after),
          withdrawable: fresh === undefined ? null : 'free' in fresh ? { total: BigInt(fresh.total), free: BigInt(fresh.free), at: fresh.at } : { reason: fresh.reason },
          positions,
          value: read !== undefined && values.every((value): value is bigint => value !== undefined) ? values.reduce((sum, value) => sum + value, 0n) : null
        }
      ]
    })
  }
}
export type IOpenPositions = Awaited<ReturnType<typeof openPositionsOf>>

export function fundBalancesOf(
  calls: ReadonlyMap<ChainId, readonly Pick<IStoredAccountCall, 'blockTimestamp' | 'balanceList'>[]>,
  recorded: readonly { chainId: ChainId; token: Address; amount: bigint }[],
  synced: IOpenPositions['holdings']
): { chainId: ChainId; token: Address; amount: bigint }[] {
  const syncedAt = synced.syncedAt
  const syncedRows = synced.rows.flatMap(row =>
    row.chainId === undefined || row.contract === undefined ? [] : [{ chainId: Number(row.chainId) as ChainId, token: getAddress(row.contract), amount: row.size }]
  )
  const covered = new Set(syncedRows.map(row => row.chainId))
  const keys = new Map([...recorded, ...syncedRows].map(row => [`${row.chainId}:${getAddress(row.token)}`, { chainId: row.chainId, token: getAddress(row.token) }] as const))
  return [...keys.values()].flatMap(({ chainId, token }) => {
    const chainCalls = calls.get(chainId)
    const record = chainCalls === undefined ? undefined : chainCalls.findLast(call => call.balanceList.some(b => isAddressEqual(b.token, token)))
    const fresher = syncedAt !== null && covered.has(chainId) && (record === undefined || record.blockTimestamp < syncedAt)
    const row = (fresher ? syncedRows : recorded).find(r => r.chainId === chainId && isAddressEqual(r.token, token))
    return row === undefined || row.amount === 0n ? [] : [{ chainId, token, amount: row.amount }]
  })
}

export async function standingAllowancesOf(view: IViewRead, rows: readonly IAllowanceRow[]) {
  return Promise.all(
    rows
      .filter(row => row.implied > 0n)
      .map(async row => {
        const chainId = Number(row.chainId) as ChainId
        const token = getAddress(row.token)
        const profiles = await readTokenProfiles(view, chainId, tokenMetaByChainToken.has(tokenMetaKey(chainId, token)) ? [] : [token])
        return { chainId, venueId: row.venue, token, spender: getAddress(row.spender), implied: row.implied, profile: tokenUnitOf(chainId, token, profiles) }
      })
  )
}
export type IStandingAllowance = Awaited<ReturnType<typeof standingAllowancesOf>>[number]

export async function fundLiveOf(account: Address, owner: IValuationOwner, after: number | null) {
  const issuedAt = BigInt(Math.floor(Date.now() / 1000))
  const approver = await owner.approve(valuationRequestDigest(account, issuedAt))
  const bound = after === null ? null : BigInt(after) < issuedAt ? BigInt(after) : issuedAt
  const res = await fetch(`${ENDPOINTS.chronicle}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: encode(bound === null ? { account, user: owner.user, issuedAt, approver } : { account, user: owner.user, issuedAt, approver, after: bound })
  })
  if (!res.ok) throw new Error(`the chronicle could not read the fund ${account}: ${res.status} ${await res.text()}`)
  const synced: { failed: ISyncFailure[]; withdrawable: ISyncWithdrawable[]; worth: { value?: string; valueTime?: number; valueNote?: string } } = await res.json()
  const { value, valueTime, valueNote } = synced.worth
  const worth = value !== undefined && valueTime !== undefined ? { value: BigInt(value), time: valueTime } : valueNote !== undefined ? { note: valueNote } : null
  if (worth === null) throw new Error(`the chronicle answered the live value of ${account} with neither a figure nor a note`)
  return { worth, open: await openPositionsOf(client, account, synced.failed, synced.withdrawable, after) }
}
export type IFundLive = Awaited<ReturnType<typeof fundLiveOf>>
