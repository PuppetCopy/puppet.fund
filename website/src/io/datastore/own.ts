import { owedFor } from '@puppet/sdk/backing'
import { bookIdOf } from '@puppet/sdk/fold'
import type { IBackingRow, IBookRow, IMarkRow } from '@puppet/sdk/schema'
import { getAddress, isAddressEqual } from 'viem'
import type { IOwnState } from '../journal/localFold.js'
import { fetchBackings, fetchBook, fetchMark, fetchMarksById } from './reads.js'
import type { ITradeView } from './trading.js'

export async function ownMarks(own: IOwnState, ids: readonly string[]): Promise<IMarkRow[]> {
  const local = new Map(own.marks.filter(m => ids.includes(m.id)).map(m => [m.id, m]))
  const unsealed = ids.filter(id => {
    const row = local.get(id)
    return row === undefined || row.pending
  })
  for (const row of await fetchMarksById(unsealed)) local.set(row.id, row)
  return [...local.values()]
}

const markOf = async (own: IOwnState, id: string): Promise<IMarkRow | undefined> => {
  if (id === '') return undefined
  const local = own.marks.find(m => m.id === id)
  if (local !== undefined && !local.pending) return local
  const valued = await fetchMark(id)
  return valued === undefined ? local : valued
}

export async function ownTradeViews(own: IOwnState): Promise<ITradeView[]> {
  return Promise.all(
    own.books.map(async book => {
      const mark = await markOf(own, book.lastMark)
      const settledCycle = own.settlements
        .filter(s => s.spokeChainId === book.chainId && isAddressEqual(s.master, book.master) && s.kind === 'settle')
        .reduce((max, s) => (s.cycle > max ? s.cycle : max), 0n)
      return {
        book,
        backers: own.backers.filter(b => b.chainId === book.chainId && isAddressEqual(b.master, book.master)),
        mark,
        settledCycle
      }
    })
  )
}

export function openBacking(own: IOwnState): bigint {
  const closed = new Set(own.settleRows.map(r => `${getAddress(r.master)}-${r.spokeChainId}-${r.cycle}`))
  return own.backings
    .filter(r => !closed.has(`${getAddress(r.master)}-${r.chainId}-${r.cycle}`))
    .reduce((total, r) => total + r.stake, 0n)
}

export interface IBackingView {
  row: IBackingRow
  book: IBookRow
  mark: IMarkRow | undefined
  claim: bigint | null
  pnl: bigint | null
}

export async function ownBackingViews(own: IOwnState): Promise<IBackingView[]> {
  return Promise.all(
    own.backings
      .filter(r => r.stake > 0n)
      .map(async row => {
        const chainId = Number(row.chainId)
        const mine = isAddressEqual(own.account, row.master)
        const book = mine ? own.books.find(b => b.id === bookIdOf(chainId, row.master)) : await fetchBook(chainId, row.master)
        if (book === undefined) throw new Error(`your backing of ${row.master} on chain ${chainId} has no book row`)
        const mark = mine ? await markOf(own, book.lastMark) : book.lastMark === '' ? undefined : await fetchMark(book.lastMark)
        if (row.cycle !== book.cycle || mark === undefined || mark.pending || mark.closeValue === undefined) {
          return { row, book, mark, claim: null, pnl: null }
        }
        const backers = mine
          ? own.backers.filter(b => b.chainId === row.chainId && isAddressEqual(b.master, row.master))
          : (await fetchBackings({ master: row.master })).filter(b => b.chainId === row.chainId)
        const ledger = {
          totalShares: book.totalShares,
          totalPending: book.totalPending,
          backing: book.backed,
          masterShares: book.masterShares,
          masterPending: book.masterPending
        }
        const owed = owedFor(ledger, mark.closeValue, mark.closeValue, backers).find(o => isAddressEqual(o.puppet, row.puppet))
        const pnl = owed === undefined ? null : owed.owed
        return { row, book, mark, claim: pnl === null ? null : row.stake + pnl, pnl }
      })
  )
}
