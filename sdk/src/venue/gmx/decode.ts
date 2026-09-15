import { GMX } from '@puppet/contracts/const'
import { ARBITRUM_MARKET_LIST } from '@puppet/contracts/gmx'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeFunctionData, encodeFunctionData, type Hex, isAddressEqual, zeroHash } from 'viem'
import { GMX_ROUTER, GMX_ROUTER_ABI } from './contracts.js'

export function decodeRouter(callData: Hex) {
  try {
    return decodeFunctionData({ abi: GMX_ROUTER_ABI, data: callData })
  } catch {
    return undefined
  }
}

export function unwrapRouterCalls(callData: Hex): Array<{ functionName: string; args: readonly unknown[] }> | undefined {
  const dec = decodeRouter(callData)
  if (!dec) return undefined
  if (dec.functionName !== 'multicall') return [dec]
  const out: Array<{ functionName: string; args: readonly unknown[] }> = []
  for (const data of dec.args[0]) {
    const inner = decodeRouter(data)
    if (!inner) return undefined
    out.push(inner)
  }
  return out
}

export function traceSwapPathOutput(tokenIn: Address, swapPath: readonly Address[]): Address | undefined {
  let token = tokenIn
  for (const hop of swapPath) {
    const market = ARBITRUM_MARKET_LIST.find(m => isAddressEqual(m.marketToken as Address, hop))
    if (!market) return undefined
    const long = market.longToken as Address
    const short = market.shortToken as Address
    if (isAddressEqual(token, long)) token = short
    else if (isAddressEqual(token, short)) token = long
    else return undefined
  }
  return token
}

export function withProtocolReferral(target: Address, callData: Hex): Hex {
  if (!isAddressEqual(target, GMX_ROUTER)) return callData
  const stamp = (data: Hex): Hex => {
    const dec = decodeRouter(data)
    if (dec?.functionName !== 'createOrder') return data
    const params = dec.args[0]
    if (params.referralCode !== zeroHash) return data
    return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'createOrder', args: [{ ...params, referralCode: GMX.referralCode as Hex }] })
  }
  const dec = decodeRouter(callData)
  if (!dec) return callData
  if (dec.functionName !== 'multicall') return stamp(callData)
  return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'multicall', args: [dec.args[0].map(stamp)] })
}

export function gmxOutflows(call: IIAccount__Call): { token: Address; amount: bigint }[] {
  if (!isAddressEqual(call.target, GMX_ROUTER)) return []
  const inner = unwrapRouterCalls(call.callData)
  if (!inner) return []
  const out: { token: Address; amount: bigint }[] = []
  for (const dec of inner) {
    if (dec.functionName !== 'sendTokens') continue
    const [token, , amount] = dec.args as readonly [Address, Address, bigint]
    out.push({ token, amount })
  }
  return out
}
