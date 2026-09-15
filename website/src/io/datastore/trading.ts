import type { IBackerRow, IBookRow, IMarkRow } from '@puppet/sdk/schema'
import { fetchBackings, fetchMark, fetchSettlements } from './reads.js'

export interface ITradeView {
  book: IBookRow
  backers: IBackerRow[]
  mark: IMarkRow | undefined
  settledCycle: bigint
}

export async function tradeViews(books: readonly IBookRow[]): Promise<ITradeView[]> {
  return Promise.all(
    books.map(async book => {
      const [mark, settlements, backers] = await Promise.all([
        book.lastMark === '' ? undefined : fetchMark(book.lastMark),
        fetchSettlements({ master: book.master }),
        fetchBackings({ master: book.master })
      ])
      const settledCycle = settlements
        .filter(s => s.spokeChainId === book.chainId && s.kind === 'settle')
        .reduce((max, s) => (s.cycle > max ? s.cycle : max), 0n)
      return { book, backers: backers.filter(b => b.chainId === book.chainId), mark, settledCycle }
    })
  )
}
