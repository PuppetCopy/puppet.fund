import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { type Abi, type Address, decodeFunctionResult, encodeFunctionData, getAddress, type Hex } from 'viem'
import { EVICT_VIEW_OWNER, viewUrl } from '../../app/swCache.js'
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
    navigator.serviceWorker.controller?.postMessage({ type: EVICT_VIEW_OWNER, owner: previous })
  }
}

// The owner bucket a read lands in: null for global/deterministic reads (shared bucket), else the connected wallet.
const readOwner = (global?: boolean): Address | null => (global ? null : cacheOwner)

interface IViewCall {
  chainId: ChainId
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  refresh?: boolean
  // Deterministic / registry-wide state (same for every wallet): cache once in the shared bucket, not per-owner.
  global?: boolean
  // Pin the read AT this block (settlement floor): a node lagging behind it fails loud instead of answering with —
  // and caching — pre-settlement state. Implies refresh; the result still lands on the un-pinned cache key.
  minBlock?: bigint
}

export async function viewCall(req: IViewCall): Promise<unknown> {
  if (!swActive()) {
    return publicClientMap[req.chainId].readContract({
      address: req.address,
      abi: req.abi,
      functionName: req.functionName,
      args: req.args as readonly unknown[],
      ...(req.minBlock !== undefined ? { blockNumber: req.minBlock } : {})
    })
  }
  const data = encodeFunctionData({ abi: req.abi, functionName: req.functionName, args: req.args })
  const url = viewUrl({
    net: CHAIN_NETWORK_MAP[req.chainId],
    to: req.address,
    data,
    owner: readOwner(req.global),
    refresh: req.refresh,
    block: req.minBlock !== undefined ? `0x${req.minBlock.toString(16)}` : undefined
  })
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
  const url = viewUrl({ net: CHAIN_NETWORK_MAP[chainId], to: address, code: true, owner: readOwner(), refresh })
  const body = (await (await fetch(url)).json()) as { result?: Hex; error?: string }
  if (body.error !== undefined || body.result === undefined) throw new Error(body.error ?? 'view code read failed')
  return body.result
}
