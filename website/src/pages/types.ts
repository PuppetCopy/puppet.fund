import type { IntervalTime } from '@puppet/sdk/const'
import type { IStream } from 'aelea/stream'
import type { Address, Hex } from 'viem'
import type { IGmxPositionDecrease, IGmxPositionIncrease } from '../io/indexer/query.js'

export type { IMasterMetricSummary } from './common.js'

export interface IPageFilterParams {
  activityTimeframe: IStream<IntervalTime>
  collateralTokenList: IStream<Address[]>
}

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
