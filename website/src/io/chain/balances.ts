import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import { ADDRESS_ZERO, CHAIN_MAP } from '@puppet/sdk/const'
import { type Address, createPublicClient, erc20Abi, http, isAddressEqual, type PublicClient } from 'viem'

export interface ChainTokenBalance {
  chainId: number
  tokenAddress: Address
  balance: bigint
}

const EIP7811_TIMEOUT_MS = 3000

const clientCache = new Map<number, PublicClient>()
function clientFor(chainId: number): PublicClient {
  const cached = clientCache.get(chainId)
  if (cached) return cached
  const chain = CHAIN_MAP[chainId as keyof typeof CHAIN_MAP]
  if (!chain) throw new Error(`Unsupported source chain: ${chainId}`)
  const network = CHAIN_NETWORK_MAP[chainId as keyof typeof CHAIN_NETWORK_MAP]
  const proxyUrl = network ? `/api/rpc?network=${network}` : null
  const client = createPublicClient({
    chain,
    transport: http(proxyUrl ?? chain.rpcUrls.default.http[0], { batch: true })
  }) as PublicClient
  clientCache.set(chainId, client)
  return client
}

type Eip7811Assets = Record<string, Array<{ address: Address; balance: `0x${string}`; type: 'ERC20' | 'NATIVE' }>>

// Loosely typed to accept viem walletClient, window.ethereum, or any EIP-1193
// provider. EIP-7811's wallet_getAssets isn't in viem's typed RPC surface, so
// we bypass the typed-method constraint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcRequestFn = (args: any) => Promise<unknown>

async function tryEip7811(
  request: RpcRequestFn,
  owner: Address,
  tokenByChain: Array<{ chainId: number; tokenAddress: Address }>
): Promise<ChainTokenBalance[] | null> {
  try {
    const chainIdsHex = [...new Set(tokenByChain.map(t => `0x${t.chainId.toString(16)}`))]
    const res = (await request({
      method: 'wallet_getAssets',
      params: [{ account: owner, chains: chainIdsHex }]
    })) as Eip7811Assets

    const result: ChainTokenBalance[] = []
    for (const [chainIdHex, assets] of Object.entries(res)) {
      const chainId = Number.parseInt(chainIdHex, 16)
      for (const asset of assets) {
        const match = tokenByChain.find(t => t.chainId === chainId && isAddressEqual(t.tokenAddress, asset.address))
        if (!match) continue
        result.push({ chainId, tokenAddress: match.tokenAddress, balance: BigInt(asset.balance) })
      }
    }
    return result
  } catch {
    return null
  }
}

async function fetchViaRpc(
  owner: Address,
  tokenByChain: Array<{ chainId: number; tokenAddress: Address }>
): Promise<ChainTokenBalance[]> {
  const results = await Promise.all(
    tokenByChain.map(async ({ chainId, tokenAddress }) => {
      try {
        const client = clientFor(chainId)
        const balance =
          tokenAddress === ADDRESS_ZERO
            ? await client.getBalance({ address: owner })
            : await client.readContract({
                address: tokenAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [owner]
              })
        return { chainId, tokenAddress, balance } satisfies ChainTokenBalance
      } catch {
        return { chainId, tokenAddress, balance: 0n } satisfies ChainTokenBalance
      }
    })
  )
  return results
}

export async function fetchTokenBalances(
  owner: Address,
  tokenByChain: Array<{ chainId: number; tokenAddress: Address }>,
  provider?: { request: RpcRequestFn }
): Promise<ChainTokenBalance[]> {
  if (provider?.request) {
    const via = await Promise.race([
      tryEip7811(provider.request, owner, tokenByChain),
      new Promise<ChainTokenBalance[] | null>(resolve => setTimeout(() => resolve(null), EIP7811_TIMEOUT_MS))
    ])
    if (via) {
      const key = (chainId: number, token: Address): string => `${chainId}:${token.toLowerCase()}`
      const covered = new Set(via.map(b => key(b.chainId, b.tokenAddress)))
      const missing = tokenByChain.filter(t => !covered.has(key(t.chainId, t.tokenAddress)))
      return missing.length === 0 ? via : [...via, ...(await fetchViaRpc(owner, missing))]
    }
  }
  return fetchViaRpc(owner, tokenByChain)
}
