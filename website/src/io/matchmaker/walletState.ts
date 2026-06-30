import { predictPuppetAccount } from '@puppet/sdk/account'
import { accountIdentityTable, fundPositionTable, fundTable } from '@puppet/sdk/schema'
import {
  composeSubaccount,
  type ISubaccountState,
  type ITokenRegistryMap,
  stubSubaccountState,
  withBalanceRows
} from '@puppet/sdk/state'
import { type Address, getAddress, type Hex } from 'viem'
import { readAccountBalances } from '../onchain/balances.js'
import { client } from './reads.js'

// Any account's subaccount state composed from the datastore reads (identity + balances + mastered funds + holder
// positions). Identity/isFund/signer come from the folded AccountIdentity rows. No identity => the account was never
// deployed, so it holds nothing on-chain: short-circuit before the balance sweep.
export async function readSubaccountState(
  registry: ITokenRegistryMap,
  account: Address
): Promise<ISubaccountState | undefined> {
  const acct = getAddress(account)
  const idRows = await client.select(accountIdentityTable, { where: { account: acct } })
  if (idRows.length === 0) return undefined
  const [balanceRows, fundRows, positionRows] = await Promise.all([
    readAccountBalances(registry, acct).catch(() => []),
    client.select(fundTable, { where: { master: acct } }),
    client.select(fundPositionTable, { where: { holder: acct } })
  ])
  const identities = idRows.map(r => ({
    account: acct as Hex,
    chainId: r.chainId,
    isFund: r.isFund,
    user: r.user,
    signer: r.signer
  }))
  return composeSubaccount(identities, balanceRows, fundRows, positionRows)
}

// The PA-root wallet state. Identity (user/signer) comes from the caller's session params; the folded rows contribute
// per-chain presence, funds and positions, and the balances read on-chain. No identity => the PA was never deployed
// (holds no signed balances/funds/positions), so return the stub without sweeping balances.
export async function readWalletState(
  registry: ITokenRegistryMap,
  params: { user: Address; signer: Address }
): Promise<ISubaccountState> {
  const puppet = predictPuppetAccount(params)
  const idRows = await client.select(accountIdentityTable, { where: { account: puppet } })
  if (idRows.length === 0) return stubSubaccountState(params)
  const [balanceRows, fundRows, positionRows] = await Promise.all([
    readAccountBalances(registry, puppet),
    client.select(fundTable, { where: { master: puppet } }),
    client.select(fundPositionTable, { where: { holder: puppet } })
  ])
  const identities = idRows.map(r => ({
    account: puppet,
    chainId: r.chainId,
    isFund: false,
    user: params.user,
    signer: params.signer
  }))
  return (
    composeSubaccount(identities, balanceRows, fundRows, positionRows) ??
    withBalanceRows({ ...stubSubaccountState(params), funds: fundRows, positions: positionRows }, balanceRows)
  )
}
