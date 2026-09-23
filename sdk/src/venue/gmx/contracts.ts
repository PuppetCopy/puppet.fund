import { CHAIN_TOKEN_MAP } from '@puppet/contracts/const'
import type { Address } from 'viem'
import { GMX_V2_CONTRACT_MAP } from './contractMap.js'
import { GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_ORDER_TYPE } from './evaluate.js'
import { GMX_V2_CHAIN_ID } from './market.js'

export { GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_ORDER_CUSTODY_TYPES, GMX_ORDER_TYPE } from './evaluate.js'
export { GMX_V2_CHAIN_ID } from './market.js'

export const GMX_ROUTER = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address
export const GMX_ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
export const GMX_ORDER_VAULT = GMX_V2_CONTRACT_MAP.GmxOrderVault.address
export const GMX_TOKEN_SPENDER = GMX_V2_CONTRACT_MAP.GmxRouter.address
export const GMX_UI_FEE_RECEIVER = '0xff00000000000000000000000000000000000001'
export const GMX_MAX_SWAP_PATH_LENGTH = 3
export const GMX_WNT = CHAIN_TOKEN_MAP[GMX_V2_CHAIN_ID].WETH as Address
export const GMX_CHAIN_TOKENS = Object.values(CHAIN_TOKEN_MAP[GMX_V2_CHAIN_ID]) as Address[]
export const GMX_SUBACCOUNT_RELAY_ROUTER: Address = '0xfD0596f708d9D950E0eF7b5d191e5F8e55b8a67f'
export const GMX_RELAY_DOMAIN = { name: 'GmxBaseGelatoRelayRouter', version: '1' } as const
export const GMX_SUBACCOUNT_REMOVAL_TYPE = 'RemoveSubaccount'
export const GMX_ONE_CLICK_MESSAGE = 'Generate a GMX 1CT (One-Click Trading) session. Only sign this message on a trusted website.'

export const GMX_DECREASE_SWAP_TYPE = {
  NoSwap: 0,
  SwapPnlTokenToCollateralToken: 1,
  SwapCollateralTokenToPnlToken: 2
} as const

export const GMX_SWAP_TYPES: ReadonlySet<number> = new Set([GMX_ORDER_TYPE.MarketSwap, GMX_ORDER_TYPE.LimitSwap])
export const GMX_ADMITTED_ORDER_TYPES: ReadonlySet<number> = new Set([...GMX_INCREASE_TYPES, ...GMX_DECREASE_TYPES, ...GMX_SWAP_TYPES])
