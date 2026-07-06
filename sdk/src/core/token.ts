import { PROTOCOL, TOKEN_META } from '@puppet/contracts/const'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import type { ChainId } from '../const/index.js'
import { nativeSymbolOf, tokenMetaByAddress } from '../state/tokenRegistry.js'
import type { ITokenDescription } from './types.js'

// The native gas-asset marker (EIP-7528) is the SAME address on every chain, so any address-keyed lookup
// (tokenMetaByAddress/symbolByAddress) resolves it to whichever chain wrote last in the const map (= ETH), not the
// chain it actually belongs to. Detect it explicitly and resolve symbol/decimals per-chain via nativeSymbolOf instead.
export const NATIVE_TOKEN = getAddress(PROTOCOL.nativeToken)

export function isNativeToken(token: Address): boolean {
  return getAddress(token) === NATIVE_TOKEN
}

export function unknownTokenDescription(token: Address): ITokenDescription {
  const short = `${token.slice(0, 6)}…${token.slice(-4)}`
  return { name: short, symbol: short, decimals: 18, address: token }
}

// Chain-aware token description: identical to getRegisteredTokenDescription for ERC-20s, but resolves the native marker
// to the chain's native asset (Monad -> MON, not the address-keyed ETH). Use this wherever a balance/transfer carries a
// chainId and the token can be native.
export function getChainTokenDescription(chainId: ChainId, token: Address): ITokenDescription {
  const address = getAddress(token)
  if (address === NATIVE_TOKEN) {
    const symbol = nativeSymbolOf(chainId)
    const meta = TOKEN_META[symbol as keyof typeof TOKEN_META]
    return { name: symbol, symbol, decimals: meta.decimals, isFiat: meta.isFiat, address }
  }
  return getRegisteredTokenDescription(address)
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
