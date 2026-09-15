import { type IntervalTime, PLATFORM_STAT_INTERVAL } from '@puppet/sdk/const'
import { getMappedValue, parseReadableNumber, readableDate, readableUnitAmount } from '@puppet/sdk/core'
import { combine, empty, filterNull, type IStream, just, map, op, skipRepeatsWith, start, switchLatest, switchPromises } from 'aelea/stream'
import { type IBehavior, multicast, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, motion, style } from 'aelea/ui'
import { $column, $defaultNumberTickerSlot, $NumberTicker, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { BaselineData, MouseEventParams } from 'lightweight-charts'
import { $Baseline, $DropSelect, $errorCard, $infoLabel, $infoTooltip, $spinner, type ISeriesTime, text } from '@/ui-components'
import { activityOptionShortLabelMap } from '../$LastActivity.js'

export interface ITimelinePoint {
  time: number
  value: number
}

export interface I$ValueTimeline {
  hideBalances: IStream<boolean>
  timelineQuery: IStream<Promise<ITimelinePoint[]>>
  unit: string
  label: string
  tooltip: string
  activityTimeframe: IStream<IntervalTime>
  chartHeight?: string
  $lead?: I$Node
  $empty?: I$Node
  scaleFloor?: IStream<number>
}

const $pending = $column(style({ flex: 1, alignItems: 'center', placeContent: 'center' }))($spinner)

export const $ValueTimeline = ({
  hideBalances,
  timelineQuery,
  unit,
  label,
  tooltip,
  activityTimeframe,
  chartHeight = '200px',
  scaleFloor,
  $lead = $node(style({ flex: 1 }))(),
  $empty = $row(spacing.tiny, style({ color: palette.foreground, textAlign: 'center', placeSelf: 'center' }))($text('No activity yet'))
}: I$ValueTimeline) =>
  component(
    (
      [crosshairMove, crosshairMoveTether]: IBehavior<MouseEventParams>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>
    ) => {
      const seriesLastValue: IStream<number | null> = op(
        map(q => q.then(tl => (tl.length ? tl[tl.length - 1]!.value : null)), timelineQuery),
        switchPromises,
        start(null as number | null),
        state()
      )
      const crossTimeChange = multicast(skipRepeatsWith((a, b) => a.time === b.time, crosshairMove))
      const hovered: IStream<number | null> = start(
        null as number | null,
        map(cross => {
          if (cross?.point) {
            const seriesData = cross.seriesData.values().next().value as { value?: number } | undefined
            return seriesData?.value ?? null
          }
          return null
        }, crossTimeChange)
      )
      const hoverValue = map(p => p.hovered ?? p.base, combine({ base: seriesLastValue, hovered }))
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
                      $NumberTicker({
                        $slot: $defaultNumberTickerSlot(style({ fontSize: text.xxl, fontWeight: '900' })),
                        value: map(v => parseReadableNumber(readableUnitAmount(v)), motion({ damping: 26, precision: 15, stiffness: 210 }, knownValue)),
                        incrementColor: palette.positive,
                        decrementColor: palette.negative
                      }),
                      $node(style({ fontSize: text.base, fontWeight: '900', color: palette.foreground, lineHeight: '1.6', marginLeft: '4px' }))($text(unit))
                    )
                  : $node(style({ fontSize: text.xxl, fontWeight: '900', color: palette.message }))($text('-')),
            skipRepeatsWith((a, b) => a.hide === b.hide && a.known === b.known, combine({ hide: hideBalances, known: map(v => v !== null, hoverValue) }))
          )
        ),
        switchLatest(
          map(
            date =>
              date === null
                ? $row(style({ alignItems: 'center', fontSize: text.xs }))($infoLabel($text(label)), $infoTooltip(tooltip, palette.foreground))
                : $infoLabel(style({ fontSize: text.xs }))($text(date)),
            hoverDate
          )
        )
      )
      const $header = switchLatest(map(has => (has ? $headerValue : empty), skipRepeatsWith((a, b) => a === b, map(v => v !== null, seriesLastValue))))

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
              $DropSelect({
                value: activityTimeframe,
                optionList: [...PLATFORM_STAT_INTERVAL],
                $valueLabel: map((tf: IntervalTime) => $node(style({ fontWeight: '600', fontSize: text.sm }))($text(getMappedValue(activityOptionShortLabelMap, tf)))),
                $$option: map((tf: IntervalTime) => $node(style({ padding: '8px 14px', fontSize: text.sm }))($text(getMappedValue(activityOptionShortLabelMap, tf))))
              })({ select: changeActivityTimeframeTether() })
            ),
            $header
          ),
          switchLatest(
            start(
              $pending,
              op(
                combine({ query: timelineQuery, floor: scaleFloor ?? just(0) }),
                map(async p => ({ timeline: await p.query, floor: p.floor })),
                promiseState,
                skipRepeatsWith((a, b) => {
                  if (a.status !== PromiseStatus.DONE || b.status !== PromiseStatus.DONE) return false
                  const ta = a.value.timeline
                  const tb = b.value.timeline
                  return ta.length === tb.length && ta.every((point, i) => point.time === tb[i]!.time && point.value === tb[i]!.value)
                }),
                map(s => {
                  if (s.status === PromiseStatus.PENDING) return null
                  if (s.status === PromiseStatus.ERROR) return $errorCard(s.error)
                  const { timeline, floor } = s.value
                  if (timeline.length === 0) return $empty
                  return $Baseline({
                    chartConfig: { rightPriceScale: { visible: false, scaleMargins: { top: 0.41 } } },
                    scaleFloor: floor,
                    data: timeline as unknown as BaselineData<ISeriesTime>[]
                  })({ crosshairMove: crosshairMoveTether() })
                }),
                filterNull
              )
            )
          )
        ),
        { changeActivityTimeframe }
      ]
    }
  )
