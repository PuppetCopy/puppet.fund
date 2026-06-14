import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import type { IRegisterToken__RegisterToken } from '@puppet/indexer-graphql/entities'
import { type Address, type Hex, zeroHash } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { type IIndexerClient, select } from './shared.js'

export type ITokenInfo = IRegisterToken__RegisterToken

export type ITokenRegistryMap = Map<ChainId, Map<Hex, ITokenInfo>>

export async function loadTokenRegistry(sql: IIndexerClient): Promise<ITokenRegistryMap> {
  return tokenRegistryFromRows(
    await select(sql, 'RegisterToken__RegisterToken', { orderBy: { blockTimestamp: 'asc' } })
  )
}

export function tokenRegistryFromRows(rows: readonly ITokenInfo[]): ITokenRegistryMap {
  const registry: ITokenRegistryMap = new Map()
  for (const row of rows) {
    const chainId = Number(row.chainId) as ChainId
    let chainMap = registry.get(chainId)
    if (!chainMap) {
      chainMap = new Map<Hex, ITokenInfo>()
      registry.set(chainId, chainMap)
    }
    chainMap.set(row.tokenId, row)
  }
  return registry
}

export function tokenRegistryRows(registry: ITokenRegistryMap): ITokenInfo[] {
  return [...registry.values()].flatMap(chainMap => [...chainMap.values()])
}

// Offline fallback when no live registry was handed over (headless operator, wallet
// before its first handshake): the protocol's known tokens from the generated const
// map, with cap 0 (uncapped client-side — the matchmaker still enforces live caps;
// a capped intent surfaces as a silent rejection instead of a local error).
export function staticTokenRegistry(): ITokenRegistryMap {
  const rows: ITokenInfo[] = []
  for (const [chainId, tokens] of Object.entries(CHAIN_TOKEN_MAP)) {
    for (const [symbol, token] of Object.entries(tokens)) {
      rows.push({
        id: `${chainId}:${symbol}`,
        chainId: BigInt(chainId),
        tokenId: TOKEN_ID[symbol as keyof typeof TOKEN_ID],
        token: token as Address,
        cap: 0n,
        // Native mirrors the on-chain row: hubToken is the hub WETH wrap, never address 0.
        hubToken:
          symbol === 'ETH'
            ? CHAIN_TOKEN_MAP[HUB_CHAIN_ID].WETH
            : CHAIN_TOKEN_MAP[HUB_CHAIN_ID][symbol as keyof (typeof CHAIN_TOKEN_MAP)[typeof HUB_CHAIN_ID]],
        blockTimestamp: 0,
        blockNumber: 0n,
        logIndex: 0,
        transactionHash: zeroHash
      })
    }
  }
  return tokenRegistryFromRows(rows)
}

export function tokenIdForToken(registry: ITokenRegistryMap, chainId: ChainId, token: Address): Hex {
  for (const [tokenId, info] of registry.get(chainId) ?? []) {
    if (info.token.toLowerCase() === token.toLowerCase()) return tokenId
  }
  throw new CompactContractError('Intent__TokenNotRegistered', [token as Hex])
}

export function tokenInfoFor(registry: ITokenRegistryMap, chainId: ChainId, baseTokenId: Hex): ITokenInfo {
  const info = registry.get(chainId)?.get(baseTokenId)
  if (!info) {
    throw new CompactContractError('Intent__TokenNotRegistered', [baseTokenId])
  }
  return info
}
