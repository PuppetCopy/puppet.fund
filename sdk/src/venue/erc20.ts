import { type Address, decodeFunctionData, erc20Abi, type Hex, isAddressEqual } from 'viem'
import type { IScreenContext } from './types.js'

export function decodeErc20(callData: Hex) {
  try {
    return decodeFunctionData({ abi: erc20Abi, data: callData })
  } catch {
    return undefined
  }
}

export const isRegisteredToken = (ctx: IScreenContext, token: Address): boolean => ctx.registeredTokens.some(r => isAddressEqual(r, token))
