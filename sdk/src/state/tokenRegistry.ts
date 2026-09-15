import { CHAIN_META, CHAIN_TOKEN_MAP, HUB_CHAIN_ID, PROTOCOL, TOKEN_META } from '@puppet/contracts/const'
import { type Address, getAddress, type Hex, isAddressEqual, } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { ttlCached } from './cache.js'

export const TOKEN_REGISTRY_TTL_MS = 6 * 60 * 60 * 1000

export const cachedTokenRegistry = (
  readRows: () => Promise<readonly ITokenRegistry[]>
): (() => Promise<ITokenRegistryMap>) => ttlCached(async () => tokenRegistryFromRows(await readRows()), TOKEN_REGISTRY_TTL_MS)

export interface ITokenRegistry {
  id: string
  chainId: bigint
  token: Address
  registeredCap: bigint
  tokenId: Hex
}

export type ITokenRegistryMap = Map<ChainId, Map<Address, ITokenRegistry>>

export function tokenRegistryFromRows(rows: readonly ITokenRegistry[]): ITokenRegistryMap {
  const registry: ITokenRegistryMap = new Map()
  for (const row of rows) {
    const chainId = Number(row.chainId) as ChainId
    let chainMap = registry.get(chainId)
    if (!chainMap) {
      chainMap = new Map<Address, ITokenRegistry>()
      registry.set(chainId, chainMap)
    }
    chainMap.set(getAddress(row.token), row)
  }
  return registry
}

export function tokenRegistryRows(registry: ITokenRegistryMap): ITokenRegistry[] {
  return [...registry.values()].flatMap(chainMap => [...chainMap.values()])
}

export function candidateTokens(): Map<ChainId, Address[]> {
  const byChain = new Map<ChainId, Address[]>()
  for (const [chainId, tokens] of Object.entries(CHAIN_TOKEN_MAP)) {
    byChain.set(Number(chainId) as ChainId, Object.values(tokens) as Address[])
  }
  return byChain
}

export type ITokenMeta = (typeof TOKEN_META)[keyof typeof TOKEN_META] & { address: Address; tokenKey: string }

export type ITokenMetaKey = `${ChainId}:${Address}`

export const tokenMetaKey = (chainId: ChainId, token: Address): ITokenMetaKey => `${chainId}:${getAddress(token)}`

export const tokenMetaByChainToken: Map<ITokenMetaKey, ITokenMeta> = (() => {
  const map = new Map<ITokenMetaKey, ITokenMeta>()
  for (const [chain, tokens] of Object.entries(CHAIN_TOKEN_MAP)) {
    const chainId = Number(chain) as ChainId
    for (const [symbol, address] of Object.entries(tokens)) {
      const meta = TOKEN_META[symbol as keyof typeof TOKEN_META]
      if (!meta) continue
      const key = getAddress(address as Address)
      map.set(tokenMetaKey(chainId, key), { ...meta, address: key, tokenKey: symbol })
    }
  }
  return map
})()

export function tokenMetaOf(chainId: ChainId, token: Address): ITokenMeta {
  const meta = tokenMetaByChainToken.get(tokenMetaKey(chainId, token))
  if (!meta) throw new CompactContractError('Intent__TokenNotValuable', [token as Hex])
  return meta
}

export function symbolOf(chainId: ChainId, token: Address): string {
  return tokenMetaOf(chainId, token).symbol
}

export function tokenKeyOf(chainId: ChainId, token: Address): string {
  return tokenMetaOf(chainId, token).tokenKey
}

export function symbolOfKey(tokenKey: string): string {
  const meta = TOKEN_META[tokenKey as keyof typeof TOKEN_META]
  if (!meta) throw new Error(`token key ${tokenKey} has no meta`)
  return meta.symbol
}

export function chainTokenOfKey(chainId: ChainId, tokenKey: string): Address {
  const address = (CHAIN_TOKEN_MAP[chainId] as Record<string, string>)[tokenKey]
  if (address === undefined) throw new Error(`chain ${chainId} has no token ${tokenKey}`)
  return getAddress(address)
}

export function bondTokenOf(chainId: ChainId): Address {
  return chainTokenOfKey(chainId, PROTOCOL.bondToken)
}

export function isProtocolBase(token: Address): boolean {
  return (PROTOCOL.BASE_TOKEN as readonly string[]).includes(tokenKeyOf(HUB_CHAIN_ID, token))
}

export function nativeSymbolOf(chainId: ChainId): string {
  return CHAIN_META[chainId].nativeSymbol
}

export function nativePrecisionOf(chainId: ChainId): bigint {
  return 10n ** BigInt(TOKEN_META[nativeSymbolOf(chainId) as keyof typeof TOKEN_META].decimals)
}

export function wrappedNativeAddressOf(chainId: ChainId): Address {
  return chainTokenOfKey(chainId, CHAIN_META[chainId].wnt)
}

export function providerToken(token: Address, chainId: number): Address {
  return getAddress(isAddressEqual(token, PROTOCOL.nativeToken) ? wrappedNativeAddressOf(chainId as ChainId) : token)
}

export function tokenInfoFor(registry: ITokenRegistryMap, chainId: ChainId, token: Address): ITokenRegistry {
  const info = registry.get(chainId)?.get(getAddress(token))
  if (!info) {
    throw new CompactContractError('Intent__TokenNotValuable', [token as Hex])
  }
  return info
}

export function registeredTokenAddresses(registry: ITokenRegistryMap, chainId: ChainId): Address[] {
  const chainMap = registry.get(chainId)
  if (!chainMap) throw new Error(`token registry has no chain ${chainId}`)
  return [...chainMap.values()].map(info => getAddress(info.token))
}

export function listedTokenAddresses(registry: ITokenRegistryMap, chainId: ChainId, baseTokenIdList: readonly Hex[]): Address[] {
  const chainMap = registry.get(chainId)
  if (!chainMap) throw new Error(`token registry has no chain ${chainId}`)
  return [...chainMap.values()].filter(info => baseTokenIdList.includes(info.tokenId)).map(info => getAddress(info.token))
}

export function custodyTokenAddresses(chainId: ChainId): Address[] {
  return Object.values(CHAIN_TOKEN_MAP[chainId] as Record<string, string>).map(t => getAddress(t))
}

export function chainBaseToken(fromChainId: ChainId, baseToken: Address, toChainId: ChainId): Address {
  const key = tokenKeyOf(fromChainId, baseToken)
  return symbolOfKey(key) === nativeSymbolOf(toChainId) ? PROTOCOL.nativeToken : chainTokenOfKey(toChainId, key)
}
