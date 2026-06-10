import type { IRegisterToken__RegisterToken } from '@puppet/indexer-graphql/entities'
import type { Hex } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { type IIndexerClient, select } from './shared.js'

export type ITokenInfo = IRegisterToken__RegisterToken

export type ITokenRegistryMap = Map<ChainId, Map<Hex, ITokenInfo>>

export async function loadTokenRegistry(sql: IIndexerClient): Promise<ITokenRegistryMap> {
  const rows = await select(sql, 'RegisterToken__RegisterToken', { orderBy: { blockTimestamp: 'asc' } })
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

export function tokenInfoFor(registry: ITokenRegistryMap, chainId: ChainId, baseTokenId: Hex): ITokenInfo {
  const info = registry.get(chainId)?.get(baseTokenId)
  if (!info) {
    throw new CompactContractError('Intent__TokenNotRegistered', [baseTokenId])
  }
  return info
}
