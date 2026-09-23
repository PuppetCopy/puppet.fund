import type { ChainId } from '@puppet/sdk/const'
import { foldAccountEntry, type IAccountEntry, type IMemoryStore, memoryStore } from '@puppet/sdk/fold'
import {
  closedAccruedTable,
  creditTable,
  escrowTable,
  fundTable,
  holdingTable,
  type IClosedAccruedRow,
  type ICreditRow,
  type IEscrowRow,
  type IFundRow,
  type IHoldingRow,
  type IMandateRow,
  type IMasterMetricRow,
  type IPositionRow,
  type IQueueRow,
  type IValuationRow,
  mandateTable,
  masterMetricTable,
  positionTable,
  queueTable,
  valuationTable
} from '@puppet/sdk/schema'
import type { Address } from 'viem'
import type { IStoredAccountCall } from './callStore.js'

export interface IJournalEntries {
  account: Address
  entries: ReadonlyMap<ChainId, readonly IStoredAccountCall[]>
}

export interface IOwnState {
  account: Address
  mandates: IMandateRow[]
  holdings: IHoldingRow[]
  positions: IPositionRow[]
  fundRows: IFundRow[]
  queues: IQueueRow[]
  closedAccrued: IClosedAccruedRow[]
  valuations: IValuationRow[]
  metrics: IMasterMetricRow[]
  escrows: IEscrowRow[]
  credits: ICreditRow[]
}

export async function foldOwnAccount(own: IJournalEntries, bodyList: readonly IJournalEntries[]): Promise<IOwnState> {
  const store: IMemoryStore = memoryStore()
  const ordered = [own, ...bodyList]
    .flatMap(journal =>
      [...journal.entries].flatMap(([chainId, list]) =>
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
    )
    .sort((a, b) => a.chainId - b.chainId || a.block.number - b.block.number || a.logIndex - b.logIndex)
  for (const entry of ordered) await foldAccountEntry(store, entry)
  return {
    account: own.account,
    mandates: store.rowsOf(mandateTable),
    holdings: store.rowsOf(holdingTable),
    positions: store.rowsOf(positionTable),
    fundRows: store.rowsOf(fundTable),
    queues: store.rowsOf(queueTable),
    closedAccrued: store.rowsOf(closedAccruedTable),
    valuations: store.rowsOf(valuationTable),
    metrics: store.rowsOf(masterMetricTable),
    escrows: store.rowsOf(escrowTable),
    credits: store.rowsOf(creditTable)
  }
}
