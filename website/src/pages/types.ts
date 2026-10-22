import type { IntervalTime } from '@puppet/sdk/const'
import type { IStream } from 'aelea/stream'
import type { IPerformanceMetric } from '../components/$PerformanceMetric.js'

export interface IPageFilterParams {
  activityTimeframe: IStream<IntervalTime>
  performanceMetric: IStream<IPerformanceMetric>
}
