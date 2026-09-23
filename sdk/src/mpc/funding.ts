import type { Address } from 'viem'
import type { ChainId } from '../const/index.js'
import { tokenKeyOf } from '../state/tokenRegistry.js'

const MIN_FUNDED_BY_TOKEN_KEY: Record<string, bigint> = {
  USDC: 1_000_000n,
  USDT: 1_000_000n,
  ETH: 400_000_000_000_000n,
  WETH: 400_000_000_000_000n,
  POL: 4_000_000_000_000_000_000n,
  WPOL: 4_000_000_000_000_000_000n
}

export function minFundedAmount(chainId: ChainId, token: Address): bigint {
  const key = tokenKeyOf(chainId, token)
  const min = MIN_FUNDED_BY_TOKEN_KEY[key]
  if (min === undefined) throw new Error(`${key} has no funding minimum; add one before registering it as a funding token`)
  return min
}
