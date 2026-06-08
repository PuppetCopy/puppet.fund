import { IntervalTime, PLATFORM_STAT_INTERVAL } from '@puppet/sdk/const'
import { getMappedValue } from '@puppet/sdk/core'
import { type IStream, map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type INodeCompose } from 'aelea/ui'
import { $ButtonToggle } from '@/ui-components'

export const activityOptionLabelMap = {
  [IntervalTime.DAY]: '24 Hours',
  [IntervalTime.WEEK]: '7 Days',
  [IntervalTime.MONTH]: '30 Days',
  [IntervalTime.QUARTER]: '90 Days',
  [IntervalTime.YEAR]: '1 Year'
} as const

export const activityOptionShortLabelMap = {
  [IntervalTime.DAY]: '1D',
  [IntervalTime.WEEK]: '1W',
  [IntervalTime.MONTH]: '1M',
  [IntervalTime.QUARTER]: '3M',
  [IntervalTime.YEAR]: '1Y'
} as const

export const activityOptionPeriodLabelMap = {
  [IntervalTime.DAY]: '1 Day',
  [IntervalTime.WEEK]: '1 Week',
  [IntervalTime.MONTH]: '1 Month',
  [IntervalTime.QUARTER]: '3 Months',
  [IntervalTime.YEAR]: '1 Year'
} as const

export interface I$LastActivity {
  activityTimeframe: IStream<IntervalTime>
  $container?: INodeCompose
}

export const $LastAtivity = ({ activityTimeframe, $container }: I$LastActivity) =>
  component(([changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>) => {
    return [
      $ButtonToggle({
        $container,
        value: activityTimeframe,
        optionList: [...PLATFORM_STAT_INTERVAL],
        $$option: map(tf => $node($text(getMappedValue(activityOptionShortLabelMap, tf))))
      })({ select: changeActivityTimeframeTether() }),
      { changeActivityTimeframe }
    ]
  })
