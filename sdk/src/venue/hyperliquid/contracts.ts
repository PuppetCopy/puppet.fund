import { type Address, concat, getAddress, keccak256, size, stringToHex, toHex, zeroAddress } from 'viem'
import type { ChainId } from '../../const/index.js'
import { CHAIN_TOKEN_MAP } from '../../const/network.js'
import { CCTP_TOKEN_MESSENGER } from '../cctp.js'
import type { IVenueContract } from '../types.js'

export const HYPERLIQUID_CHAIN_ID = 42161 satisfies ChainId
export const HYPERLIQUID_BRIDGE = getAddress('0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7')
export const HYPERLIQUID_DEPOSIT_TOKEN = CHAIN_TOKEN_MAP[HYPERLIQUID_CHAIN_ID].USDC as Address
export const HYPERLIQUID_DEPOSIT_MIN = 5_000_000n
export const HYPERLIQUID_ACTION_DOMAIN = 'Exchange'
export const HYPERLIQUID_USER_DOMAIN = 'HyperliquidSignTransaction'
export const HYPERLIQUID_APPROVE_AGENT = 'HyperliquidTransaction:ApproveAgent'
export const HYPERLIQUID_ADMITTED_ACTIONS: ReadonlySet<string> = new Set(['Hyperliquid:AcceptTerms', HYPERLIQUID_APPROVE_AGENT, 'HyperliquidTransaction:UsdClassTransfer'])
export const HYPERLIQUID_WITHDRAW = 'HyperliquidTransaction:Withdraw'
export const HYPERLIQUID_WITHDRAW_FEE = 1_000_000n
export const HYPERLIQUID_EXCHANGE_URL = 'https://api.hyperliquid.xyz/exchange'
export const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'
export const HYPERLIQUID_REFERRAL_ACTION = { type: 'setReferrer', code: 'PUPPETFUND' } as const
export const HYPERLIQUID_REFERRER = getAddress('0xc27400cD8BccBb3e642ACF1874f3A6C5A179c5D9')

export function hyperliquidActionTypedData(action: { type: 'setReferrer'; code: string }, nonce: number) {
  const packed = concat(['0x82', ...['type', action.type, 'code', action.code].map(text => concat([toHex(0xa0 | size(stringToHex(text)), { size: 1 }), stringToHex(text)]))])
  return {
    domain: { name: HYPERLIQUID_ACTION_DOMAIN, version: '1', chainId: 1337, verifyingContract: zeroAddress },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: 'a', connectionId: keccak256(concat([packed, toHex(BigInt(nonce), { size: 8 }), '0x00'])) }
  } as const
}
export const HYPERLIQUID_UNIFIED_MODES: ReadonlySet<string> = new Set(['unifiedAccount', 'portfolioMargin'])
export const HYPERLIQUID_SEND_TO_EVM = 'HyperliquidTransaction:SendToEvmWithData'

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
    detail: 'burns USDC here and credits it to an account on HyperCore',
    pullsTokens: true
  }
]
