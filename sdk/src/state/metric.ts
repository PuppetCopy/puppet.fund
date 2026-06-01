import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountState } from '@puppet/indexer-graphql/entities'
import { type IStream, map } from 'aelea/stream'
import { type Address, getAddress, type Hex } from 'viem'
import { predictMasterAccount, predictPuppetAccount } from '../account/index.js'
import { type IIndexerClient, liveSelect, select } from './shared.js'

export type IAccountStateRow = IAccountState

export type ISubaccountState = IAccountStateRow & {
  chains: Map<number, IAccountStateRow>
}

function rowsToSubaccount(rows: IAccountStateRow[]): ISubaccountState | undefined {
  if (rows.length === 0) return undefined
  const chains = new Map<number, IAccountStateRow>()
  for (const r of rows) chains.set(Number(r.chainId), r)
  return { ...rows[0], chains }
}

function rowsToSubaccountList(rows: IAccountStateRow[]): ISubaccountState[] {
  const buckets = new Map<string, IAccountStateRow[]>()
  for (const row of rows) {
    const list = buckets.get(row.account) ?? []
    list.push(row)
    buckets.set(row.account, list)
  }
  const out: ISubaccountState[] = []
  for (const bucket of buckets.values()) {
    const state = rowsToSubaccount(bucket)
    if (state) out.push(state)
  }
  return out
}

export async function getSubaccountState(sql: IIndexerClient, account: Address): Promise<ISubaccountState | undefined> {
  return rowsToSubaccount(await select(sql, 'AccountState', { where: { account: { _eq: getAddress(account) } } }))
}

export function liveSubaccountState(sql: IIndexerClient, account: Address): IStream<ISubaccountState | undefined> {
  return map(rowsToSubaccount, liveSelect(sql, 'AccountState', { where: { account: { _eq: getAddress(account) } } }))
}

export async function getUserSubaccountList(sql: IIndexerClient, user: Address): Promise<ISubaccountState[]> {
  return rowsToSubaccountList(await select(sql, 'AccountState', { where: { user: { _eq: getAddress(user) } } }))
}

export function liveUserSubaccountList(sql: IIndexerClient, user: Address): IStream<ISubaccountState[]> {
  return map(rowsToSubaccountList, liveSelect(sql, 'AccountState', { where: { user: { _eq: getAddress(user) } } }))
}

export function stubSubaccountState(params: {
  user: Address
  signer: Address
  name: Hex
  baseTokenId: Hex
}): ISubaccountState {
  const account = predictPuppetAccount(params)
  return {
    id: account,
    account,
    chainId: BigInt(HUB_CHAIN_ID),
    user: params.user,
    signer: params.signer,
    name: params.name,
    baseTokenId: params.baseTokenId,
    signedBalance: 0n,
    recordedBalance: 0n,
    positionBalance: 0n,
    isMaster: false,
    lastNonce: 0n,
    lastEventBlock: 0n,
    lastEventAt: 0,
    lastTransactionHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
    chains: new Map()
  }
}

export function stubMasterState(params: {
  user: Address
  signer: Address
  name: Hex
  baseTokenId: Hex
}): ISubaccountState {
  return {
    ...stubSubaccountState(params),
    account: predictMasterAccount(params),
    isMaster: true
  }
}
