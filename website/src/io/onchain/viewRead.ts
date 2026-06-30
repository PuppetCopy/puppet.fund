import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { type Abi, type Address, decodeFunctionResult, encodeFunctionData, getAddress, type Hex } from 'viem'
import { publicClientMap } from '../../wallet/wallet.js'

// Self-state reads route through the service worker's same-origin `/api/view` GET cache: the URL (net + to + calldata)
// IS the cache key, so the SW serves it cache-first and a per-URL `refresh` busts exactly one view. The SW does the
// eth_call/eth_getCode dispatch (user RPC -> /api/rpc fallback), so the matchmaker is never in the read path. When no
// SW controls the page (dev, first load, before activation) we fall back to a plain viem read on the same client.
const swActive = (): boolean =>
  typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null

// The connected wallet whose self-state is cached together. One wallet owns one PA and many FAs, so all of its self
// views (`&w=<wallet>`) share one per-wallet SW cache bucket and switching wallets evicts the previous owner's bucket.
// Pure cache-namespacing: it never affects a read's RESULT, so it stays ambient here instead of threading through the
// lean read functions. null/global reads land in the shared bucket.
let cacheOwner: Address | null = null
export function setViewCacheOwner(owner: Address | null): void {
  const next = owner ? getAddress(owner) : null
  if (next === cacheOwner) return
  const previous = cacheOwner
  cacheOwner = next
  if (previous && swActive()) {
    navigator.serviceWorker.controller?.postMessage({ type: 'evict-view-owner', owner: previous })
  }
}

const ownerParam = (global?: boolean): string => (!global && cacheOwner ? `&w=${cacheOwner}` : '')

interface IViewCall {
  chainId: ChainId
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  refresh?: boolean
  // Deterministic / registry-wide state (same for every wallet): cache once in the shared bucket, not per-owner.
  global?: boolean
}

export async function viewCall(req: IViewCall): Promise<unknown> {
  if (!swActive()) {
    return publicClientMap[req.chainId].readContract({
      address: req.address,
      abi: req.abi,
      functionName: req.functionName,
      args: req.args as readonly unknown[]
    })
  }
  const data = encodeFunctionData({ abi: req.abi, functionName: req.functionName, args: req.args })
  const url = `/api/view?net=${CHAIN_NETWORK_MAP[req.chainId]}&to=${req.address}&data=${data}${ownerParam(req.global)}${req.refresh ? '&refresh=true' : ''}`
  const body = (await (await fetch(url)).json()) as { result?: Hex; error?: string }
  if (body.error !== undefined || body.result === undefined) throw new Error(body.error ?? 'view read failed')
  return decodeFunctionResult({ abi: req.abi, functionName: req.functionName, data: body.result })
}

// eth_getCode for `address`, through the same SW view-cache (m=code). Distinguishes a definitely-undeployed account
// (result '0x' / undefined) from a transient read failure (throws) — the caller treats the former as a provable empty
// state, the latter must NOT be swallowed. Pass refresh at submit so a step that just deployed the account isn't read
// from a stale not-deployed cache entry.
export async function viewCode(chainId: ChainId, address: Address, refresh?: boolean): Promise<Hex | undefined> {
  if (!swActive()) return publicClientMap[chainId].getCode({ address })
  const url = `/api/view?net=${CHAIN_NETWORK_MAP[chainId]}&to=${address}&m=code${ownerParam()}${refresh ? '&refresh=true' : ''}`
  const body = (await (await fetch(url)).json()) as { result?: Hex; error?: string }
  if (body.error !== undefined || body.result === undefined) throw new Error(body.error ?? 'view code read failed')
  return body.result
}
