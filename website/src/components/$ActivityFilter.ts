import type { IntervalTime } from '@puppet/sdk/const'
import { getMappedValue } from '@puppet/sdk/core'
import { constant, empty, type IStream, map, switchLatest } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $Popover, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $ButtonSecondary, $defaultMiniButtonSecondary, $popoverCaret, text } from '@/ui-components'
import { $LastAtivity, activityOptionShortLabelMap } from './$LastActivity.js'
import { $PerformanceMetricToggle, $performanceMetricIcon, type IPerformanceMetric } from './$PerformanceMetric.js'

export interface I$ActivityFilter {
  activityTimeframe: IStream<IntervalTime>
  metric?: { value: IStream<IPerformanceMetric>; labels: Record<IPerformanceMetric, string> }
}

export const $ActivityFilter = ({ activityTimeframe, metric }: I$ActivityFilter) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>
    ) => [
      $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '240px' }))(
            metric === undefined
              ? empty
              : $column(spacing.small)(
                  $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Metric')),
                  $PerformanceMetricToggle({ performanceMetric: metric.value, labels: metric.labels })({ changePerformanceMetric: changePerformanceMetricTether() })
                ),
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Timeframe')),
              $LastAtivity({ activityTimeframe })({ changeActivityTimeframe: changeActivityTimeframeTether() })
            )
          ),
          clickFilters
        ),
        $target: $ButtonSecondary({
          $container: $defaultMiniButtonSecondary(style({ height: '32px', padding: '0 12px', fontSize: text.sm, fontWeight: '600' })),
          $content: $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
            metric === undefined
              ? empty
              : switchLatest(map(each => $row(spacing.tiny, style({ alignItems: 'center' }))($performanceMetricIcon(each, '14px'), $node($text(metric.labels[each]))), metric.value)),
            $node(style(metric === undefined ? {} : { borderLeft: `1px solid ${colorShade(palette.foreground, 35)}`, paddingLeft: '8px' }))(
              $text(map(tf => getMappedValue(activityOptionShortLabelMap, tf), activityTimeframe))
            ),
            $popoverCaret()
          )
        })({ click: clickFiltersTether() })
      })({}),
      { changeActivityTimeframe, changePerformanceMetric }
    ]
  )
