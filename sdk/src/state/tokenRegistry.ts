import { CHAIN_META, CHAIN_TOKEN_MAP, TOKEN_META } from '@puppet/contracts/const'
import { type Address, getAddress, type Hex } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { ITokenRegistry } from '../schema/index.js'
import { ttlCached } from './cache.js'

const TOKEN_REGISTRY_TTL_MS = 6 * 60 * 60 * 1000

// Shared default for every app's context: read all TokenRegistry rows from the local datastore (logstore store.all
// or matchmaker-reads client.select) and fold them, cached for 6h. Only the row reader differs per app.
export const cachedTokenRegistry = (
  readRows: () => Promise<readonly ITokenRegistry[]>
): (() => Promise<ITokenRegistryMap>) => ttlCached(async () => tokenRegistryFromRows(await readRows()), TOKEN_REGISTRY_TTL_MS)

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

// Offline fallback when no live registry was handed over (headless operator, wallet
// before its first handshake): the protocol's known tokens from the generated const
// map, with cap 0 (uncapped client-side — the matchmaker still enforces live caps;
// a capped intent surfaces as a silent rejection instead of a local error).
export function staticTokenRegistry(): ITokenRegistryMap {
  const rows: ITokenRegistry[] = []
  for (const [chainId, tokens] of Object.entries(CHAIN_TOKEN_MAP)) {
    for (const token of Object.values(tokens)) {
      rows.push({
        id: `${chainId}:${token}`,
        chainId: BigInt(chainId),
        token: token as Address,
        cap: 0n
      })
    }
  }
  return tokenRegistryFromRows(rows)
}

// The token's generated metadata ({ symbol, decimals, isFiat } from TOKEN_META) plus the per-chain address. Derived
// from the generated const so decimals/isFiat/symbol can never drift from the source. `tokenKey` is the TOKEN_ADDRESS
// key = the token's OWN symbol (WETH, WMON, USDC), distinct from `symbol` = the priced ASSET (WETH/WMON -> ETH/MON):
// display uses tokenKey so a wrapped token isn't confused with the native coin; pricing uses symbol.
export type ITokenMeta = (typeof TOKEN_META)[keyof typeof TOKEN_META] & { address: Address; tokenKey: string }

export const tokenMetaByAddress: Map<Address, ITokenMeta> = (() => {
  const map = new Map<Address, ITokenMeta>()
  for (const tokens of Object.values(CHAIN_TOKEN_MAP)) {
    for (const [symbol, address] of Object.entries(tokens)) {
      const meta = TOKEN_META[symbol as keyof typeof TOKEN_META]
      if (!meta) continue
      const key = getAddress(address as Address)
      map.set(key, { ...meta, address: key, tokenKey: symbol })
    }
  }
  return map
})()

// Chain-agnostic canonical asset SYMBOL for any registered token address, off the static const map (WETH and ETH both
// -> 'ETH'). The rate API is symbol-keyed, so consumers holding an ADDRESS resolve it here before pricing. Throws if
// the token isn't registered.
export function symbolByAddress(token: Address): string {
  const meta = tokenMetaByAddress.get(getAddress(token))
  if (!meta) throw new CompactContractError('Intent__TokenNotRegistered', [token as Hex])
  return meta.symbol
}

// The native gas asset's CEX symbol for a chain (Monad -> MON, ETH-native chains -> ETH). The native marker
// (PROTOCOL.nativeToken) is the SAME address on every chain, so tokenMetaByAddress/symbolByAddress can't tell
// MON from ETH; resolve the native asset's symbol per-chain through here instead.
export function nativeSymbolOf(chainId: ChainId): string {
  return CHAIN_META[chainId].nativeSymbol
}

// 10^(native decimals) for a chain, off the generated meta (CHAIN_META.nativeSymbol -> TOKEN_META.decimals). This is the
// fixed-point scale of a native->token rate AND one whole native in its base units; both the rate producer and the relay
// fee formula divide by it, so it must NOT assume 18 (a non-18-decimal native chain would otherwise misprice fees).
export function nativePrecisionOf(chainId: ChainId): bigint {
  return 10n ** BigInt(TOKEN_META[nativeSymbolOf(chainId) as keyof typeof TOKEN_META].decimals)
}

// The chain's wrapped-native ERC-20 ADDRESS (WMON/WETH). Native deposits route through this (the raw native marker
// isn't an ERC-20); resolved from the generated const (CHAIN_META.wnt names the TOKEN_ADDRESS key).
export function wrappedNativeAddressOf(chainId: ChainId): Address {
  return getAddress((CHAIN_TOKEN_MAP[chainId] as Record<string, string>)[CHAIN_META[chainId].wnt] as Address)
}

export function tokenInfoFor(registry: ITokenRegistryMap, chainId: ChainId, token: Address): ITokenRegistry {
  const info = registry.get(chainId)?.get(getAddress(token))
  if (!info) {
    throw new CompactContractError('Intent__TokenNotRegistered', [token as Hex])
  }
  return info
}

// Every registered token address on a chain, checksummed. The venue screen uses this to admit
// any registered token as GMX collateral (not just the fund's base), since a registered token
// is one NAV can value and the order receiver is pinned to the fund.
export function registeredTokenAddresses(registry: ITokenRegistryMap, chainId: ChainId): Address[] {
  return [...(registry.get(chainId)?.values() ?? [])].map(info => getAddress(info.token))
}
