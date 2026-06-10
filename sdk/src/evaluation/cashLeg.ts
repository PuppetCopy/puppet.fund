import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { Hex } from 'viem'
import type { ChainId } from '../const/index.js'
import { max } from '../core/math.js'
import type { IndexerHealth } from '../state/health.js'
import type { ISubaccountState } from '../state/metric.js'
import type { INavChainBalance } from './types.js'

export function composeCashLeg(
  subaccount: ISubaccountState | undefined,
  health: IndexerHealth,
  baseTokenId: Hex
): INavChainBalance[] {
  const chains: INavChainBalance[] = []
  if (!subaccount) return chains
  const recordedByChain = new Map<ChainId, bigint>()
  const signedByChain = new Map<ChainId, bigint>()
  for (const balance of subaccount.balances.values()) {
    if (balance.tokenId !== baseTokenId) continue
    const chainId = Number(balance.chainId) as ChainId
    recordedByChain.set(chainId, (recordedByChain.get(chainId) ?? 0n) + balance.recordedBalance)
    signedByChain.set(chainId, (signedByChain.get(chainId) ?? 0n) + balance.signedBalance)
  }
  for (const chainIdNum of subaccount.chains.keys()) {
    const chainId = chainIdNum as ChainId
    const recordedBalance = recordedByChain.get(chainId) ?? 0n
    const signedBalance = signedByChain.get(chainId) ?? 0n
    const chainHealth = health.chains[CHAIN_NETWORK_MAP[chainId]]
    chains.push({
      chainId,
      recordedBalance,
      signedBalance,
      unrecognized: max(0n, recordedBalance - signedBalance),
      ageSec: chainHealth?.ageSec ?? Number.POSITIVE_INFINITY,
      severity: chainHealth?.severity ?? 'unreachable'
    })
  }
  return chains
}
