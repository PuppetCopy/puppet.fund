import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeFunctionData, encodeFunctionData, getAddress, type Hex, isAddressEqual, type PublicClient, zeroAddress, zeroHash } from 'viem'
import { decodeErc20 } from '../erc20.js'
import type { IVenueMarket } from '../types.js'
import { GMX_REFERRAL_CODE, GMX_REFERRAL_STORAGE, GMX_REFERRAL_STORAGE_ABI, GMX_ROUTER, GMX_ROUTER_ABI, GMX_TOKEN_SPENDER } from './contracts.js'

function decodeRouter(callData: Hex) {
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

export function traceSwapPathOutput(markets: ReadonlyMap<Address, IVenueMarket>, tokenIn: Address, swapPath: readonly Address[]): Address | undefined {
  let token = tokenIn
  for (const hop of swapPath) {
    const market = markets.get(getAddress(hop))
    if (market === undefined) return undefined
    const long = market.longToken
    const short = market.shortToken
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
    return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'createOrder', args: [{ ...params, referralCode: GMX_REFERRAL_CODE }] })
  }
  const dec = decodeRouter(callData)
  if (!dec) return callData
  if (dec.functionName !== 'multicall') return stamp(callData)
  return encodeFunctionData({ abi: GMX_ROUTER_ABI, functionName: 'multicall', args: [dec.args[0].map(stamp)] })
}

export function routerApproval(call: Pick<IIAccount__Call, 'callData'>): boolean {
  const dec = decodeErc20(call.callData)
  return dec?.functionName === 'approve' && isAddressEqual((dec.args as readonly [Address, bigint])[0], GMX_TOKEN_SPENDER)
}

export async function gmxReferralBindingOf(client: PublicClient, account: Address, callList: readonly { target: Address; callData: Hex }[]) {
  if (!callList.some(call => isAddressEqual(call.target, GMX_ROUTER) || routerApproval(call))) return null
  const code = await client.readContract({ address: GMX_REFERRAL_STORAGE, abi: GMX_REFERRAL_STORAGE_ABI, functionName: 'traderReferralCodes', args: [account] })
  if (code === GMX_REFERRAL_CODE) return null
  if (code !== zeroHash) {
    const owner = await client.readContract({ address: GMX_REFERRAL_STORAGE, abi: GMX_REFERRAL_STORAGE_ABI, functionName: 'codeOwners', args: [code] })
    if (!isAddressEqual(owner, zeroAddress)) {
      const [tier, customShare] = await Promise.all([
        client.readContract({ address: GMX_REFERRAL_STORAGE, abi: GMX_REFERRAL_STORAGE_ABI, functionName: 'referrerTiers', args: [owner] }),
        client.readContract({ address: GMX_REFERRAL_STORAGE, abi: GMX_REFERRAL_STORAGE_ABI, functionName: 'referrerDiscountShares', args: [owner] })
      ])
      const [totalRebate, tierShare] = await client.readContract({ address: GMX_REFERRAL_STORAGE, abi: GMX_REFERRAL_STORAGE_ABI, functionName: 'tiers', args: [tier] })
      if (totalRebate === 0n || (customShare === 0n ? tierShare : customShare) >= 10_000n) return null
    }
  }
  return { target: GMX_REFERRAL_STORAGE, value: 0n, callData: encodeFunctionData({ abi: GMX_REFERRAL_STORAGE_ABI, functionName: 'setTraderReferralCodeByUser', args: [GMX_REFERRAL_CODE] }) }
}

export function gmxOutflows(_account: Address, call: IIAccount__Call): { token: Address; amount: bigint }[] {
  if (!isAddressEqual(call.target, GMX_ROUTER)) return []
  const inner = unwrapRouterCalls(call.callData)
  if (!inner) return []
  const out: { token: Address; amount: bigint }[] = []
  for (const dec of inner) {
    if (dec.functionName === 'sendTokens') {
      const [token, , amount] = dec.args as readonly [Address, Address, bigint]
      out.push({ token, amount })
    } else if (dec.functionName === 'sendWnt') {
      const [, amount] = dec.args as readonly [Address, bigint]
      out.push({ token: PROTOCOL.nativeToken, amount })
    }
  }
  return out
}
