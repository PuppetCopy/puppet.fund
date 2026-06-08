import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { ChainId } from '../const/index.js'
import { max } from '../core/math.js'
import type { IndexerHealth } from '../state/health.js'
import type { ISubaccountState } from '../state/metric.js'
import type { INavChainBalance } from './types.js'

export function composeCashLeg(subaccount: ISubaccountState | undefined, health: IndexerHealth): INavChainBalance[] {
  const chains: INavChainBalance[] = []
  if (!subaccount) return chains
  for (const [chainIdNum, row] of subaccount.chains) {
    const chainId = chainIdNum as ChainId
    const chainHealth = health.chains[CHAIN_NETWORK_MAP[chainId]]
    chains.push({
      chainId,
      recordedBalance: row.recordedBalance,
      signedBalance: row.signedBalance,
      unrecognized: max(0n, row.recordedBalance - row.signedBalance),
      ageSec: chainHealth?.ageSec ?? Number.POSITIVE_INFINITY,
      severity: chainHealth?.severity ?? 'unreachable'
    })
  }
  return chains
}
