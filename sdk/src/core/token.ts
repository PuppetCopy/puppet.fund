import { PROTOCOL } from '@puppet/contracts/const'
import type { Address } from 'viem'
import { getAddress, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import { tokenMetaOf } from '../state/tokenRegistry.js'
import type { ITokenDescription } from './types.js'

const NATIVE_TOKEN = PROTOCOL.nativeToken

export function isNativeToken(token: Address): boolean {
  return isAddressEqual(token, NATIVE_TOKEN)
}

export function getTokenDescription(chainId: ChainId, token: Address): ITokenDescription {
  const address = getAddress(token)
  const meta = tokenMetaOf(chainId, address)
  return { name: meta.tokenKey, symbol: meta.tokenKey, decimals: meta.decimals, isFiat: meta.isFiat, address }
}
