import { PROTOCOL } from '@puppet/contracts/const'
import { CHAIN_MAP, type ChainId, VIEM_CHAINS } from '@puppet/sdk/const'
import { type ITokenRegistryMap, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { type Address, createPublicClient, custom, erc20Abi, http, isAddressEqual, type PublicClient } from 'viem'
import { publicTransports } from '../../wallet/wallet.js'

export interface ChainTokenBalance {
  chainId: ChainId
  tokenAddress: Address
  balance: bigint | null
}

export function ownBalanceFor(list: ChainTokenBalance[], chainId: ChainId, tokenAddress: Address): bigint | null {
  return list.find(b => b.chainId === chainId && isAddressEqual(b.tokenAddress, tokenAddress))?.balance ?? null
}

export function spendableBalanceFor(
  list: ChainTokenBalance[],
  chainId: ChainId,
  tokenAddress: Address
): bigint | null {
  const wnt = wrappedNativeAddressOf(chainId)
  if (!isAddressEqual(tokenAddress, PROTOCOL.nativeToken) && !isAddressEqual(tokenAddress, wnt)) {
    return ownBalanceFor(list, chainId, tokenAddress)
  }
  const native = ownBalanceFor(list, chainId, PROTOCOL.nativeToken)
  const wrapped = ownBalanceFor(list, chainId, wnt)
  if (native === null) return wrapped
  return wrapped === null ? native : native + wrapped
}

const EIP7811_TIMEOUT_MS = 3000
const WALLET_RPC_TIMEOUT_MS = 2500

const clientCache = new Map<number, PublicClient>()
function clientFor(chainId: ChainId): PublicClient {
  const cached = clientCache.get(chainId)
  if (cached) return cached
  const chain = CHAIN_MAP[chainId as keyof typeof CHAIN_MAP]
  if (!chain) throw new Error(`Unsupported source chain: ${chainId}`)
  const client = createPublicClient({
    chain,
    transport: publicTransports[chainId] ?? http(chain.rpcUrls.default.http[0], { batch: true })
  }) as PublicClient
  clientCache.set(chainId, client)
  return client
}

const readTokenBalance = (client: PublicClient, owner: Address, tokenAddress: Address): Promise<bigint> =>
  isAddressEqual(tokenAddress, PROTOCOL.nativeToken)
    ? client.getBalance({ address: owner })
    : client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })

type Eip7811Assets = Record<string, Array<{ address: Address; balance: `0x${string}`; type: 'ERC20' | 'NATIVE' }>>

type RpcRequestFn = (args: any) => Promise<unknown>

async function tryEip7811(
  request: RpcRequestFn,
  owner: Address,
  tokenByChain: Array<{ chainId: ChainId; tokenAddress: Address }>
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
        const reported = asset.type === 'NATIVE' ? PROTOCOL.nativeToken : asset.address
        const match = tokenByChain.find(t => t.chainId === chainId && isAddressEqual(t.tokenAddress, reported))
        if (!match) continue
        result.push({ chainId: match.chainId, tokenAddress: match.tokenAddress, balance: BigInt(asset.balance) })
      }
    }
    return result
  } catch {
    return null
  }
}

async function fetchViaRpc(
  owner: Address,
  tokenByChain: Array<{ chainId: ChainId; tokenAddress: Address }>
): Promise<ChainTokenBalance[]> {
  const results = await Promise.all(
    tokenByChain.map(async ({ chainId, tokenAddress }) => {
      try {
        const balance = await readTokenBalance(clientFor(chainId), owner, tokenAddress)
        return { chainId, tokenAddress, balance } satisfies ChainTokenBalance
      } catch {
        return { chainId, tokenAddress, balance: null } satisfies ChainTokenBalance
      }
    })
  )
  return results
}

async function walletChainIdOf(request: RpcRequestFn): Promise<number | null> {
  try {
    const id = Number.parseInt((await request({ method: 'eth_chainId' })) as string, 16)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

async function fetchViaWallet(
  provider: { request: RpcRequestFn },
  owner: Address,
  tokens: Array<{ chainId: ChainId; tokenAddress: Address }>,
  walletChain: number
): Promise<ChainTokenBalance[] | null> {
  const chain = CHAIN_MAP[walletChain as keyof typeof CHAIN_MAP]
  if (!chain) return null
  const client = createPublicClient({
    chain,
    transport: custom(provider),
    batch: { multicall: true }
  }) as PublicClient
  const read = Promise.all(
    tokens.map(async ({ chainId, tokenAddress }) => {
      const balance = await readTokenBalance(client, owner, tokenAddress)
      return { chainId, tokenAddress, balance } satisfies ChainTokenBalance
    })
  ).catch((): null => null)
  return Promise.race([read, new Promise<null>(resolve => setTimeout(() => resolve(null), WALLET_RPC_TIMEOUT_MS))])
}

async function fetchTokenBalances(
  owner: Address,
  tokenByChain: Array<{ chainId: ChainId; tokenAddress: Address }>,
  provider?: { request: RpcRequestFn }
): Promise<ChainTokenBalance[]> {
  const key = (chainId: ChainId, token: Address): string => `${chainId}:${token.toLowerCase()}`
  if (provider?.request) {
    const collected: ChainTokenBalance[] = []
    const covered = new Set<string>()
    const add = (list: ChainTokenBalance[]): void => {
      for (const b of list) {
        collected.push(b)
        covered.add(key(b.chainId, b.tokenAddress))
      }
    }
    const remaining = (): Array<{ chainId: ChainId; tokenAddress: Address }> =>
      tokenByChain.filter(t => !covered.has(key(t.chainId, t.tokenAddress)))

    const via7811 = await Promise.race([
      tryEip7811(provider.request, owner, tokenByChain),
      new Promise<ChainTokenBalance[] | null>(resolve => setTimeout(() => resolve(null), EIP7811_TIMEOUT_MS))
    ])
    if (via7811) add(via7811)

    let missing = remaining()
    if (missing.length > 0) {
      const walletChain = await walletChainIdOf(provider.request)
      if (walletChain !== null) {
        const onWalletChain = missing.filter(t => t.chainId === walletChain)
        if (onWalletChain.length > 0) {
          const viaWallet = await fetchViaWallet(provider, owner, onWalletChain, walletChain)
          if (viaWallet) add(viaWallet)
          missing = remaining()
        }
      }
    }

    if (missing.length > 0) add(await fetchViaRpc(owner, missing))
    return collected
  }
  return fetchViaRpc(owner, tokenByChain)
}

export async function walletBalancesQuery(
  registry: ITokenRegistryMap,
  owner: Address,
  provider?: { request: RpcRequestFn }
): Promise<ChainTokenBalance[]> {
  const pairs = VIEM_CHAINS.flatMap(chain => {
    const chainMap = registry.get(chain.id)
    if (!chainMap) return []
    return [...chainMap.values()].flatMap(info => {
      if (isAddressEqual(info.token, PROTOCOL.nativeToken)) return []
      return isAddressEqual(info.token, wrappedNativeAddressOf(chain.id))
        ? [
            { chainId: chain.id, tokenAddress: PROTOCOL.nativeToken },
            { chainId: chain.id, tokenAddress: info.token }
          ]
        : [{ chainId: chain.id, tokenAddress: info.token }]
    })
  })
  return fetchTokenBalances(owner, pairs, provider)
}
