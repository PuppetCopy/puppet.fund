import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type ChainId, TOKEN_META } from '@puppet/sdk/const'
import { getUnixTimestamp } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { filter, type IStream, just, map, op, switchLatest } from 'aelea/stream'
import { type IBehavior, PromiseStatus, type PromiseStateDone } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $Baseline, $ButtonToggle, $bagOfCoins, $icon, $intermediateText, intermediateState, $trophy, text } from '@/ui-components'
import { formatUnits } from 'viem'
import type { IPriceSource } from '@puppet/sdk/evaluate'
import { getPrice, localPrice } from '../io/context.js'
import { localFirst } from '../io/datastore/reads.js'
import type { ITraderPerformance } from '../io/datastore/traders.js'
import { MINUS, priceFor, usdOf } from '../io/price.js'
import { $caption, $stack } from '../pages/common.js'

export const PERFORMANCE_METRICS = ['pnl', 'performance'] as const
export type IPerformanceMetric = (typeof PERFORMANCE_METRICS)[number]

export const performanceMetricLabelMap: Record<IPerformanceMetric, string> = { performance: 'Performance', pnl: 'Profit & Loss' }

export const $performanceMetricIcon = (metric: IPerformanceMetric, size = '18px'): I$Node =>
  metric === 'performance'
    ? $icon({ $content: $trophy, width: size, viewBox: '0 0 24 24' })
    : $icon({ $content: $bagOfCoins, width: size, viewBox: '0 0 32 32' })

export const $PerformanceMetricToggle = ({ performanceMetric, labels }: { performanceMetric: IStream<IPerformanceMetric>; labels: Record<IPerformanceMetric, string> }) =>
  component(([changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>) => [
    $ButtonToggle({
      value: performanceMetric,
      optionList: [...PERFORMANCE_METRICS],
      $$option: map((metric: IPerformanceMetric) =>
        $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($performanceMetricIcon(metric), $node($text(labels[metric])))
      )
    })({ select: changePerformanceMetricTether() }),
    { changePerformanceMetric }
  ])

export const pnlLabelOf = (pnl: bigint): IStream<Promise<string>> => map(price => usdOf(pnl, price), priceFor(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH))

export const roiLabelOf = (roi: number | null): string => (roi === null ? '-' : `${roi < 0 ? MINUS : ''}${Math.abs(roi).toFixed(2)}%`)

export const $pnlSpark = (sinceSec: number, performance: Pick<ITraderPerformance, 'pnlPoints' | 'tip'>, allocations: readonly number[]): I$Node => {
  const tip = performance.tip
  const points = performance.pnlPoints
  const now = getUnixTimestamp()
  const first = points[0]
  const last = points[points.length - 1]
  const series =
    first === undefined || last === undefined
      ? [{ time: sinceSec, value: 0 }, { time: now, value: 0 }]
      : [...(tip === null ? points : points.filter(p => p.time < tip.time)), ...(tip !== null ? [tip] : last.time < now ? [{ time: now, value: last.value }] : [])]
  return switchLatest(
    op(
      intermediateState(
        localFirst(
          () => localPrice(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH),
          () => getPrice(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH)
        )
      ),
      filter((s): s is PromiseStateDone<IPriceSource> => s.status === PromiseStatus.DONE),
      map(eth => {
        const usdPerEth = Number(formatUnits(eth.value.price * 10n ** BigInt(TOKEN_META.WETH.decimals), USD_PRICE_DECIMALS))
        return $Baseline({
          series: just(series.map(point => ({ time: point.time, value: point.value * usdPerEth }))),
          baseline: first === undefined ? 0 : first.value * usdPerEth,
          scaleFloor: 0,
          margin: 0.12,
          headroom: '0px',
          lineWidth: 1,
          tip: false,
          axis: null,
          under: null,
          events: just(Promise.resolve(allocations.map(time => ({ time, label: 'Allocated' }))))
        })({})
      })
    )
  )
}

export const $indexSpark = (performance: Pick<ITraderPerformance, 'indexPoints' | 'allocations'>): I$Node =>
  $Baseline({
    series: just(performance.indexPoints),
    baseline: performance.indexPoints[0]!.value,
    scaleFloor: 0,
    margin: 0.12,
    headroom: '0px',
    lineWidth: 1,
    tip: false,
    axis: null,
    under: null,
    events: just(Promise.resolve(performance.allocations.map(time => ({ time, label: 'Allocated' }))))
  })({})

const toneOf = (sign: number): string => (sign > 0 ? palette.positive : sign < 0 ? palette.negative : palette.foreground)

export const $pnlValue = (pnlLabel: IStream<Promise<string> | string>, performance: Pick<ITraderPerformance, 'pnl' | 'roi'>): I$Node =>
  $stack($node(style({ fontWeight: '700', fontFamily: 'var(--font-numbers)', color: toneOf(Number(performance.pnl)) }))($intermediateText(pnlLabel)), $caption(`${roiLabelOf(performance.roi)} ROI`), 'flex-start')

export const $sparkCell = ($spark: I$Node, $value: I$Node): I$Node =>
  $row(style({ position: 'relative', height: '100%', flex: 1, overflow: 'hidden' }))(
    $node(style({ position: 'absolute', inset: '-4px 0px', pointerEvents: 'none' }))($spark),
    $row(
      style({
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        alignItems: 'center',
        paddingLeft: '4px',
        pointerEvents: 'none',
        background: `linear-gradient(to right, ${palette.background} 0%, ${palette.background} 20%, transparent 100%)`
      })
    )($value)
  )

export const $performanceCell = (sinceSec: number, performance: ITraderPerformance, metric: IPerformanceMetric): I$Node => {
  const roi = performance.roi
  const pnlLabel = pnlLabelOf(performance.pnl)
  const $value =
    metric === 'pnl'
      ? $pnlValue(pnlLabel, performance)
      : roi === null
        ? $node(style({ color: palette.foreground }))($text('-'))
        : $stack($node(style({ fontWeight: '700', fontFamily: 'var(--font-numbers)', color: toneOf(roi) }))($text(`${roiLabelOf(roi)} ROI`)), $node(style({ fontSize: text.xs, color: palette.foreground }))($intermediateText(pnlLabel)), 'flex-start')
  return $sparkCell(metric === 'pnl' ? $pnlSpark(sinceSec, performance, performance.allocations) : $indexSpark(performance), $value)
}
