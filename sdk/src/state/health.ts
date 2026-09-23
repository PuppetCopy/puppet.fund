import type { ChainId } from '../const/index.js'

interface IChainLivenessEntry {
  block: { number: bigint; timestamp: number }
}

export interface IChainLiveness {
  reachable: boolean
  chains: { [chainId: number]: IChainLivenessEntry }
  fetchedAtSec: number
}

interface IChainLivenessDeps {
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
      chains[chainId] = { block: { number: head, timestamp: fetchedAtSec } }
    })
  )
  return { reachable, chains, fetchedAtSec }
}
