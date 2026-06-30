import type { IAccountBalanceRow, ITokenRegistryMap } from '@puppet/sdk/state'
import { type Address, getAddress } from 'viem'
import { readSignedBalance } from './account.js'

// An account's signed balances read straight from each BaseAccount.signedBalanceOf across the registered token set
// (the registry is itself on-chain now), cache-first via the SW. Works for any account (own or a fund's subscriber).
// Block metadata is not part of a point read and is unused by the current-balance path. Zero balances are dropped.
export async function readAccountBalances(
  registry: ITokenRegistryMap,
  account: Address,
  refresh?: boolean
): Promise<IAccountBalanceRow[]> {
  const acct = getAddress(account)
  const rows = await Promise.all(
    [...registry].flatMap(([chainId, tokens]) =>
      [...tokens.values()].map(async info => {
        const signed = await readSignedBalance(acct, chainId, info.token, refresh).catch(() => 0n)
        if (signed === 0n) return null
        return {
          id: `${chainId}-${acct}-${info.token}`,
          chainId: BigInt(chainId),
          account: acct,
          token: info.token,
          blockNumber: 0n,
          blockTimestamp: 0,
          signedBalance: signed
        } satisfies IAccountBalanceRow
      })
    )
  )
  return rows.filter((r): r is IAccountBalanceRow => r !== null)
}
