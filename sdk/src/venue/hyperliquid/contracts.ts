import { CHAIN_TOKEN_MAP } from '@puppet/contracts/const'
import { type Address, getAddress } from 'viem'
import type { ChainId } from '../../const/index.js'

export const HYPERLIQUID_CHAIN_ID = 42161 as ChainId
export const HYPERLIQUID_BRIDGE = getAddress('0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7')
export const HYPERLIQUID_DEPOSIT_TOKEN = CHAIN_TOKEN_MAP[HYPERLIQUID_CHAIN_ID].USDC as Address
export const HYPERLIQUID_DEPOSIT_MIN = 5_000_000n
export const HYPERLIQUID_ACTION_DOMAIN = 'Exchange'
export const HYPERLIQUID_USER_DOMAIN = 'HyperliquidSignTransaction'
export const HYPERLIQUID_ADMITTED_ACTIONS: ReadonlySet<string> = new Set([
  'Hyperliquid:AcceptTerms',
  'HyperliquidTransaction:ApproveAgent',
  'HyperliquidTransaction:UsdClassTransfer'
])
export const HYPERLIQUID_WITHDRAW = 'HyperliquidTransaction:Withdraw'
