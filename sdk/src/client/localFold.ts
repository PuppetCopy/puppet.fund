import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type Address, getAddress } from 'viem'
import type { IStoredAccountCall } from '../account/index.js'
import type { ChainId } from '../const/index.js'
import { dependenciesOf, foldAccountEntry, fundValuationsOf, type IAccountEntry, type IFundValuation, type IMemoryStore, memoryStore } from '../fold/index.js'
import {
  accountTable,
  allowanceTable,
  balanceTable,
  creditTable,
  escrowTable,
  fundMetricTable,
  fundTable,
  holdingTable,
  type IAccountRow,
  type IAllowanceRow,
  type IBalanceRow,
  type ICreditRow,
  type IEscrowRow,
  type IFundMetricRow,
  type IFundRow,
  type IHoldingRow,
  type IMandateRow,
  type IOwnerCreditRow,
  type IRedemptionRow,
  type ITransitRow,
  mandateTable,
  ownerCreditTable,
  redemptionTable,
  transitTable
} from '../schema/index.js'
import type { createJournal } from './journal.js'

type IJournal = ReturnType<typeof createJournal>

export interface IJournalEntries {
  account: Address
  entries: ReadonlyMap<ChainId, readonly IStoredAccountCall[]>
}

export interface IOwnState {
  account: Address
  accounts: IAccountRow[]
  mandates: IMandateRow[]
  holdings: IHoldingRow[]
  redemptions: IRedemptionRow[]
  fundRows: IFundRow[]
  valuations: IFundValuation[]
  metrics: IFundMetricRow[]
  escrows: IEscrowRow[]
  credits: ICreditRow[]
  ownerCredits: IOwnerCreditRow[]
  balances: IBalanceRow[]
  transits: ITransitRow[]
  allowances: IAllowanceRow[]
}

export interface IAccountView {
  own: IJournalEntries
  bodyList: IJournalEntries[]
  state: IOwnState
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
            balanceList: call.balanceList,
            siblingLogs: call.siblingLogs,
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
    accounts: store.rowsOf(accountTable),
    mandates: store.rowsOf(mandateTable),
    holdings: store.rowsOf(holdingTable),
    redemptions: store.rowsOf(redemptionTable),
    fundRows: store.rowsOf(fundTable),
    valuations: bodyList.flatMap(journal => fundValuationsOf(journal.account, journal.entries.get(HUB_CHAIN_ID as ChainId) ?? [])),
    metrics: store.rowsOf(fundMetricTable),
    escrows: store.rowsOf(escrowTable),
    credits: store.rowsOf(creditTable),
    ownerCredits: store.rowsOf(ownerCreditTable),
    balances: store.rowsOf(balanceTable),
    transits: store.rowsOf(transitTable),
    allowances: store.rowsOf(allowanceTable)
  }
}

const reachedFrom = (views: readonly IJournalEntries[], known: ReadonlyMap<Address, IJournalEntries>): Address[] =>
  [
    ...new Set(
      views.flatMap(view =>
        [...view.entries.values()].flatMap(list => list.flatMap(call => dependenciesOf({ account: view.account, source: call.source, executionData: call.executionData })))
      )
    )
  ].filter(dependency => !known.has(dependency))

async function cachedClosure(journal: IJournal, seed: readonly Address[]): Promise<Map<Address, IJournalEntries>> {
  const cached = new Map<Address, IJournalEntries>()
  for (let frontier = [...seed]; frontier.length > 0; ) {
    const views = await Promise.all(frontier.map(async held => ({ account: held, entries: await journal(held).entries() })))
    for (const view of views) cached.set(view.account, view)
    frontier = reachedFrom(views, cached)
  }
  return cached
}

export async function localAccountView(journal: IJournal, account: Address, fund: Address | null): Promise<IAccountView> {
  const self = getAddress(account)
  const body = fund === null ? null : getAddress(fund)
  const cached = await cachedClosure(journal, body === null ? [self] : [self, body])
  const own = cached.get(self)!
  return { own, bodyList: body === null ? [] : [cached.get(body)!], state: await foldOwnAccount(own, [...cached.values()].filter(view => view.account !== self)) }
}

export async function accountView(journal: IJournal, account: Address, fund: Address | null, check: 'all' | 'changed'): Promise<IAccountView> {
  await journal(account).sync(check)
  return localAccountView(journal, account, fund)
}
