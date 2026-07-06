import { PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { wrappedNativeAddressOf } from '@puppet/sdk/state'
import { type Address, isAddressEqual } from 'viem'

export const providerToken = (token: Address, chainId: number): Address =>
  isAddressEqual(token, PROTOCOL.nativeToken) ? wrappedNativeAddressOf(chainId as ChainId) : token
