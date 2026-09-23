import { CHAIN_TOKEN_MAP } from '@puppet/contracts/const'
import { type Address, getAddress, type Hex, hexToNumber, size, slice, stringToHex } from 'viem'
import type { ChainId } from '../../const/index.js'
import type { IVenueContract } from '../types.js'

export const HYPERLIQUID_CHAIN_ID = 42161 as ChainId
export const HYPERLIQUID_BRIDGE = getAddress('0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7')
export const HYPERLIQUID_DEPOSIT_TOKEN = CHAIN_TOKEN_MAP[HYPERLIQUID_CHAIN_ID].USDC as Address
export const HYPERLIQUID_DEPOSIT_MIN = 5_000_000n
export const CCTP_TOKEN_MESSENGER = getAddress('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d')
export const CCTP_HYPEREVM_DOMAIN = 19
export const CCTP_HYPERCORE_FORWARDER = getAddress('0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757')
export const CCTP_CORE_DEPOSIT_WALLET = getAddress('0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24')
export const CCTP_HYPERCORE_MAX_FEE = 200_000n
const CCTP_FORWARD_MAGIC = 'cctp-forward'
export const CCTP_HYPERCORE_DEXES: ReadonlySet<number> = new Set([0, 0xffffffff])
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
export const HYPERLIQUID_ACTION_DOMAIN = 'Exchange'
export const HYPERLIQUID_USER_DOMAIN = 'HyperliquidSignTransaction'
export const HYPERLIQUID_ADMITTED_ACTIONS: ReadonlySet<string> = new Set([
  'Hyperliquid:AcceptTerms',
  'HyperliquidTransaction:ApproveAgent',
  'HyperliquidTransaction:UsdClassTransfer'
])
export const HYPERLIQUID_WITHDRAW = 'HyperliquidTransaction:Withdraw'
export const HYPERLIQUID_SEND_TO_EVM = 'HyperliquidTransaction:SendToEvmWithData'
export const HYPERCORE_USDC: ReadonlySet<string> = new Set(['USDC', 'USDC:0x6d1e7cde53ba9467b783cb7c530ce054'])
export const HYPERCORE_WITHDRAW_DESTINATIONS: ReadonlySet<number> = new Set([3, 42161, 2])

const FORWARD_HEADER = stringToHex(CCTP_FORWARD_MAGIC, { size: 24 })

export function hyperCoreRecipientOf(hookData: Hex): { recipient: Address; dex: number } | null {
  if (size(hookData) !== 56 || slice(hookData, 0, 24) !== FORWARD_HEADER) return null
  if (hexToNumber(slice(hookData, 24, 28)) !== 0 || hexToNumber(slice(hookData, 28, 32)) !== 24) return null
  return { recipient: getAddress(slice(hookData, 32, 52)), dex: hexToNumber(slice(hookData, 52, 56)) }
}

export const HYPERLIQUID_CONTRACTS: readonly IVenueContract[] = [
  {
    chainId: HYPERLIQUID_CHAIN_ID,
    address: HYPERLIQUID_BRIDGE,
    name: 'Hyperliquid bridge',
    detail: 'takes deposits into your Hyperliquid account'
  },
  {
    chainId: HYPERLIQUID_CHAIN_ID,
    address: CCTP_TOKEN_MESSENGER,
    name: 'Circle CCTP',
    detail: 'burns USDC here and credits it to your Hyperliquid account',
    pullsTokens: true
  }
]
