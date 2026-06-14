import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ISelectArgs } from '@puppet/indexer-graphql/client'
import type { IAccountBalanceCheckpoint, IFund, IFundPosition } from '@puppet/indexer-graphql/entities'
import { type Address, getAddress, type Hex } from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import { type IIndexerClient, select } from './shared.js'

const ZERO_TX_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

// The latest checkpoint per (chain, token) IS the balance row: event-sourced, no
// mutable view entity.
export type IAccountBalanceRow = IAccountBalanceCheckpoint

const latestBalanceArgs = (account: Hex): ISelectArgs<'AccountBalanceCheckpoint'> => ({
  where: { account: { _eq: account } },
  distinctOn: ['chainId', 'tokenId'],
  orderBy: [{ chainId: 'asc' }, { tokenId: 'asc' }, { blockTimestamp: 'desc' }]
})

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
  balances: Map<Hex, IAccountBalanceRow>
  // Session-held settlement cursor: the client learns these from its own attest results
  // (the indexer is event-sourced and keeps no per-account aggregates).
  lastNonce: bigint
  lastTransactionHash: Hex
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

function balancesForAccount(account: Address, balanceRows: IAccountBalanceRow[]): Map<Hex, IAccountBalanceRow> {
  const balances = new Map<Hex, IAccountBalanceRow>()
  for (const balance of balanceRows) {
    if (balance.account === account && balance.tokenId.length === 66) balances.set(balance.tokenId, balance)
  }
  return balances
}

function composeSubaccount(
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
    lastTransactionHash: ZERO_TX_HASH
  }
}

// Identity from the raw deploy log: both deploy events emit flat identity fields.
async function fetchDeployIdentities(sql: IIndexerClient, account: Hex): Promise<IAccountIdentity[]> {
  const [fundRows, puppetRows] = await Promise.all([
    select(sql, 'Account__DeployFundAccount', { where: { account: { _eq: account } }, fields: ['chainId', 'signer'] }),
    select(sql, 'Account__DeployPuppetAccount', {
      where: { account: { _eq: account } },
      fields: ['chainId', 'user', 'signer']
    })
  ])
  if (fundRows.length > 0) {
    return fundRows.map(row => ({
      account,
      chainId: row.chainId,
      isFund: true,
      signer: row.signer as Hex
    }))
  }
  return puppetRows.map(row => ({
    account,
    chainId: row.chainId,
    isFund: false,
    user: row.user as Hex,
    signer: row.signer as Hex
  }))
}

// Funds resolve by MASTER (indexed), known upfront: this covers mastered funds and the
// FA's own row in the same parallel round, no position-dependent second phase. Foreign
// funds (puppet positions in other masters' funds) ride the not-yet-built puppet flow
// and will need the FundPosition->Fund entity relation when it lands.
export async function getSubaccountState(sql: IIndexerClient, account: Address): Promise<ISubaccountState | undefined> {
  const checksummed = getAddress(account)
  const [identities, balanceRows, fundRows, positionRows] = await Promise.all([
    fetchDeployIdentities(sql, checksummed),
    select(sql, 'AccountBalanceCheckpoint', latestBalanceArgs(checksummed)),
    select(sql, 'Fund', { where: { master: { _eq: checksummed } } }),
    select(sql, 'FundPosition', { where: { holder: { _eq: checksummed } } })
  ])
  return composeSubaccount(identities, balanceRows, fundRows, positionRows)
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
    chains: new Map(),
    balances: new Map(),
    funds: [],
    positions: []
  }
}

// Predicted addressing: wallet -> signer -> PA -> FA is a deterministic 1-1 derivation,
// so the wallet has exactly ONE subaccount state: the PA root, with its mastered funds
// and positions riding it. Always resolves (stub when unindexed) so the app has a global
// state to lens from; identity comes from the caller's own session params and the raw
// deploy rows only contribute per-chain presence.
export async function getWalletState(
  sql: IIndexerClient,
  params: { user: Address; signer: Address }
): Promise<ISubaccountState> {
  const puppet = predictPuppetAccount(params)
  const [deployRows, balanceRows, fundRows, positionRows] = await Promise.all([
    select(sql, 'Account__DeployPuppetAccount', { where: { account: { _eq: puppet } }, fields: ['chainId'] }),
    select(sql, 'AccountBalanceCheckpoint', latestBalanceArgs(puppet)),
    select(sql, 'Fund', { where: { master: { _eq: puppet } } }),
    select(sql, 'FundPosition', { where: { holder: { _eq: puppet } } })
  ])
  const identities: IAccountIdentity[] = deployRows.map(row => ({
    account: puppet,
    chainId: row.chainId,
    isFund: false,
    user: params.user as Hex,
    signer: params.signer as Hex
  }))
  return (
    composeSubaccount(identities, balanceRows, fundRows, positionRows) ?? {
      ...stubSubaccountState(params),
      funds: fundRows,
      positions: positionRows
    }
  )
}
