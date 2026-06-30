import type { Address } from 'viem'
import type { ChainId } from '../const/index.js'
import { max } from '../core/math.js'
import type { IChainLiveness } from '../state/health.js'
import type { ISubaccountState } from '../state/metric.js'
import type { INavChainBalance } from './types.js'

export function composeCashLeg(
  subaccount: ISubaccountState | undefined,
  liveness: IChainLiveness,
  baseToken: Address,
  heldByChain?: Map<ChainId, bigint>
): INavChainBalance[] {
  const chains: INavChainBalance[] = []
  if (!subaccount) return chains
  const signedByChain = new Map<ChainId, bigint>()
  for (const balance of subaccount.balances.values()) {
    if (balance.token !== baseToken) continue
    const chainId = Number(balance.chainId) as ChainId
    signedByChain.set(chainId, (signedByChain.get(chainId) ?? 0n) + balance.signedBalance)
  }
  for (const chainIdNum of subaccount.chains.keys()) {
    const chainId = chainIdNum as ChainId
    const signedBalance = signedByChain.get(chainId) ?? 0n
    // On-chain custody (balanceOf) when injected; else the signed balance (a reader without a custody read treats
    // recorded == signed, so its unrecognized gap is 0). The injected held figure catches inflows that emit no
    // signed-domain event (a returning GMX position), so the unrecognized gate refuses to price NAV until co-signed.
    const custody = heldByChain?.get(chainId) ?? signedBalance
    chains.push({
      chainId,
      signedBalance,
      unrecognized: max(0n, custody - signedBalance),
      reachable: liveness.chains[chainId]?.reachable ?? false
    })
  }
  return chains
}
