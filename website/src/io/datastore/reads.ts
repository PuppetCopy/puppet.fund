import { createClient } from '@puppet/sdk/datastore'
import { bookIdOf } from '@puppet/sdk/fold'
import * as schema from '@puppet/sdk/schema'
import {
  accountTable,
  backerTable,
  bondTable,
  bookTable,
  depositTable,
  type IAccountRow,
  type IBackerRow,
  type IBondRow,
  type IBookRow,
  type IDepositRow,
  type IMarkRow,
  type ISettlementRow,
  markTable,
  masterMetricTable,
  settlementTable
} from '@puppet/sdk/schema'
import { type Address, getAddress } from 'viem'

export const client = createClient({ storageUrl: '/api/chronicle', schema })

export const fetchDeposits = (accounts: readonly Address[]): Promise<IDepositRow[]> =>
  client.select(depositTable, { where: { account: { in: accounts } } })

export const fetchBonds = (accounts: readonly Address[]): Promise<IBondRow[]> =>
  client.select(bondTable, { where: { account: { in: accounts } } })

export const fetchAccount = (chainId: number, account: Address): Promise<IAccountRow | undefined> =>
  client.find(accountTable, { chainId: BigInt(chainId), account })

export async function fetchOwnedAccount(owner: Address): Promise<Address | null> {
  const rows = await client.select(accountTable, { where: { owner } })
  const accounts = [...new Set(rows.map(r => getAddress(r.account)))]
  if (accounts.length > 1) throw new Error(`${owner} owns ${accounts.length} accounts; one wallet holds exactly one account`)
  return accounts[0] ?? null
}

export const fetchBooks = (where: { master?: Address; owner?: Address }): Promise<IBookRow[]> => client.select(bookTable, { where })

export const fetchAllBooks = (): Promise<IBookRow[]> => client.select(bookTable)

export const fetchBook = (chainId: number, master: Address): Promise<IBookRow | undefined> =>
  client.find(bookTable, { id: bookIdOf(chainId, master) })

export const fetchBackings = (where: { puppet?: Address; master?: Address }): Promise<IBackerRow[]> => client.select(backerTable, { where })

export const fetchMark = (id: string): Promise<IMarkRow | undefined> => client.find(markTable, { id })

export const fetchMarksById = (ids: readonly string[]): Promise<IMarkRow[]> =>
  ids.length === 0 ? Promise.resolve([]) : client.select(markTable, { where: { id: { in: ids } } })

export const fetchSettlements = (where: { master?: Address | { in: readonly Address[] } }): Promise<ISettlementRow[]> =>
  client.select(settlementTable, { where, orderBy: { col: 'blockTimestamp', dir: 'desc' } })

export const fetchMarks = (book: string, limit = 200): Promise<IMarkRow[]> =>
  client.select(markTable, { where: { book }, orderBy: { col: 'block', dir: 'desc' }, limit })

export const fetchMasterMetrics = (interval: number, masters: readonly Address[]) =>
  client.select(masterMetricTable, { where: { interval, master: { in: masters } } })
