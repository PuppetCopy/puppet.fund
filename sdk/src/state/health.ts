import { formatThrownError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'

interface IChainLivenessEntry {
  block: { number: bigint }
}

export interface IChainLiveness {
  reachable: boolean
  chains: { [chainId: number]: IChainLivenessEntry }
  failed: { [chainId: number]: string }
}

interface IChainLivenessDeps {
  chainIds: readonly ChainId[]
  chainHead(chainId: ChainId): Promise<bigint>
}

export async function fetchChainLiveness(deps: IChainLivenessDeps): Promise<IChainLiveness> {
  const chains: IChainLiveness['chains'] = {}
  const failed: IChainLiveness['failed'] = {}
  await Promise.all(
    deps.chainIds.map(chainId =>
      deps.chainHead(chainId).then(
        number => {
          chains[chainId] = { block: { number } }
        },
        (err: unknown) => {
          failed[chainId] = formatThrownError(err)
        }
      )
    )
  )
  return { reachable: Object.keys(chains).length > 0, chains, failed }
}
