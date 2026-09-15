import { CHAIN_TOKEN_MAP } from '@puppet/contracts/const'
import { GMX_V2_CONTRACT_MAP } from '@puppet/contracts/gmx'
import type { Address } from 'viem'
import { GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_ORDER_TYPE } from '../../evaluate/platform/gmx.js'
import { GMX_V2_CHAIN_ID } from '../../gmx/market.js'

export { GMX_DECREASE_TYPES, GMX_INCREASE_TYPES, GMX_ORDER_CUSTODY_TYPES, GMX_ORDER_TYPE } from '../../evaluate/platform/gmx.js'
export { GMX_V2_CHAIN_ID } from '../../gmx/market.js'

export const GMX_ROUTER = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.address
export const GMX_ROUTER_ABI = GMX_V2_CONTRACT_MAP.GmxExchangeRouter.abi
export const GMX_ORDER_VAULT = GMX_V2_CONTRACT_MAP.GmxOrderVault.address
export const GMX_TOKEN_SPENDER = GMX_V2_CONTRACT_MAP.GmxRouter.address
export const GMX_UI_FEE_RECEIVER = '0xff00000000000000000000000000000000000001'
export const GMX_MAX_SWAP_PATH_LENGTH = 3
export const GMX_WNT = CHAIN_TOKEN_MAP[GMX_V2_CHAIN_ID].WETH as Address

export const GMX_DECREASE_SWAP_TYPE = {
  NoSwap: 0,
  SwapPnlTokenToCollateralToken: 1,
  SwapCollateralTokenToPnlToken: 2
} as const

export const GMX_SWAP_TYPES: ReadonlySet<number> = new Set([GMX_ORDER_TYPE.MarketSwap, GMX_ORDER_TYPE.LimitSwap])
export const GMX_ADMITTED_ORDER_TYPES: ReadonlySet<number> = new Set([...GMX_INCREASE_TYPES, ...GMX_DECREASE_TYPES, ...GMX_SWAP_TYPES])
