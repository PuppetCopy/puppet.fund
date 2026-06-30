import type { ChainId } from '../const/index.js'

interface IChainLivenessEntry {
  block: { number: bigint; timestamp: number }
  reachable: boolean
}

export interface IChainLiveness {
  reachable: boolean
  // Per-chain LIVENESS, keyed by chainId (not the network slug — that's only for drpc URLs, so a lookup can't silently
  // miss on a slug mismatch). There is no indexer to trail the head: a reachable chain is current, so the only signal is
  // reachable + its block. Absent chainId => no liveness to report (consumers treat it as unreachable).
  chains: { [chainId: number]: IChainLivenessEntry }
  fetchedAtSec: number
}

export function chainHeadBlock(liveness: IChainLiveness, chainId: ChainId): bigint {
  const chain = liveness.chains[chainId]
  if (!chain) throw new Error(`no live block for chain ${chainId}`)
  return chain.block.number
}

// Per-chain liveness read live from RPC. Deps injected so the SDK stays store-free; the caller passes only the chains it
// cares about (so an oracle-only chain with no dispatch RPC is never polled here).
export interface IChainLivenessDeps {
  chainIds: readonly ChainId[]
  chainHead(chainId: ChainId): Promise<bigint>
}

export async function fetchChainLiveness(deps: IChainLivenessDeps): Promise<IChainLiveness> {
  const fetchedAtSec = Math.floor(Date.now() / 1000)
  const chains: IChainLiveness['chains'] = {}
  let reachable = false
  await Promise.all(
    deps.chainIds.map(async chainId => {
      const head = await deps.chainHead(chainId).catch(() => null)
      if (head === null) return
      reachable = true
      chains[chainId] = { block: { number: head, timestamp: fetchedAtSec }, reachable: true }
    })
  )
  return { reachable, chains, fetchedAtSec }
}
