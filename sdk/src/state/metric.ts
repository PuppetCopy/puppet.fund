import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { combineMap, type IStream } from 'aelea/stream'
import { type Address, getAddress, type Hex } from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import { type IIndexerClient, liveSelect, select } from './shared.js'

export interface IAccountRow {
  id: string
  account: Address
  chainId: bigint
  isFund: boolean
  user?: Address
  signer: Address
  balanceUsd: bigint
  lastNonce: bigint
  lastEventBlock: bigint
  lastEventAt: number
  lastTransactionHash: Hex
}

export interface IAccountBalanceRow {
  id: string
  account: Address
  chainId: bigint
  tokenId: Hex
  token: Address
  signedBalance: bigint
  recordedBalance: bigint
  lastEventBlock: bigint
  lastEventAt: number
}

export type ISubaccountState = IAccountRow & {
  chains: Map<number, IAccountRow>
  balances: Map<Hex, IAccountBalanceRow>
}

function balancesForAccount(account: Address, balanceRows: IAccountBalanceRow[]): Map<Hex, IAccountBalanceRow> {
  const balances = new Map<Hex, IAccountBalanceRow>()
  for (const balance of balanceRows) {
    if (balance.account === account) balances.set(balance.tokenId, balance)
  }
  return balances
}

function rowsToSubaccount(rows: IAccountRow[], balanceRows: IAccountBalanceRow[]): ISubaccountState | undefined {
  if (rows.length === 0) return undefined
  const chains = new Map<number, IAccountRow>()
  for (const r of rows) chains.set(Number(r.chainId), r)
  return { ...rows[0], chains, balances: balancesForAccount(rows[0].account, balanceRows) }
}

function rowsToSubaccountList(rows: IAccountRow[], balanceRows: IAccountBalanceRow[]): ISubaccountState[] {
  const buckets = new Map<string, IAccountRow[]>()
  for (const row of rows) {
    const list = buckets.get(row.account) ?? []
    list.push(row)
    buckets.set(row.account, list)
  }
  const out: ISubaccountState[] = []
  for (const bucket of buckets.values()) {
    const state = rowsToSubaccount(bucket, balanceRows)
    if (state) out.push(state)
  }
  return out
}

export async function getSubaccountState(sql: IIndexerClient, account: Address): Promise<ISubaccountState | undefined> {
  const checksummed = getAddress(account)
  const [rows, balanceRows] = await Promise.all([
    select(sql, 'Account', { where: { account: { _eq: checksummed } } }),
    select(sql, 'AccountBalance', { where: { account: { _eq: checksummed } } })
  ])
  return rowsToSubaccount(rows, balanceRows)
}

export function liveSubaccountState(sql: IIndexerClient, account: Address): IStream<ISubaccountState | undefined> {
  const checksummed = getAddress(account)
  return combineMap(
    rowsToSubaccount,
    liveSelect(sql, 'Account', { where: { account: { _eq: checksummed } } }),
    liveSelect(sql, 'AccountBalance', { where: { account: { _eq: checksummed } } })
  )
}

export async function getUserSubaccountList(sql: IIndexerClient, user: Address): Promise<ISubaccountState[]> {
  const owned = await select(sql, 'Account', { where: { user: { _eq: getAddress(user) } } })
  const puppetAccounts = owned.filter(row => !row.isFund).map(row => row.account)
  const fundRows =
    puppetAccounts.length > 0
      ? await select(sql, 'Account', { where: { isFund: { _eq: true }, signer: { _in: puppetAccounts } } })
      : []
  const seen = new Set(owned.map(row => row.id))
  const rows = [...owned, ...fundRows.filter(row => !seen.has(row.id))]
  const balanceRows = await select(sql, 'AccountBalance', {
    where: { account: { _in: rows.map(row => row.account) } }
  })
  return rowsToSubaccountList(rows, balanceRows)
}

export function liveUserSubaccountList(sql: IIndexerClient, user: Address): IStream<ISubaccountState[]> {
  return combineMap(
    (owned, allFunds, balanceRows) => {
      const puppetAccounts = new Set(owned.filter(row => !row.isFund).map(row => row.account))
      const seen = new Set(owned.map(row => row.id))
      const fundRows = allFunds.filter(row => puppetAccounts.has(row.signer) && !seen.has(row.id))
      return rowsToSubaccountList([...owned, ...fundRows], balanceRows)
    },
    liveSelect(sql, 'Account', { where: { user: { _eq: getAddress(user) } } }),
    liveSelect(sql, 'Account', { where: { isFund: { _eq: true } } }),
    liveSelect(sql, 'AccountBalance', {})
  )
}

export function stubSubaccountState(params: { user: Address; signer: Address }): ISubaccountState {
  const account = predictPuppetAccount(params)
  return {
    id: account,
    account,
    chainId: BigInt(HUB_CHAIN_ID),
    isFund: false,
    user: params.user,
    signer: params.signer,
    balanceUsd: 0n,
    lastNonce: 0n,
    lastEventBlock: 0n,
    lastEventAt: 0,
    lastTransactionHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
    chains: new Map(),
    balances: new Map()
  }
}
