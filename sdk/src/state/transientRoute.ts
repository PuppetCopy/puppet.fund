import { type Address, erc20Abi, getAddress, type PublicClient } from 'viem'
import { readContract } from 'viem/actions'
import { predictDepositRoute, predictTransientRoute } from '../account/index.js'
import { type IIndexerClient, selectOne } from './shared.js'

export async function fetchRouteBalance(publicClient: PublicClient, token: Address, route: Address): Promise<bigint> {
  return readContract(publicClient, { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [route] })
}

export async function pollRouteBalance(
  publicClient: PublicClient,
  token: Address,
  route: Address,
  minAmount: bigint,
  timeoutMs: number,
  pollMs = 2_000
): Promise<bigint> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const balance = await fetchRouteBalance(publicClient, token, route)
    if (balance >= minAmount) return balance
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error(`route balance did not reach ${minAmount} for ${route} within ${timeoutMs}ms`)
}

export async function fetchAccountSurplus(sql: IIndexerClient, chainId: bigint, account: Address): Promise<bigint> {
  const row = await selectOne(sql, 'AccountState', {
    where: { account: { _eq: getAddress(account) }, chainId: { _eq: chainId } },
    fields: ['recordedBalance', 'signedBalance']
  })
  if (!row) return 0n
  const surplus = row.recordedBalance - row.signedBalance
  return surplus > 0n ? surplus : 0n
}

export async function fetchTransientRouteBalance(
  publicClient: PublicClient,
  token: Address,
  account: Address
): Promise<bigint> {
  return fetchRouteBalance(publicClient, token, predictTransientRoute(account))
}

export async function pollTransientRouteBalance(
  publicClient: PublicClient,
  token: Address,
  account: Address,
  minAmount: bigint,
  timeoutMs: number,
  pollMs = 2_000
): Promise<bigint> {
  return pollRouteBalance(publicClient, token, predictTransientRoute(account), minAmount, timeoutMs, pollMs)
}

export async function fetchDepositRouteBalance(
  publicClient: PublicClient,
  token: Address,
  account: Address
): Promise<bigint> {
  return fetchRouteBalance(publicClient, token, predictDepositRoute(account))
}

export async function pollDepositRouteBalance(
  publicClient: PublicClient,
  token: Address,
  account: Address,
  minAmount: bigint,
  timeoutMs: number,
  pollMs = 2_000
): Promise<bigint> {
  return pollRouteBalance(publicClient, token, predictDepositRoute(account), minAmount, timeoutMs, pollMs)
}
