import { type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import {
  formatFixed,
  getUnixTimestamp,
  parseReadableNumber,
  readableDate,
  readableUnitAmount,
  resampleTimeSeries
} from '@puppet/sdk/core'
import {
  combine,
  empty,
  filterNull,
  type IStream,
  map,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, motion, style } from 'aelea/ui'
import { $column, $defaultNumberTickerSlot, $NumberTicker, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type BaselineData, LineType, type MouseEventParams } from 'lightweight-charts'
import type { Hex } from 'viem'
import type { Address } from 'viem/accounts'
import { $Baseline, $infoLabel, $infoTooltip, $intermediatePromise, type ISeriesTime, text } from '@/ui-components'
import type { IMasterMetricSummary, IPageFilterParams } from '../../pages/types.js'
import { $LastAtivity } from '../$LastActivity.js'

export interface ITimelinePoint {
  time: number
  value: number
}

interface I$UsdTimeline {
  timelineQuery: IStream<Promise<ITimelinePoint[]>>
  label: string
  tooltip: string
  activityTimeframe: IStream<IntervalTime>
  chartHeight?: string
  $lead?: I$Node
  $empty?: I$Node
}

export const $usdTimeline = ({
  timelineQuery,
  label,
  tooltip,
  activityTimeframe,
  chartHeight = '200px',
  $lead = $node(style({ flex: 1 }))(),
  $empty = $row(
    spacing.tiny,
    style({ color: palette.foreground, textAlign: 'center', placeSelf: 'center' })
  )($text('No activity found'))
}: I$UsdTimeline) =>
  component(
    (
      [crosshairMove, crosshairMoveTether]: IBehavior<MouseEventParams>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>
    ) => {
      return [
        $column(style({ width: '100%', padding: 0, height: chartHeight, placeContent: 'center' }))(
          $row(
            style({
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: isDesktopScreen ? '12px 20px 0' : '12px 12px 0',
              alignSelf: 'center',
              zIndex: 11,
              alignItems: 'flex-start'
            })
          )(
            $lead,
            switchLatest(
              switchMap(async query => {
                const timeline = await query

                if (timeline.length === 0) {
                  return empty
                }

                const crossTimeChange = multicast(
                  start(
                    null,
                    skipRepeatsWith((xsx, xsy) => xsx.time === xsy.time, crosshairMove)
                  )
                )
                const hoverValue = filterNull(
                  map(cross => {
                    if (cross?.point) {
                      const seriesData = cross.seriesData.values().next().value as any
                      return (seriesData?.value || 0) as number
                    }
                    return timeline[timeline.length - 1].value ?? null
                  }, crossTimeChange)
                )
                const hoverDate = map(
                  cross => (cross?.point && cross.time != null ? readableDate(Number(cross.time)) : null),
                  crossTimeChange
                )

                return $column(style({ flex: 1, alignItems: 'center' }))(
                  $NumberTicker({
                    $slot: $defaultNumberTickerSlot(style({ fontSize: text.xxl, fontWeight: '900' })),
                    value: map(
                      hoverValue => parseReadableNumber(readableUnitAmount(hoverValue)),
                      motion({ damping: 26, precision: 15, stiffness: 210 }, hoverValue)
                    ),
                    incrementColor: palette.positive,
                    decrementColor: palette.negative
                  }),
                  switchLatest(
                    map(
                      date =>
                        date === null
                          ? $row(style({ alignItems: 'center' }))($infoLabel($text(label)), $infoTooltip(tooltip))
                          : $infoLabel($text(date)),
                      hoverDate
                    )
                  )
                )
              }, timelineQuery)
            ),
            $row(style({ flex: 1 }))(
              $node(style({ flex: 1 }))(),
              $LastAtivity({ activityTimeframe })({
                changeActivityTimeframe: changeActivityTimeframeTether()
              })
            )
          ),
          $intermediatePromise({
            $display: map(async query => {
              const timeline = await query

              if (timeline.length === 0) {
                return $empty
              }

              return $Baseline({
                chartConfig: {
                  rightPriceScale: {
                    visible: false,
                    scaleMargins: {
                      top: 0.35
                    }
                  },
                  leftPriceScale: {
                    autoScale: true,
                    ticksVisible: true,
                    scaleMargins: {
                      top: 0.55,
                      bottom: 0.1
                    }
                  },
                  timeScale: {
                    visible: true
                  }
                },
                baselineOptions: {
                  baseLineColor: palette.message,
                  baseLineVisible: true,
                  lineWidth: 2,
                  lineType: LineType.Curved,
                  baseValue: {
                    price: 0,
                    type: 'price'
                  }
                },
                data: timeline as any as BaselineData<ISeriesTime>[]
              })({
                crosshairMove: crosshairMoveTether()
              })
            }, timelineQuery)
          })
        ),

        { changeActivityTimeframe }
      ]
    }
  )

interface I$MasterRouteTimeline extends IPageFilterParams {
  metricsQuery: IStream<Promise<IMasterMetricSummary>>
  chartHeight?: string
  $lead?: I$Node
}

export const $MasterRouteTimeline = ({
  activityTimeframe,
  collateralTokenList,
  indexTokenList,
  metricsQuery,
  chartHeight,
  $lead
}: I$MasterRouteTimeline) =>
  component(
    (
      [selectCollateralTokenList, _selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, _selectIndexTokenListTether]: IBehavior<Address[]>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>
    ) => {
      const timelineQuery = map(async params => {
        const pos = await params.metricsQuery

        if (pos.pnlTimeline.length === 0) {
          return []
        }

        const endTime = getUnixTimestamp()
        const startTime = endTime - params.activityTimeframe
        const sourceList = [
          { value: 0n, time: startTime, master: pos.pnlTimeline[0].master },
          ...pos.pnlTimeline.filter(item => item.time > startTime),
          { value: 0n, time: endTime, master: '0xdead' as Hex }
        ]

        const sumMap = new Map<Hex, bigint>()

        return resampleTimeSeries({
          sourceList,
          ticks: 280,
          getTime: item => item.time,
          sourceMap: next => {
            sumMap.set(next.master, next.value)
            const sum = [...sumMap.values()].reduce((acc, curr) => acc + curr, 0n)
            return formatFixed(USD_DECIMALS, sum)
          }
        })
      }, combine({ metricsQuery, activityTimeframe }))

      return [
        $usdTimeline({
          timelineQuery,
          label: 'PnL',
          tooltip: 'The total combined settled and open trades',
          activityTimeframe,
          chartHeight,
          ...($lead ? { $lead } : {})
        })({
          changeActivityTimeframe: changeActivityTimeframeTether()
        }),

        { selectCollateralTokenList, selectIndexTokenList, changeActivityTimeframe }
      ]
    }
  )
