import { type Address, encodeFunctionData, erc20Abi, type Hex, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import { decodeErc20 } from './erc20.js'
import { gmxVenue } from './gmx/screen.js'
import { hyperliquidVenue } from './hyperliquid/screen.js'
import type { IVenue } from './types.js'

export const VENUES: readonly IVenue[] = [gmxVenue, hyperliquidVenue]

export const venueSpenders = (chainId: ChainId): readonly Address[] =>
  VENUES.flatMap(venue =>
    venue.contracts.filter(contract => contract.pullsTokens === true && contract.chainId === chainId).map(contract => contract.address)
  )

export function withCappedAllowance(chainId: ChainId, callData: Hex, cap: bigint): Hex {
  const dec = decodeErc20(callData)
  if (dec?.functionName !== 'approve') return callData
  const [spender, amount] = dec.args as readonly [Address, bigint]
  if (!venueSpenders(chainId).some(s => isAddressEqual(s, spender)) || amount <= cap || cap <= 0n) return callData
  return encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, cap] })
}
