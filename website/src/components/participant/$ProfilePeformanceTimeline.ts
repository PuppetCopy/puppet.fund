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
import {
  combine,
  empty,
  filter,
  filterNull,
  type IStream,
  just,
  map,
  op,
  skipRepeatsWith,
  start,
  switchLatest,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, PromiseStatus, promiseState } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, motion, style } from 'aelea/ui'
import { $column, $defaultNumberTickerSlot, $NumberTicker, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type BaselineData, LineType, type MouseEventParams } from 'lightweight-charts'
import type { Address } from 'viem/accounts'
import {
  $Baseline,
  $errorCard,
  $infoLabel,
  $infoTooltip,
  $intermediatePromise,
  $spinner,
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
  hideBalances: IStream<boolean>
  timelineQuery: IStream<Promise<ITimelinePoint[]>>
  label: string
  tooltip: string
  activityTimeframe: IStream<IntervalTime>
  chartHeight?: string
  $lead?: I$Node
  $empty?: I$Node
  aumUsd?: IStream<number>
  liveUsd?: IStream<number | null>
}

export const $usdTimeline = ({
  hideBalances,
  timelineQuery,
  label,
  tooltip,
  activityTimeframe,
  chartHeight = '200px',
  aumUsd,
  liveUsd,
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
      // The headline value is mounted ONCE and fed by a persistent stream, so an update (e.g. a settled withdraw moving
      // the live total) tweens old→new through motion instead of remounting the ticker on every query swap.
      const resolvedTimeline: IStream<ITimelinePoint[]> = op(
        map(
          q =>
            q.catch((err: unknown) => {
              console.error('balance timeline read failed', err)
              return [] as ITimelinePoint[]
            }),
          timelineQuery
        ),
        switchPromises,
        start([] as ITimelinePoint[]),
        multicast
      )
      // An empty series (fresh account OR a FAILED timeline query — both land here via the catch above) has NO known
      // value: emit null so the headline renders '-' instead of a fabricated $0.
      const seriesLastValue: IStream<number | null> = map(
        tl => (tl.length ? (tl[tl.length - 1].value ?? null) : null),
        resolvedTimeline
      )
      // Prefer the live total when supplied (optimistic, base-token-priced) and fall back to the series' last point
      // while it is still loading; the series alone catches up only when the timeline re-fetches.
      const baseValue: IStream<number | null> = liveUsd
        ? map(p => p.live ?? p.series, combine({ live: liveUsd, series: seriesLastValue }))
        : seriesLastValue

      const crossTimeChange = multicast(skipRepeatsWith((xsx, xsy) => xsx.time === xsy.time, crosshairMove))
      const hovered: IStream<number | null> = start(
        null as number | null,
        map(cross => {
          if (cross?.point) {
            const seriesData = cross.seriesData.values().next().value as any
            return (seriesData?.value || 0) as number
          }
          return null
        }, crossTimeChange)
      )
      const hoverValue = map(p => p.hovered ?? p.base, combine({ base: baseValue, hovered }))
      const hoverDate = start(
        null as string | null,
        map(cross => (cross?.point && cross.time != null ? readableDate(Number(cross.time)) : null), crossTimeChange)
      )

      const knownValue: IStream<number> = filterNull(hoverValue)
      const $headerValue = $column(style({ flex: 1, alignItems: 'flex-end' }))(
        switchLatest(
          map(
            (p: { hide: boolean; known: boolean }) =>
              p.hide
                ? $node(style({ fontSize: text.xxl, fontWeight: '900', color: palette.message }))($text('••••'))
                : p.known
                  ? $row(style({ alignItems: 'flex-end' }))(
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
                          v => parseReadableNumber(readableUnitAmount(v)),
                          motion({ damping: 26, precision: 15, stiffness: 210 }, knownValue)
                        ),
                        incrementColor: palette.positive,
                        decrementColor: palette.negative
                      })
                    )
                  : $node(style({ fontSize: text.xxl, fontWeight: '900', color: palette.message }))($text('-')),
            skipRepeatsWith(
              (a, b) => a.hide === b.hide && a.known === b.known,
              combine({ hide: hideBalances, known: map(v => v !== null, hoverValue) })
            )
          )
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
      // Hide the headline until there is something to show (no live override and an empty series); the wallet page always
      // passes liveUsd, so it mounts immediately and never re-mounts on value changes.
      const $header = liveUsd
        ? $headerValue
        : switchLatest(
            map(has => (has ? $headerValue : empty), skipRepeatsWith((a, b) => a === b, map(tl => tl.length > 0, resolvedTimeline)))
          )

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
            $header
          ),
          switchLatest(
            start(
              $column(style({ flex: 1, alignItems: 'center', placeContent: 'center' }))($spinner),
              op(
                combine({ query: timelineQuery, aum: aumUsd ?? just(0) }),
                map(async p => ({ timeline: await p.query, aum: p.aum })),
                promiseState,
                filter(s => s.status !== PromiseStatus.PENDING),
                skipRepeatsWith((a, b) => {
                  if (a.status !== PromiseStatus.DONE || b.status !== PromiseStatus.DONE) return false
                  const ta = a.value.timeline
                  const tb = b.value.timeline
                  return (
                    a.value.aum === b.value.aum &&
                    ta.length === tb.length &&
                    (ta.length === 0 ||
                      (ta[ta.length - 1].time === tb[tb.length - 1].time &&
                        ta[ta.length - 1].value === tb[tb.length - 1].value))
                  )
                }),
                map(s => {
                  if (s.status === PromiseStatus.ERROR) return $errorCard(s.error)
                  const { timeline, aum } = s.value
                  if (timeline.length === 0) return $empty

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
                      autoscaleInfoProvider: floorAutoscaleByAum(aum)
                    },
                    data: timeline as any as BaselineData<ISeriesTime>[]
                  })({
                    crosshairMove: crosshairMoveTether()
                  })
                })
              )
            )
          )
        ),

        { changeActivityTimeframe }
      ]
    }
  )

interface I$FundAccountTimeline extends IPageFilterParams {
  hideBalances: IStream<boolean>
  metricsQuery: IStream<Promise<IMasterMetricSummary>>
  chartHeight?: string
  $lead?: I$Node
  livePnlUsd?: IStream<number>
  aumUsd?: IStream<number>
}

export const $FundAccountTimeline = ({
  hideBalances,
  activityTimeframe,
  collateralTokenList,
  metricsQuery,
  chartHeight,
  $lead,
  livePnlUsd,
  aumUsd
}: I$FundAccountTimeline) =>
  component(
    (
      [selectCollateralTokenList, _selectCollateralTokenListTether]: IBehavior<Address[]>,
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
          hideBalances,
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

        { selectCollateralTokenList, changeActivityTimeframe }
      ]
    }
  )
