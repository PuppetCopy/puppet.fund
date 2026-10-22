import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeFunctionData, getAddress, type Hex, hexToNumber, isAddressEqual, pad, size, slice, stringToHex, toFunctionSelector } from 'viem'
import { decodeErc20 } from './erc20.js'
import type { IGuardReason } from './types.js'

export const CCTP_TOKEN_MESSENGER = getAddress('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d')
export const CCTP_HYPEREVM_DOMAIN = 19
export const CCTP_HYPERCORE_FORWARDER = getAddress('0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757')
export const CCTP_CORE_DEPOSIT_WALLET = getAddress('0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24')
export const CCTP_HYPERCORE_MAX_FEE = 200_000n
export const HYPERCORE_PERPS_DEX = 0
export const HYPERCORE_SPOT_DEX = 0xffffffff
export const CCTP_HYPERCORE_DEXES: ReadonlySet<number> = new Set([HYPERCORE_PERPS_DEX, HYPERCORE_SPOT_DEX])
export const CCTP_TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'event',
    name: 'DepositForBurn',
    inputs: [
      { name: 'burnToken', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'mintRecipient', type: 'bytes32', indexed: false },
      { name: 'destinationDomain', type: 'uint32', indexed: false },
      { name: 'destinationTokenMessenger', type: 'bytes32', indexed: false },
      { name: 'destinationCaller', type: 'bytes32', indexed: false },
      { name: 'maxFee', type: 'uint256', indexed: false },
      { name: 'minFinalityThreshold', type: 'uint32', indexed: true },
      { name: 'hookData', type: 'bytes', indexed: false }
    ]
  }
] as const

const FORWARD_HEADER = stringToHex('cctp-forward', { size: 24 })
const BURN_SELECTOR = toFunctionSelector(CCTP_TOKEN_MESSENGER_ABI[0])
const FORWARDER_WORD = pad(CCTP_HYPERCORE_FORWARDER).toLowerCase()

export function hyperCoreRecipientOf(hookData: Hex): { recipient: Address; dex: number } | null {
  if (size(hookData) !== 56 || slice(hookData, 0, 24) !== FORWARD_HEADER) return null
  if (hexToNumber(slice(hookData, 24, 28)) !== 0 || hexToNumber(slice(hookData, 28, 32)) !== 24) return null
  return { recipient: getAddress(slice(hookData, 32, 52)), dex: hexToNumber(slice(hookData, 52, 56)) }
}

export function cctpBurn(call: IIAccount__Call) {
  if (!isAddressEqual(call.target, CCTP_TOKEN_MESSENGER) || size(call.callData) < 4 || slice(call.callData, 0, 4) !== BURN_SELECTOR) return null
  let decoded: ReturnType<typeof decodeFunctionData<typeof CCTP_TOKEN_MESSENGER_ABI>>
  try {
    decoded = decodeFunctionData({ abi: CCTP_TOKEN_MESSENGER_ABI, data: call.callData })
  } catch {
    return null
  }
  const [amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData] = decoded.args
  return { amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData, forward: hyperCoreRecipientOf(hookData) }
}
export type ICctpBurn = NonNullable<ReturnType<typeof cctpBurn>>

export function approvesCctp(call: IIAccount__Call): boolean {
  const dec = decodeErc20(call.callData)
  return dec?.functionName === 'approve' && isAddressEqual((dec.args as readonly [Address, bigint])[0], CCTP_TOKEN_MESSENGER)
}

export function screenHyperCoreForward(burn: ICctpBurn, token: Address, dexes: ReadonlySet<number>): IGuardReason[] {
  const reasons: IGuardReason[] = []
  if (!isAddressEqual(burn.burnToken, token)) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `a CCTP deposit to HyperCore burns ${token} only, not ${burn.burnToken}` })
  }
  if (burn.destinationDomain !== CCTP_HYPEREVM_DOMAIN) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_DESTINATION', detail: `CCTP destination domain ${burn.destinationDomain} is not HyperEVM (${CCTP_HYPEREVM_DOMAIN})` })
  }
  if (burn.mintRecipient.toLowerCase() !== FORWARDER_WORD || burn.destinationCaller.toLowerCase() !== FORWARDER_WORD) {
    reasons.push({
      code: 'VENUE_DEPOSIT_BAD_DESTINATION',
      detail: `CCTP mintRecipient ${burn.mintRecipient} and destinationCaller ${burn.destinationCaller} must both be the HyperCore forwarder ${CCTP_HYPERCORE_FORWARDER}`
    })
  }
  if (burn.maxFee > CCTP_HYPERCORE_MAX_FEE) {
    reasons.push({ code: 'VENUE_DEPOSIT_FEE', detail: `CCTP maxFee ${burn.maxFee} exceeds the ${CCTP_HYPERCORE_MAX_FEE} HyperCore forwarding fee` })
  }
  if (burn.forward === null) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_RECIPIENT', detail: `CCTP hookData ${burn.hookData} does not forward to a HyperCore recipient` })
  } else if (!dexes.has(burn.forward.dex)) {
    reasons.push({ code: 'VENUE_DEPOSIT_BAD_DEX', detail: `HyperCore destination dex ${burn.forward.dex} is not one of ${[...dexes].join(', ')}` })
  }
  return reasons
}
