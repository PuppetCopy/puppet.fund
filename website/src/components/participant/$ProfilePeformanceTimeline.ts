import { type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import {
  dustToZeroUsd,
  formatFixed,
  getUnixTimestamp,
  parseReadableNumber,
  readableDate,
  readableUnitAmount,
  resampleTimeSeries
} from '@puppet/sdk/core'
import { combine, empty, type IStream, just, map, skipRepeatsWith, start, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, multicast } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, motion, style } from 'aelea/ui'
import { $column, $defaultNumberTickerSlot, $NumberTicker, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type BaselineData, LineType, type MouseEventParams } from 'lightweight-charts'
import type { Address } from 'viem/accounts'
import {
  $Baseline,
  $infoLabel,
  $infoTooltip,
  $intermediatePromise,
  floorAutoscaleByAum,
  type ISeriesTime,
  text
} from '@/ui-components'
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
  aumUsd?: IStream<Promise<number>>
}

export const $usdTimeline = ({
  timelineQuery,
  label,
  tooltip,
  activityTimeframe,
  chartHeight = '200px',
  aumUsd,
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
            $row(style({ flex: 1, justifyContent: 'center' }))(
              $LastAtivity({ activityTimeframe })({
                changeActivityTimeframe: changeActivityTimeframeTether()
              })
            ),
            switchLatest(
              switchMap(async query => {
                const timeline = await query

                if (timeline.length === 0) {
                  return empty
                }

                const lastValue = timeline[timeline.length - 1].value ?? 0
                const crossTimeChange = multicast(skipRepeatsWith((xsx, xsy) => xsx.time === xsy.time, crosshairMove))
                const hoverValue = start(
                  lastValue,
                  map(cross => {
                    if (cross?.point) {
                      const seriesData = cross.seriesData.values().next().value as any
                      return (seriesData?.value || 0) as number
                    }
                    return lastValue
                  }, crossTimeChange)
                )
                const hoverDate = start(
                  null,
                  map(
                    cross => (cross?.point && cross.time != null ? readableDate(Number(cross.time)) : null),
                    crossTimeChange
                  )
                )

                return $column(style({ flex: 1, alignItems: 'flex-end' }))(
                  $row(style({ alignItems: 'flex-end' }))(
                    $node(
                      style({
                        fontSize: text.base,
                        fontWeight: '900',
                        color: palette.foreground,
                        lineHeight: '1.6',
                        marginRight: '2px'
                      })
                    )($text('$')),
                    $NumberTicker({
                      $slot: $defaultNumberTickerSlot(style({ fontSize: text.xxl, fontWeight: '900' })),
                      value: map(
                        hoverValue => parseReadableNumber(readableUnitAmount(hoverValue)),
                        motion({ damping: 26, precision: 15, stiffness: 210 }, hoverValue)
                      ),
                      incrementColor: palette.positive,
                      decrementColor: palette.negative
                    })
                  ),
                  switchLatest(
                    map(
                      date =>
                        date === null
                          ? $row(style({ alignItems: 'center', fontSize: text.xs }))(
                              $infoLabel($text(label)),
                              $infoTooltip(tooltip, palette.foreground, '16px')
                            )
                          : $infoLabel(style({ fontSize: text.xs }))($text(date)),
                      hoverDate
                    )
                  )
                )
              }, timelineQuery)
            )
          ),
          $intermediatePromise({
            $display: map(async p => {
              const timeline = await p.query

              if (timeline.length === 0) {
                return $empty
              }

              return $Baseline({
                chartConfig: {
                  rightPriceScale: {
                    visible: false,
                    scaleMargins: {
                      top: 0.41
                    }
                  },
                  leftPriceScale: {
                    autoScale: true,
                    ticksVisible: true,
                    scaleMargins: {
                      top: 0.61,
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
                  lineType: LineType.Simple,
                  baseValue: {
                    price: 0,
                    type: 'price'
                  },
                  autoscaleInfoProvider: floorAutoscaleByAum(await p.aum)
                },
                data: timeline as any as BaselineData<ISeriesTime>[]
              })({
                crosshairMove: crosshairMoveTether()
              })
            }, combine({ query: timelineQuery, aum: aumUsd ?? just(Promise.resolve(0)) }))
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
  livePnlUsd?: IStream<number>
  aumUsd?: IStream<Promise<number>>
}

export const $MasterRouteTimeline = ({
  activityTimeframe,
  collateralTokenList,
  indexTokenList,
  metricsQuery,
  chartHeight,
  $lead,
  livePnlUsd,
  aumUsd
}: I$MasterRouteTimeline) =>
  component(
    (
      [selectCollateralTokenList, _selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, _selectIndexTokenListTether]: IBehavior<Address[]>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>
    ) => {
      const timelineQuery = map(
        async params => {
          const pos = await params.metricsQuery

          if (pos.pnlTimeline.length === 0) {
            return []
          }

          const endTime = getUnixTimestamp()
          const startTime = endTime - params.activityTimeframe
          const sourceList = [
            { value: 0n, time: startTime, fund: pos.pnlTimeline[0].fund },
            ...pos.pnlTimeline.filter(item => item.time > startTime),
            { value: 0n, time: endTime, fund: '0x000000000000000000000000000000000000dEaD' as Address }
          ]

          const sumMap = new Map<Address, bigint>()

          const series = resampleTimeSeries({
            sourceList,
            ticks: 280,
            getTime: item => item.time,
            mapSource: next => {
              sumMap.set(next.fund, dustToZeroUsd(next.value))
              const sum = [...sumMap.values()].reduce((acc, curr) => acc + curr, 0n)
              return formatFixed(USD_DECIMALS, sum)
            }
          })

          if (params.live !== 0 && series.length > 0) {
            const last = series[series.length - 1]
            series[series.length - 1] = { ...last, value: (last.value ?? 0) + params.live }
          }
          return series
        },
        combine({ metricsQuery, activityTimeframe, live: livePnlUsd ?? just(0) })
      )

      return [
        $usdTimeline({
          timelineQuery,
          label: 'PnL',
          tooltip: 'The total combined settled and open trades',
          activityTimeframe,
          chartHeight,
          ...(aumUsd ? { aumUsd } : {}),
          ...($lead ? { $lead } : {})
        })({
          changeActivityTimeframe: changeActivityTimeframeTether()
        }),

        { selectCollateralTokenList, selectIndexTokenList, changeActivityTimeframe }
      ]
    }
  )
