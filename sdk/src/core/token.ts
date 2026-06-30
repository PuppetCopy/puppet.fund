import type { Address } from 'viem'
import { getAddress } from 'viem'
import { tokenMetaByAddress } from '../state/tokenRegistry.js'
import type { ITokenDescription } from './types.js'

export function unknownTokenDescription(token: Address): ITokenDescription {
  const short = `${token.slice(0, 6)}…${token.slice(-4)}`
  return { name: short, symbol: short, decimals: 18, address: token }
}

export function getRegisteredTokenDescription(token: Address): ITokenDescription {
  const normalizedToken = getAddress(token)
  const meta = tokenMetaByAddress.get(normalizedToken)
  if (meta) {
    // Display the token's OWN symbol (tokenKey: WETH/WMON/USDC) so a wrapped token reads distinctly from the native
    // coin; meta.symbol is the priced asset (ETH/MON) and stays on symbolByAddress for the oracle.
    return { name: meta.tokenKey, symbol: meta.tokenKey, decimals: meta.decimals, isFiat: meta.isFiat, address: normalizedToken }
  }
  return unknownTokenDescription(normalizedToken)
}
