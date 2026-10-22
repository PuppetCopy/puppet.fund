import type { Address } from 'viem'
import type { ChainId } from '../const/index.js'
import { tokenMetaByChainToken, tokenMetaKey } from '../state/tokenRegistry.js'

const MIN_FUNDED_BY_TOKEN_KEY: Record<string, bigint> = {
  USDC: 1_000_000n,
  USDCE: 1_000_000n,
  USDT: 1_000_000n,
  ETH: 400_000_000_000_000n,
  WETH: 400_000_000_000_000n,
  POL: 4_000_000_000_000_000_000n,
  WPOL: 4_000_000_000_000_000_000n
}

export function fundingFloorOf(chainId: ChainId, token: Address): bigint | null {
  const meta = tokenMetaByChainToken.get(tokenMetaKey(chainId, token))
  return meta === undefined ? null : (MIN_FUNDED_BY_TOKEN_KEY[meta.tokenKey] ?? null)
}

export function minFundedAmount(chainId: ChainId, token: Address): bigint {
  const floor = fundingFloorOf(chainId, token)
  if (floor === null) throw new Error(`${token} on chain ${chainId} has no funding minimum; add one before registering it as a funding token`)
  return floor
}
