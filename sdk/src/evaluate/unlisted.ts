import type { Address, PublicClient } from 'viem'
import { CompactError } from '../compact/error.js'
import { type ChainId, TOKEN_META } from '../const/index.js'
import { symbolOf, tokenMetaByChainToken, tokenMetaKey } from '../state/tokenRegistry.js'
import { UNISWAP_DEPLOYMENTS, UNISWAP_POOLS } from '../venue/uniswap/contracts.js'
import { PONS_EXIT_SAMPLES, ponsExit } from '../venue/pons/exit.js'
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
  const [exits, pons] = await Promise.all([
    pinned === undefined ? [] : uniswapPools(client, pinned, chainId, token, blockNumber).then(pools => uniswapExits(client, pinned, token, pools, amount, blockNumber)),
    ponsExit(client, chainId, token, amount, blockNumber)
  ])
  if (exits.length === 0 && pons === null) {
    throw new CompactError(
      'ASSET_NOT_PRICEABLE',
      `${token} on chain ${chainId} has no oracle feed, no Uniswap v3 pool against one that gives ${amount} both a full-size exit and a 30-minute price history, and no graduated Pons pool quoting that exit for 30 minutes`,
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
  const [exits, pons] = await Promise.all([
    uniswapPools(client, pinned, chainId, token, blockNumber).then(pools => uniswapExits(client, pinned, token, pools, amount, blockNumber)),
    ponsExit(client, chainId, token, amount, blockNumber)
  ])
  const routes = [
    ...exits.map(exit => ({ token: exit.token, amount: exit.amount, via: `Uniswap v3 ${exit.fee / 10_000}% into ${symbolOf(chainId, exit.token)}, ${TWAP_SEC / 60}-minute average` })),
    ...(pons === null
      ? []
      : [
          {
            token: pons.token,
            amount: pons.amount,
            via: `Pons pool (${pons.hookFeeBps / 100}% fee, ${pons.creatorTaxBps / 100}% creator tax) into ${symbolOf(chainId, pons.token)}, lowest of ${PONS_EXIT_SAMPLES} quotes over 30 minutes`
          }
        ])
  ]
  const valued = await Promise.all(
    routes.map(async route => {
      const symbol = symbolOf(chainId, route.token)
      const rate = await getRate(symbol, quote, freshness)
      if (rate.token1 === 0n) throw new Error(`rate ${symbol}/${quote} has a zero denominator`)
      return { value: (route.amount * rate.token0) / rate.token1, time: rate.time, via: route.via }
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
