import type { IntervalTime } from '@puppet/sdk/const'
import type { IStream } from 'aelea/stream'

export interface IPageFilterParams {
  activityTimeframe: IStream<IntervalTime>
}
