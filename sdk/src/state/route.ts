import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, erc20Abi, getAddress, isAddressEqual, type PublicClient } from 'viem'
import { getBalance, readContract } from 'viem/actions'
import { predictDepositRoute } from '../account/index.js'
import { awaitWhile } from '../core/await.js'

export async function fetchRouteBalance(publicClient: PublicClient, token: Address, route: Address): Promise<bigint> {
  if (isAddressEqual(getAddress(token), PROTOCOL.nativeToken)) return getBalance(publicClient, { address: route })
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
  return awaitWhile(
    async () => {
      const balance = await fetchRouteBalance(publicClient, token, route)
      return balance >= minAmount ? balance : undefined
    },
    { timeoutMs, pollMs, timeoutMessage: `route balance did not reach ${minAmount} for ${route} within ${timeoutMs}ms` }
  )
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
