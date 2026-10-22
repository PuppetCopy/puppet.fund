import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { CompactError } from '../compact/error.js'
import { CHAIN_TOKEN_MAP, type ChainId, TOKEN_META, WRAPPED_NATIVE } from '../const/index.js'

export function listedTokensOf(chainId: ChainId): Address[] {
  return (Object.values(CHAIN_TOKEN_MAP[chainId]) as Address[]).map(token => getAddress(token))
}

type ITokenMeta = (typeof TOKEN_META)[keyof typeof TOKEN_META] & { address: Address; tokenKey: string }

export type ITokenMetaKey = `${ChainId}:${Address}`

export const tokenMetaKey = (chainId: ChainId, token: Address): ITokenMetaKey => `${chainId}:${getAddress(token)}`

export const tokenMetaByChainToken: Map<ITokenMetaKey, ITokenMeta> = (() => {
  const map = new Map<ITokenMetaKey, ITokenMeta>()
  for (const [chain, tokens] of Object.entries(CHAIN_TOKEN_MAP)) {
    const chainId = Number(chain) as ChainId
    for (const [symbol, address] of Object.entries(tokens)) {
      const meta = TOKEN_META[symbol as keyof typeof TOKEN_META]
      if (!meta) continue
      const key = getAddress(address as Address)
      map.set(tokenMetaKey(chainId, key), { ...meta, address: key, tokenKey: symbol })
    }
  }
  return map
})()

export function tokenMetaOf(chainId: ChainId, token: Address): ITokenMeta {
  const meta = tokenMetaByChainToken.get(tokenMetaKey(chainId, token))
  if (!meta) throw new CompactError('TOKEN_UNREGISTERED', `${token} on chain ${chainId} is not a token the protocol lists`, 'hard')
  return meta
}

export function symbolOf(chainId: ChainId, token: Address): string {
  return tokenMetaOf(chainId, token).symbol
}

export function tokenKeyOf(chainId: ChainId, token: Address): string {
  return tokenMetaOf(chainId, token).tokenKey
}

export function chainTokenOfKey(chainId: ChainId, tokenKey: string): Address {
  const address = (CHAIN_TOKEN_MAP[chainId] as Record<string, string>)[tokenKey]
  if (address === undefined) throw new Error(`chain ${chainId} has no token ${tokenKey}`)
  return getAddress(address)
}

export function nativeSymbolOf(chainId: ChainId): string {
  return TOKEN_META[WRAPPED_NATIVE[chainId]].symbol
}

export function nativePrecisionOf(chainId: ChainId): bigint {
  return 10n ** BigInt(TOKEN_META[nativeSymbolOf(chainId) as keyof typeof TOKEN_META].decimals)
}

export function wrappedNativeAddressOf(chainId: ChainId): Address {
  return chainTokenOfKey(chainId, WRAPPED_NATIVE[chainId])
}

export function providerToken(token: Address, chainId: number): Address {
  return getAddress(isAddressEqual(token, PROTOCOL.nativeToken) ? wrappedNativeAddressOf(chainId as ChainId) : token)
}
