import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { formatFixed, getTokenDescription, getUnixTimestamp } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { chainTokenOfKey } from '@puppet/sdk/state'
import { type IStream, just, map } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { LineType, type UTCTimestamp } from 'lightweight-charts'
import { $ButtonToggle, $bagOfCoins, $icon, $trophy, text } from '@/ui-components'
import type { ITraderPerformance } from '../io/datastore/traders.js'
import { formatUsd, priceFor } from '../io/price.js'
import { $caption, $stack } from '../pages/common.js'
import { $Baseline } from '../ui-components/chart/$Baseline.js'
import type { IMarker, ISeriesType } from '../ui-components/chart/$Chart.js'

const VALUE_TOKEN = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
const value = getTokenDescription(HUB_CHAIN_ID, VALUE_TOKEN)

export const PERFORMANCE_METRICS = ['pnl', 'performance'] as const
export type IPerformanceMetric = (typeof PERFORMANCE_METRICS)[number]

export const performanceMetricLabelMap: Record<IPerformanceMetric, string> = { performance: 'Performance', pnl: 'Profit & Loss' }

export const $performanceMetricIcon = (metric: IPerformanceMetric, size = '18px'): I$Node =>
  metric === 'performance'
    ? $icon({ $content: $trophy, width: size, viewBox: '0 0 24 24' })
    : $icon({ $content: $bagOfCoins, width: size, viewBox: '0 0 32 32' })

export const $PerformanceMetricToggle = ({ performanceMetric }: { performanceMetric: IStream<IPerformanceMetric> }) =>
  component(([changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>) => [
    $ButtonToggle({
      value: performanceMetric,
      optionList: [...PERFORMANCE_METRICS],
      $$option: map((metric: IPerformanceMetric) =>
        $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($performanceMetricIcon(metric), $node($text(performanceMetricLabelMap[metric])))
      )
    })({ select: changePerformanceMetricTether() }),
    { changePerformanceMetric }
  ])

export const $performanceCell = (sinceSec: number, performance: ITraderPerformance, metric: IPerformanceMetric): I$Node => {
  const { pnl, roi, change } = performance
  const points = metric === 'pnl' ? performance.pnlPoints : performance.pricePoints
  const now = getUnixTimestamp() as UTCTimestamp
  const base = points.length === 0 ? 0 : points[0]!.value
  const last = points[points.length - 1]
  const data: ISeriesType['Baseline'][] =
    last === undefined
      ? [{ time: sinceSec as UTCTimestamp, value: 0 }, { time: now, value: 0 }]
      : [
          ...points.map(p => ({ time: p.time as UTCTimestamp, value: p.value - base })),
          ...(last.time < now ? [{ time: now, value: last.value - base }] : [])
        ]
  const $value =
    metric === 'performance'
      ? change === null
        ? $node(style({ color: palette.foreground }))($text('-'))
        : $stack(
            $node(style({ fontWeight: '700', color: palette.message }))($text(`$${formatFixed(value.decimals, performance.unitPrice).toFixed(4)}`)),
            $node(style({ fontSize: text.xs, color: change > 0 ? palette.positive : change < 0 ? palette.negative : palette.foreground }))(
              $text(`${change > 0 ? '+' : ''}${change.toFixed(2)}%`)
            ),
            'flex-start'
          )
      : pnl === null
        ? $node(style({ color: palette.foreground }))($text('-'))
        : $stack(
            $node(style({ fontWeight: '700', color: pnl > 0n ? palette.positive : pnl < 0n ? palette.negative : palette.foreground }))(
              $text(
                map(price => {
                  const usd = formatUsd(pnl < 0n ? -pnl : pnl, price)
                  return usd === '-' ? usd : `${pnl < 0n ? '-' : pnl > 0n ? '+' : ''}${usd}`
                }, priceFor(HUB_CHAIN_ID, VALUE_TOKEN))
              )
            ),
            $caption(roi === null ? '-' : `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}% ROI`),
            'flex-start'
          )
  return $row(style({ position: 'relative', height: '100%', flex: 1, overflow: 'hidden' }))(
    $node(style({ position: 'absolute', inset: '0px', pointerEvents: 'none' }))(
      $Baseline({
        data,
        markers: just([] as IMarker[]),
        chartConfig: {
          leftPriceScale: { visible: false, scaleMargins: { top: 0.15, bottom: 0.15 } },
          rightPriceScale: { visible: false },
          crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
          timeScale: { visible: false },
          handleScroll: false,
          handleScale: false
        },
        baselineOptions: { baseValue: { price: 0, type: 'price' }, lineWidth: 1, lineType: LineType.Curved }
      })({})
    ),
    $row(
      style({
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        alignItems: 'center',
        paddingLeft: '4px',
        pointerEvents: 'none',
        background: `linear-gradient(to right, ${palette.background} 0%, ${palette.background} 38%, transparent 100%)`
      })
    )($value)
  )
}
