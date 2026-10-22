import type { Address, PublicClient } from 'viem'
import { CompactError } from '../compact/error.js'
import { type ChainId, TOKEN_META } from '../const/index.js'
import { symbolOf, tokenMetaByChainToken, tokenMetaKey } from '../state/tokenRegistry.js'
import { UNISWAP_DEPLOYMENTS, UNISWAP_POOLS } from '../venue/uniswap/contracts.js'
import { TWAP_SEC, uniswapExits, uniswapPools } from '../venue/uniswap/exit.js'
import { DEFAULT_EVALUATION_CONFIG, type IGetRate } from './types.js'

export interface IUnlistedValue {
  value: bigint
  time: number
  via: string
}

export async function verifyPriceable(clients: Readonly<Record<number, PublicClient>>, chainId: ChainId, token: Address, amount: bigint): Promise<void> {
  if (tokenMetaByChainToken.has(tokenMetaKey(chainId, token))) return
  const client = clients[chainId]
  if (client === undefined) throw new CompactError('CHAIN_UNAVAILABLE', `no client for chain ${chainId} to quote the exit of ${token}`, 'server')
  const pinned = UNISWAP_POOLS[chainId]
  const blockNumber = await client.getBlockNumber()
  const exits = pinned === undefined ? [] : await uniswapExits(client, pinned, token, await uniswapPools(client, pinned, chainId, token, blockNumber), amount, blockNumber)
  if (exits.length === 0) {
    throw new CompactError(
      'ASSET_NOT_PRICEABLE',
      `${token} on chain ${chainId} has no oracle feed and no Uniswap v3 pool against one gives ${amount} both a full-size exit and a 30-minute price history`,
      'hard'
    )
  }
}

export function verifyExitable(chainId: ChainId, token: Address): void {
  if (tokenMetaByChainToken.has(tokenMetaKey(chainId, token)) || UNISWAP_DEPLOYMENTS[chainId] !== undefined) return
  throw new CompactError(
    'ASSET_NOT_EXITABLE',
    `${token} is not a registered token on chain ${chainId}, and no screened route on that chain can sell it back, so the account may not acquire it there`,
    'hard'
  )
}

export async function valueUnlisted(
  client: PublicClient,
  chainId: ChainId,
  token: Address,
  amount: bigint,
  blockNumber: bigint,
  getRate: IGetRate,
  quote: string,
  freshness: number
): Promise<IUnlistedValue | null> {
  const pinned = UNISWAP_POOLS[chainId]
  if (pinned === undefined) return null
  const exits = await uniswapExits(client, pinned, token, await uniswapPools(client, pinned, chainId, token, blockNumber), amount, blockNumber)
  const valued = await Promise.all(
    exits.map(async exit => {
      const symbol = symbolOf(chainId, exit.token)
      const rate = await getRate(symbol, quote, freshness)
      if (rate.token1 === 0n) throw new Error(`rate ${symbol}/${quote} has a zero denominator`)
      return {
        value: (exit.amount * rate.token0) / rate.token1,
        time: rate.time,
        via: `Uniswap v3 ${exit.fee / 10_000}% into ${symbol}, ${TWAP_SEC / 60}-minute average`
      }
    })
  )
  return valued.reduce<IUnlistedValue | null>((best, exit) => (best === null || exit.value > best.value ? exit : best), null)
}

export async function wethValueOf(getRate: IGetRate, client: PublicClient, chainId: ChainId, blockNumber: bigint, token: Address, amount: bigint): Promise<{ value: bigint; time: number } | null> {
  const freshness = DEFAULT_EVALUATION_CONFIG.maxPriceAgeSec * 1000
  if (tokenMetaByChainToken.has(tokenMetaKey(chainId, token))) {
    const rate = await getRate(symbolOf(chainId, token), TOKEN_META.WETH.symbol, freshness)
    return { value: (amount * rate.token0) / rate.token1, time: rate.time }
  }
  const exit = await valueUnlisted(client, chainId, token, amount, blockNumber, getRate, TOKEN_META.WETH.symbol, freshness)
  return exit === null ? null : { value: exit.value, time: exit.time }
}
