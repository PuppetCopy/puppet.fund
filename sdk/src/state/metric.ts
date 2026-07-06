import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type Address, getAddress, type Hex } from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import type { IAccountBalanceCheckpoint, IFund, IFundPosition } from '../schema/index.js'

const ZERO_TX_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

// The latest checkpoint per (chain, token) IS the balance row: event-sourced, no
// mutable view entity.
export type IAccountBalanceRow = IAccountBalanceCheckpoint

// Identity is event-sourced: derived from the raw Deploy{Puppet,Fund}Account rows (or
// the caller's own params), not an indexer projection.
export interface IAccountIdentity {
  account: Hex
  chainId: bigint
  isFund: boolean
  user?: Hex
  signer: Hex
}

export type ISubaccountState = IAccountIdentity & {
  chains: Map<number, IAccountIdentity>
  balances: Map<Address, IAccountBalanceRow>
  // Session-held settlement cursor: the client learns these from its own attest results
  // (the indexer is event-sourced and keeps no per-account aggregates).
  lastNonce: bigint
  lastTransactionHash: Hex
  // The last settle's (chain, block): the floor a post-settlement balance REFRESH must pin its reads at, so a
  // load-balanced node lagging the settle block cannot answer with pre-settlement state and have it cached as fresh.
  lastSettled: { chainId: number; block: bigint } | null
  // The wallet's FA graph rides the state that is already passed down everywhere: a
  // puppet row carries the funds it masters, a fund row carries its own Fund entity,
  // and positions are this account's FundPosition rows (holder-keyed).
  funds: IFund[]
  positions: IFundPosition[]
}

const positionsForAccount = (account: Address, positionRows: IFundPosition[]): IFundPosition[] =>
  positionRows.filter(p => p.holder === account)

// Mastered funds, the fund's own row, AND funds this account holds positions in: a
// puppet's position in someone else's fund still needs that Fund row downstream.
const fundsForAccount = (account: Address, fundRows: IFund[], positions: IFundPosition[]): IFund[] => {
  const positionFundSet = new Set(positions.map(p => p.fund))
  return fundRows.filter(f => f.master === account || f.fund === account || positionFundSet.has(f.fund))
}

function balancesForAccount(account: Address, balanceRows: IAccountBalanceRow[]): Map<Address, IAccountBalanceRow> {
  const balances = new Map<Address, IAccountBalanceRow>()
  for (const balance of balanceRows) {
    if (balance.account === account) balances.set(getAddress(balance.token), balance)
  }
  return balances
}

// Assemble a subaccount from its row sets, source-agnostic: the matchmaker fetches them from the logstore directly,
// the website over relay HTTP. Returns undefined when the account has no deploy identity.
export function composeSubaccount(
  identities: IAccountIdentity[],
  balanceRows: IAccountBalanceRow[],
  fundRows: IFund[],
  positionRows: IFundPosition[]
): ISubaccountState | undefined {
  if (identities.length === 0) return undefined
  const account = identities[0].account
  const chains = new Map<number, IAccountIdentity>()
  for (const identity of identities) chains.set(Number(identity.chainId), identity)
  const positions = positionsForAccount(account, positionRows)
  return {
    ...identities[0],
    chains,
    balances: balancesForAccount(account, balanceRows),
    funds: fundsForAccount(account, fundRows, positions),
    positions,
    lastNonce: 0n,
    lastTransactionHash: ZERO_TX_HASH,
    lastSettled: null
  }
}

// Overlay aggregated signed-balance rows (from the logstore) onto a subaccount's `balances`, leaving identity, funds
// and positions on their original source. The rows are already scoped to this account and ordered so the
// intended chain lands last per tokenId (highest chainId wins, matching balancesForAccount). Empty rows (cold-miss)
// leaves the original balances untouched.
export function withBalanceRows(state: ISubaccountState, balanceRows: IAccountBalanceRow[]): ISubaccountState {
  if (balanceRows.length === 0) return state
  const balances = new Map<Address, IAccountBalanceRow>()
  for (const row of balanceRows) balances.set(getAddress(row.token), row)
  return { ...state, balances }
}

export function stubSubaccountState(params: { user: Address; signer: Address }): ISubaccountState {
  const account = predictPuppetAccount(params)
  return {
    account,
    chainId: BigInt(HUB_CHAIN_ID),
    isFund: false,
    user: params.user,
    signer: params.signer,
    lastNonce: 0n,
    lastTransactionHash: ZERO_TX_HASH,
    lastSettled: null,
    chains: new Map(),
    balances: new Map(),
    funds: [],
    positions: []
  }
}
