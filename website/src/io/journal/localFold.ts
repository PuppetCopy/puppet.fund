import type { ChainId } from '@puppet/sdk/const'
import { foldAccountEntry, type IAccountEntry, type IMemoryStore, memoryStore } from '@puppet/sdk/fold'
import {
  backerTable,
  backingTable,
  bondTable,
  bookTable,
  depositTable,
  type IBackerRow,
  type IBackingRow,
  type IBondRow,
  type IBookRow,
  type IDepositRow,
  type IMandateRow,
  type IMarkRow,
  type ISettlementRow,
  type ISettleRowRow,
  mandateTable,
  markTable,
  settlementTable,
  settleRowTable
} from '@puppet/sdk/schema'
import type { Address } from 'viem'
import type { IStoredAccountCall } from './callStore.js'

export interface IJournalEntries {
  account: Address
  entries: ReadonlyMap<ChainId, readonly IStoredAccountCall[]>
}

export interface IOwnState {
  account: Address
  deposits: IDepositRow[]
  bonds: IBondRow[]
  backings: IBackingRow[]
  mandates: IMandateRow[]
  books: IBookRow[]
  backers: IBackerRow[]
  marks: IMarkRow[]
  settlements: ISettlementRow[]
  settleRows: ISettleRowRow[]
}

export async function foldOwnAccount(journal: IJournalEntries): Promise<IOwnState> {
  const store: IMemoryStore = memoryStore()
  const ordered = [...journal.entries]
    .flatMap(([chainId, list]) =>
      list.map(
        (call): IAccountEntry => ({
          chainId,
          account: journal.account,
          source: call.source,
          digest: call.digest,
          executionData: call.executionData,
          callList: call.callList,
          resultList: call.resultList,
          logs: call.logs,
          value: call.value,
          block: { number: Number(call.blockNumber), timestamp: call.blockTimestamp },
          logIndex: call.logIndex,
          transactionHash: call.transactionHash
        })
      )
    )
    .sort((a, b) => a.chainId - b.chainId || a.block.number - b.block.number || a.logIndex - b.logIndex)
  for (const entry of ordered) await foldAccountEntry(store, entry)
  return {
    account: journal.account,
    deposits: store.rowsOf(depositTable),
    bonds: store.rowsOf(bondTable),
    backings: store.rowsOf(backingTable),
    mandates: store.rowsOf(mandateTable),
    books: store.rowsOf(bookTable),
    backers: store.rowsOf(backerTable),
    marks: store.rowsOf(markTable),
    settlements: store.rowsOf(settlementTable),
    settleRows: store.rowsOf(settleRowTable)
  }
}
