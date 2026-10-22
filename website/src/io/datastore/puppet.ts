import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IStoredAccountCall } from '@puppet/sdk/account'
import { type IAccountBalance, type IJournalEntries, storedCalls, syncCalls } from '@puppet/sdk/client'
import type { ChainId } from '@puppet/sdk/const'
import { getUnixTimestamp } from '@puppet/sdk/core'
import type { IDigestClient } from '@puppet/sdk/datastore'
import { fundValuationsOf } from '@puppet/sdk/fold'
import { accountTable, balanceTable, fundTable, holdingTable, mandateTable, transitTable } from '@puppet/sdk/schema'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { journalDeps } from '../journal/journal.js'
import { mandateWorth, ownHoldingViews } from './own.js'
import { answerState, client, localFirst, localReader, notLocal } from './reads.js'

const HUB = HUB_CHAIN_ID as ChainId

type ICallsOf = (chains: readonly ChainId[], accounts: readonly Address[]) => Promise<ReadonlyMap<Address, ReadonlyMap<ChainId, IStoredAccountCall[]>>>

const syncedCalls: ICallsOf = (chains, accounts) =>
  syncCalls(journalDeps, null, chains, accounts, 'changed').then(
    synced =>
      new Map(
        accounts.map(
          account =>
            [
              account,
              new Map(
                [...synced.calls.get(account)!].map(([chainId, result]) => {
                  if (result.status === 'rejected') throw result.reason
                  return [chainId, result.value] as const
                })
              )
            ] as const
        )
      )
  )

const deviceCalls: ICallsOf = async (chains, accounts) => {
  const held = new Map(
    await Promise.all(
      accounts.map(async account => [account, new Map(await Promise.all(chains.map(async chainId => [chainId, await storedCalls(journalDeps.store, chainId, account)] as const)))] as const)
    )
  )
  return [...held.values()].some(byChain => [...byChain.values()].every(calls => calls.length === 0)) ? notLocal : held
}

const viewAt = (self: Address, reader: IDigestClient, callsOf: ICallsOf) => {
  const rows = Promise.all([
    reader.select(accountTable, { where: { account: self } }),
    reader.select(accountTable, { where: { owner: self } }),
    reader.select(mandateTable, { where: { puppet: self } }),
    reader.select(holdingTable, { where: { holder: self } }),
    reader.select(balanceTable, { where: { account: self } }),
    reader.select(transitTable, { where: { account: self } })
  ]).then(async ([accounts, bodies, mandates, holdings, balances, transits]) => {
    const masters = [...new Set([...mandates, ...holdings].map(row => getAddress(row.master)))]
    const owned = [...new Set(bodies.map(row => getAddress(row.account)))]
    const fundRows = masters.length + owned.length === 0 ? [] : await reader.select(fundTable, { where: { master: { in: [...masters, ...owned] } } })
    return { accounts, owned, masters, mandates, holdings, balances, transits, fundRows }
  })
  const state = rows.then(async r => {
    const [first] = r.accounts
    return {
      user: first === undefined ? null : getAddress(first.owner),
      since: first === undefined ? null : Math.min(...r.accounts.map(row => row.createdAt)),
      funds: r.fundRows.filter(row => r.owned.some(body => isAddressEqual(body, row.master))),
      mandates: r.mandates,
      epoch: r.accounts.find(row => Number(row.chainId) === HUB)?.epoch ?? null,
      holdings: await ownHoldingViews(reader, { holdings: r.holdings, fundRows: [], redemptions: [] }, self),
      fundRows: r.fundRows.filter(row => r.masters.some(master => isAddressEqual(master, row.master))),
      balances: r.balances.map((row): IAccountBalance => ({ chainId: Number(row.chainId) as ChainId, token: getAddress(row.token), balance: row.amount })),
      transits: r.transits
    }
  })
  const own: Promise<IJournalEntries> = callsOf(CHAIN_IDS, [self]).then(calls => ({ account: self, entries: new Map(calls.get(self)!) }))
  const worth = Promise.all([rows, own, state]).then(async ([r, journal, s]) => {
    const valuations =
      r.masters.length === 0 ? [] : await callsOf([HUB], r.masters).then(calls => r.masters.flatMap(master => fundValuationsOf(master, calls.get(master)!.get(HUB)!)))
    const metrics = s.holdings.flatMap(h => (h.standing.kind === 'current' ? h.standing.metrics : []))
    const nowSec = getUnixTimestamp()
    return new Map(
      r.fundRows
        .filter(row => r.masters.some(master => isAddressEqual(master, row.master)))
        .map(row => {
          const rows = metrics.filter(m => isAddressEqual(m.master, row.master))
          return [getAddress(row.master), mandateWorth(journal, valuations, row, { rows, interval: Math.max(0, ...rows.map(m => m.interval)) }, nowSec)] as const
        })
    )
  })
  return { state, worth }
}

export function puppetView(account: Address) {
  const self = getAddress(account)
  const local = viewAt(self, localReader, deviceCalls)
  const fresh = viewAt(self, client, syncedCalls)
  return {
    account: self,
    state: answerState(
      localFirst(
        () => local.state,
        () => fresh.state
      )
    ),
    worth: answerState(
      localFirst(
        () => local.worth,
        () => fresh.worth
      )
    )
  }
}
