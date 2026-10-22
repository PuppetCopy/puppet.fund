import type { IntervalTime } from '@puppet/sdk/const'
import { combine, empty, filter, filterNull, type IStream, map, op, reduce, skipRepeats, skipRepeatsWith, start, switchLatest } from 'aelea/stream'
import { type IBehavior, type PromiseState, type PromiseStateDone, PromiseStatus, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type INode, motion, style, styleBehavior } from 'aelea/ui'
import { $column, $defaultNumberTickerContainer, $defaultNumberTickerSlot, $NumberTicker, $row, isDesktopScreen, observer, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  $Baseline,
  $infoLabel,
  $intermediateChart,
  $intermediateFailure,
  $intermediatePulse,
  intermediateState,
  text
} from '@/ui-components'
import { $ActivityFilter } from '../$ActivityFilter.js'
import type { IPerformanceMetric } from '../$PerformanceMetric.js'
import type { ITimelinePoint } from '../../io/datastore/traders.js'
import { formatUsdNumber, MINUS } from '../../io/price.js'

export interface ITimeline {
  marks: ITimelinePoint[]
  tip: ITimelinePoint | null
}

export interface I$ValueTimeline {
  hideBalances: IStream<boolean>
  timelineQuery: IStream<Promise<ITimeline>>
  axis: 'always' | 'hover'
  format: IStream<'pnl' | 'usd' | 'index' | 'percent'>
  label: string | IStream<string>
  $tip: I$Node
  activityTimeframe: IStream<IntervalTime>
  under: string | null
  metric?: { value: IStream<IPerformanceMetric>; labels: Record<IPerformanceMetric, string> }
  chartHeight?: string
  $lead?: I$Node
  $footer?: I$Node
  $empty?: I$Node
  $note?: I$Node
  events?: IStream<Promise<readonly { time: number; label: string }[]>>
}

export const $ValueTimeline = ({
  hideBalances,
  timelineQuery,
  axis,
  format,
  label,
  $tip,
  activityTimeframe,
  under,
  metric,
  chartHeight = '200px',
  $lead,
  $footer,
  $note = empty,
  $empty = $row(spacing.tiny, style({ color: palette.foreground, textAlign: 'center', placeSelf: 'center' }))($text('No activity yet')),
  events
}: I$ValueTimeline) =>
  component(
    (
      [hover, hoverTether]: IBehavior<ITimelinePoint | null>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,
      [valueBox, valueBoxTether]: IBehavior<INode<HTMLElement>, number>
    ) => {
      const valueWidth: IStream<number> = state()(valueBox)
      const seriesLastValue: IStream<number | null> = op(
        intermediateState(map(q => q.then(tl => (tl.tip !== null ? tl.tip.value : tl.marks.length > 0 ? tl.marks[tl.marks.length - 1]!.value : null)), timelineQuery)),
        filter((s): s is PromiseStateDone<number | null> => s.status === PromiseStatus.DONE),
        map(s => s.value),
        start(null as number | null),
        state()
      )
      const shownValue: IStream<number | null> = map(p => (p.hovered === null ? p.base : p.hovered.value), combine({ base: seriesLastValue, hovered: start(null, hover) }))
      const knownValue: IStream<number> = filterNull(shownValue)
      const timelineState = op(timelineQuery, intermediateState, state())
      const chartSeries = op(
        timelineState,
        map(s => {
          if (s.status !== PromiseStatus.DONE) return null
          const tip = s.value.tip
          return tip === null ? s.value.marks : [...s.value.marks.filter(point => point.time < tip.time), tip]
        }),
        filterNull,
        skipRepeatsWith((a, b) => a.length === b.length && a.every((point, i) => point.time === b[i]!.time && point.value === b[i]!.value)),
        state()
      )
      const timelinePending: IStream<boolean> = map(s => s.status === PromiseStatus.PENDING, timelineState)
      const timelineFailure: IStream<unknown> = op(
        timelineState,
        map(s => (s.status === PromiseStatus.ERROR ? s.error : null)),
        skipRepeats
      )
      const valueSize = $footer === undefined ? text.xxl : '2.4rem'
      const $labelRow = $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs }))(
        $infoLabel($text(label)),
        $tip
      )
      const $value = $intermediatePulse(timelinePending)(switchLatest(
        map(
          (p: { hide: boolean; known: boolean; format: 'pnl' | 'usd' | 'index' | 'percent' }) => {
            if (p.hide) return $node(style({ fontSize: valueSize, fontWeight: '900', color: palette.message }))($text('••••'))
            if (!p.known) return $node(style({ fontSize: valueSize, fontWeight: '900', color: palette.message }))($text('-'))
            const shown = op(motion({ damping: 26, precision: 15, stiffness: 210 }, knownValue), state())
            return $row(
              style({ fontFamily: 'var(--font-numbers)', fontWeight: '900', color: palette.message }),
              ...(p.format === 'pnl' || p.format === 'percent' ? [styleBehavior(map(v => ({ color: v > 0 ? palette.positive : v < 0 ? palette.negative : palette.message }), shown))] : [])
            )(
              $NumberTicker({
                $container: $defaultNumberTickerContainer(style({ alignItems: 'baseline' })),
                $slot: $defaultNumberTickerSlot(style({ fontSize: valueSize })),
                slots: 16,
                parser: p.format === 'index' ? (n: number) => n.toFixed(4) : p.format === 'percent' ? (n: number) => `${n < 0 ? MINUS : ''}${Math.abs(n).toFixed(2)}%` : formatUsdNumber,
                value: shown,
                incrementColor: palette.positive,
                decrementColor: palette.negative
              })
            )
          },
          skipRepeatsWith(
            (a, b) => a.hide === b.hide && a.known === b.known && a.format === b.format,
            combine({ hide: hideBalances, known: map(v => v !== null, shownValue), format })
          )
        )
      ))
      const headerKind = op(
        timelineQuery,
        intermediateState,
        reduce(
          (kind: 'pending' | 'value' | 'none' | 'failed', s: PromiseState<ITimeline>) =>
            s.status === PromiseStatus.PENDING
              ? kind
              : s.status === PromiseStatus.ERROR
                ? kind === 'value' || kind === 'none'
                  ? kind
                  : 'failed'
                : s.value.marks.length > 0 || s.value.tip !== null
                  ? 'value'
                  : 'none',
          'pending'
        ),
        skipRepeats,
        state()
      )
      const $markedValue = switchLatest(map(error => (error === null ? $value : $intermediateFailure(error, $value, true)), timelineFailure))
      const $failedDash = switchLatest(map(error => (error === null ? $text('-') : $intermediateFailure(error, $text('-'), false)), timelineFailure))
      const $headerValue = $column(style({ flex: 1, alignItems: 'flex-end' }))($markedValue, $labelRow)
      const $headerFailed = $column(style({ flex: 1, alignItems: 'flex-end' }))(
        $node(style({ fontSize: text.xxl, fontWeight: '900', color: palette.message }))($failedDash),
        $labelRow
      )
      const $header = switchLatest(map(kind => (kind === 'pending' || kind === 'value' ? $headerValue : $headerFailed), headerKind))
      const $centerValue = switchLatest(
        map(
          kind =>
            kind === 'pending' || kind === 'value'
              ? $markedValue
              : kind === 'none'
                ? $column(spacing.tiny, style({ alignItems: 'center' }))($node(style({ fontSize: valueSize, fontWeight: '900', color: palette.message }))($text('-')), $empty)
                : $node(style({ fontSize: valueSize, fontWeight: '900', color: palette.message }))($failedDash),
          headerKind
        )
      )

      const $timeframe = $ActivityFilter({ activityTimeframe, metric })({
        changeActivityTimeframe: changeActivityTimeframeTether(),
        changePerformanceMetric: changePerformanceMetricTether()
      })

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
            }),
            ...($footer === undefined
              ? []
              : [style({ transition: 'opacity 160ms ease-out' }), styleBehavior(map(point => (point === null ? null : { opacity: '0' }), hover))])
          )(
            ...($footer === undefined
              ? $lead === undefined
                ? [$row(style({ flex: 1, alignItems: 'center' }))($timeframe), $header]
                : [$lead, $timeframe, $header]
              : [...($lead === undefined ? [] : [$lead]), $row(style({ flex: 1, justifyContent: 'flex-end' }))($timeframe)])
          ),
          ...($footer === undefined
            ? []
            : [
                $node(style({ position: 'absolute', inset: 0, zIndex: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }))(
                  $node(
                    style({ padding: '9px 36px', background: `radial-gradient(closest-side, ${colorShade(palette.background, 75)} 45%, transparent 100%)` }),
                    styleBehavior(map(kind => (kind === 'none' || kind === 'failed' ? { background: 'none' } : null), headerKind)),
                    valueBoxTether(
                      observer.resize(),
                      map(entries => {
                        const entry = entries[0]
                        if (entry === undefined) throw new Error('a chart value resize carried no entry')
                        return entry.target.getBoundingClientRect().width
                      }),
                      skipRepeats
                    )
                  )($centerValue)
                ),
                $row(style({ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 11, justifyContent: 'center', pointerEvents: 'none' }))(
                  $node(
                    style({ pointerEvents: 'auto', padding: '10px 20px 12px', transition: 'opacity 160ms ease-out' }),
                    styleBehavior(map(point => (point === null ? null : { opacity: '0' }), hover))
                  )($footer)
                )
              ]),
          $node(
            style({
              position: 'relative',
              flex: 1,
              alignSelf: 'stretch',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: 0
            })
          )(
            switchLatest(
              start(
                $intermediateChart,
                op(
                  chartSeries,
                  map(series => ({ size: series.length, opening: series.flatMap(point => (point.value === null ? [] : [point.value]))[0] })),
                  skipRepeatsWith((a, b) => (a.size === 0) === (b.size === 0) && a.opening === b.opening),
                  map(shape => {
                    if (shape.size === 0) return $footer === undefined ? $empty : empty
                    if (shape.opening === undefined) return empty
                    return $node(style({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }))(
                      $Baseline({
                        series: chartSeries,
                        baseline: shape.opening,
                        scaleFloor: 0,
                        margin: 0,
                        headroom: '65px',
                        lineWidth: 1,
                        tip: false,
                        axis,
                        under,
                        fadeCenter: $footer === undefined ? undefined : valueWidth,
                        events
                      })({ hover: hoverTether() })
                    )
                  })
                )
              )
            )
          ),
          $node(style({ position: 'absolute', right: isDesktopScreen ? '20px' : '12px', bottom: '30px', zIndex: 11 }))($note)
        ),
        { changeActivityTimeframe, changePerformanceMetric }
      ]
    }
  )
