import type { IntervalTime } from '@puppet/sdk/const'
import type { IStream } from 'aelea/stream'
import type { Address, Hex } from 'viem'
import type { IGmxPositionDecrease, IGmxPositionIncrease } from '../io/indexer/query.js'
import type { ValueOf } from '../utils/types.js'

export type { IMasterMetricSummary } from './common.js'

export interface IPageFilterParams {
  activityTimeframe: IStream<IntervalTime>
  collateralTokenList: IStream<Address[]>
  indexTokenList: IStream<Address[]>
}

export interface IEarningsPlan {
  compoundMode: boolean
  compoundLockRewards: boolean
  compoundVestedRewards: boolean
  // claimLockRewards: boolean
  // claimVestedRewards: boolean
  scheduleFactor: number
}

export const TRADE_FOCUS_MODE = {
  COLLATERAL: 'collateral',
  SIZE: 'size'
} as const
export type ITradeFocusMode = ValueOf<typeof TRADE_FOCUS_MODE>

export const WALLET_TAB = {
  TRADER: 'Master',
  PUPPET: 'Puppet',
  EARN: 'Earn'
} as const
export type IWalletTab = ValueOf<typeof WALLET_TAB>

export type IPosition = {
  key: Hex
  account: Hex
  market: Hex
  collateralToken: Hex
  indexToken: Hex

  sizeInUsd: bigint
  sizeInTokens: bigint
  collateralInTokens: bigint
  collateralInUsd: bigint
  realisedPnlUsd: bigint

  maxSizeInUsd: bigint
  maxSizeInTokens: bigint
  maxCollateralInTokens: bigint
  maxCollateralInUsd: bigint

  avgEntryPrice: bigint

  isLong: boolean

  lastUpdateTimestamp: number
  settledTimestamp: number

  puppetList: Address[]
  increaseList: IGmxPositionIncrease[]
  decreaseList: IGmxPositionDecrease[]

  collateralList: IGmxPositionDecrease[]

  lastUpdate: IGmxPositionIncrease | IGmxPositionDecrease
}

export type IRoute = {
  account: string
}
