import { type Address, erc20Abi, getAddress, type PublicClient } from 'viem'
import { readContract } from 'viem/actions'
import { predictTransientRoute } from '../account/index.js'
import { type IIndexerClient, selectOne } from './shared.js'

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
  const route = predictTransientRoute(account)
  return readContract(publicClient, {
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [route]
  })
}

export async function pollTransientRouteBalance(
  publicClient: PublicClient,
  token: Address,
  account: Address,
  minAmount: bigint,
  timeoutMs: number,
  pollMs = 2_000
): Promise<bigint> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const balance = await fetchTransientRouteBalance(publicClient, token, account)
    if (balance >= minAmount) return balance
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error(`TransientRoute balance did not reach ${minAmount} for ${account} within ${timeoutMs}ms`)
}
