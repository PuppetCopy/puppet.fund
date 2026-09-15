import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { SHARE_PRECISION } from '@puppet/sdk/backing'
import type { IntervalTime } from '@puppet/sdk/const'
import { getMappedValue, getTokenDescription, getUnixTimestamp, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import type { IMandateRow, IMasterMetricRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey } from '@puppet/sdk/state'
import { roboTraitsFromRank } from '@puppet/sdk/ui-components'
import { combine, constant, empty, filter, fromPromise, type IStream, just, map, merge, nowWith, op, start, switchMap, switchPromises } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, href, pushUrl } from 'aelea/ui-router'
import { LineType, type UTCTimestamp } from 'lightweight-charts'
import { type Address, getAddress, isAddressEqual } from 'viem'
import {
  $ButtonSecondary,
  $ButtonToggle,
  $caretDown,
  $defaultButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultTableCell,
  $defaultTableContainer,
  $defaultTableHeaderCell,
  $errorCard,
  $icon,
  $infoTooltip,
  $popoverCaret,
  $spinner,
  $Table,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $card2 } from '../common/elements/$common.js'
import { $accountLabel, accountDisplayName } from '../components/$AccountProfile.js'
import { $LastAtivity, activityOptionShortLabelMap } from '../components/$LastActivity.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import type { IMandateDraft } from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import context from '../io/context.js'
import { fetchMasterMetrics } from '../io/datastore/reads.js'
import { type ILeaderboardEntry, type ITimelinePoint, leaderboardEntries, masterMetric } from '../io/datastore/traders.js'
import { formatUsd, priceFor } from '../io/price.js'
import { $Baseline } from '../ui-components/chart/$Baseline.js'
import type { IMarker, ISeriesType } from '../ui-components/chart/$Chart.js'
import type { IRootState } from '../wallet/root.js'
import { $navPill } from './$onboarding.js'
import { $separator2 } from './common.js'

const VALUE_TOKEN = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
const value = getTokenDescription(HUB_CHAIN_ID, VALUE_TOKEN)
const bond = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))

const SORT_KEYS = ['performance', 'backing', 'cycles', 'genesis'] as const
type ITraderSortKey = (typeof SORT_KEYS)[number]
interface ITraderSort {
  direction: 'asc' | 'desc'
  selector: ITraderSortKey
}
const DEFAULT_SORT: ITraderSort = { direction: 'desc', selector: 'performance' }
const sortLabelMap: Record<ITraderSortKey, string> = { performance: 'Performance', backing: 'Backing', cycles: 'Cycles', genesis: 'Newest' }

function rankTraders(
  entries: readonly ILeaderboardEntry[],
  metrics: readonly IMasterMetricRow[],
  interval: number,
  sinceSec: number,
  untilSec: number,
  sort: ITraderSort
) {
  const metricsOf = new Map<Address, IMasterMetricRow[]>()
  for (const m of metrics) {
    const master = getAddress(m.master)
    metricsOf.set(master, [...(metricsOf.get(master) ?? []), m])
  }
  const scored = entries.map(e => {
    const settled = e.settlements.filter(s => s.kind === 'settle' && s.blockTimestamp >= sinceSec)
    const rows = metricsOf.get(e.master) ?? []
    const metric = masterMetric(rows, interval, sinceSec, untilSec)
    const performance = rows.length === 0 ? null : metric.pnl
    const capital = e.books.reduce((acc, b) => acc + b.totalShares, 0n) / SHARE_PRECISION
    const open = e.books.filter(b => b.cycle > (e.settledCycle.get(b.id) ?? 0n))
    return {
      master: e.master,
      backers: e.backers,
      openCycles: open.length,
      cycles: e.books.reduce((acc, b) => acc + Number(b.cycle), 0),
      settledCount: settled.length,
      performance,
      series: metric.points,
      roi: performance === null || capital === 0n ? null : (Number(performance) / Number(capital)) * 100,
      backing: open.reduce((acc, b) => acc + b.backed, 0n),
      genesis: e.createdAt
    }
  })
  const byPnl = scored
    .filter((s): s is (typeof s) & { performance: bigint } => s.performance !== null && s.performance > 0n)
    .sort((a, b) => (b.performance > a.performance ? 1 : b.performance < a.performance ? -1 : 0))
  const byRoi = scored.filter((s): s is (typeof s) & { roi: number } => s.roi !== null && s.roi > 0).sort((a, b) => b.roi - a.roi)
  const pnlPercentile = new Map(byPnl.map((s, i) => [s.master, (byPnl.length - i) / byPnl.length]))
  const roiPercentile = new Map(byRoi.map((s, i) => [s.master, (byRoi.length - i) / byRoi.length]))
  const sign = sort.direction === 'desc' ? -1 : 1
  return scored
    .sort((a, b) => {
      const ka = a[sort.selector]
      const kb = b[sort.selector]
      if (ka === null) return kb === null ? 0 : 1
      if (kb === null) return -1
      return sign * (ka > kb ? 1 : ka < kb ? -1 : 0)
    })
    .map(s => ({
      ...s,
      traits: roboTraitsFromRank(null, s.master, {
        pnlPercentile: pnlPercentile.get(s.master) ?? null,
        roiPercentile: roiPercentile.get(s.master) ?? null
      })
    }))
}
type ITraderRank = ReturnType<typeof rankTraders>[number]

const $leaderboardTableContainer = $defaultTableContainer(
  style({
    backgroundColor: palette.background,
    borderTop: `1px solid ${colorShade(palette.foreground, 40)}`,
    padding: isDesktopScreen ? '24px 28px 28px' : '12px'
  })
)

const $leaderboardCell = $defaultTableCell(style({ padding: '0', height: '60px' }))
const $leaderboardCellEnd = $leaderboardCell(style({ placeContent: 'flex-end' }))
const $leaderboardHeaderCellEnd = $defaultTableHeaderCell(style({ placeContent: 'flex-end' }))

const $leaderboardLoader = style({
  placeContent: 'center',
  margin: '0 1px',
  background: palette.background,
  flexDirection: 'row-reverse',
  padding: '16px 0'
})($spinner)

const $stack = ($primary: I$Node, $secondary: I$Node, align: 'flex-start' | 'flex-end'): I$Node =>
  $column(spacing.tiny, style({ alignItems: align, placeContent: 'center', whiteSpace: 'nowrap' }))($primary, $separator2, $secondary)

const sparklineSeries = (points: readonly ITimelinePoint[], sinceSec: number): ISeriesType['Baseline'][] => {
  const now = getUnixTimestamp() as UTCTimestamp
  if (points.length === 0) return [{ time: sinceSec as UTCTimestamp, value: 0 }, { time: now, value: 0 }]
  const base = points[0]!.value
  const series: ISeriesType['Baseline'][] = points.map(p => ({ time: p.time as UTCTimestamp, value: p.value - base }))
  const last = series[series.length - 1]!
  if ((last.time as number) < now) series.push({ time: now, value: 'value' in last ? last.value : 0 })
  return series
}

const $timelineCell = ($value: I$Node, series: IStream<ISeriesType['Baseline'][]>): I$Node =>
  $row(style({ position: 'relative', height: '100%', flex: 1, overflow: 'hidden' }))(
    $node(style({ position: 'absolute', inset: '0px', pointerEvents: 'none' }))(
      switchMap(
        data =>
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
          })({}),
        series
      )
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

const $secondaryText = (label: string | IStream<string>): I$Node => $node(style({ fontSize: text.xs, color: palette.foreground }))($text(label))

export interface I$Traders {
  walletRoot: IStream<IRootState | null>
  mandatesQuery: IStream<Promise<IMandateRow[]>>
  draftMandateList: IStream<IMandateDraft[]>
}

export const $Traders = ({ walletRoot, mandatesQuery, draftMandateList }: I$Traders) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [popMandate, popMandateTether]: IBehavior<PointerEvent, Address>,
      [selectSortKey, selectSortKeyTether]: IBehavior<ITraderSortKey>,
      [changeColumnSort, changeColumnSortTether]: IBehavior<{ direction: 'asc' | 'desc'; selector: string }>,
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>
    ) => {
      const activityTimeframe = op(uiStorage.replayWrite(localStoreSchema.global.activityTimeframe, changeActivityTimeframe), state())
      const sort = op(
        merge(
          map((selector): ITraderSort => ({ direction: 'desc', selector }), selectSortKey),
          map((next): ITraderSort => {
            const selector = SORT_KEYS.find(k => k === next.selector)
            if (selector === undefined) throw new Error(`unknown sort column ${next.selector}`)
            return { direction: next.direction, selector }
          }, changeColumnSort)
        ),
        change => start(DEFAULT_SORT, change),
        state()
      )
      const entriesQuery: IStream<Promise<ILeaderboardEntry[]>> = op(just(leaderboardEntries()), state())
      const hubPrice = priceFor(HUB_CHAIN_ID, VALUE_TOKEN)

      const $filters = $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '240px' }))(
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Rank by')),
              $ButtonToggle({
                value: map(s => s.selector, sort),
                optionList: [...SORT_KEYS],
                $$option: map((k: ITraderSortKey) => $node(style({ whiteSpace: 'nowrap' }))($text(sortLabelMap[k])))
              })({ select: selectSortKeyTether() })
            ),
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Timeframe')),
              $LastAtivity({ activityTimeframe })({ changeActivityTimeframe: changeActivityTimeframeTether() })
            )
          ),
          clickFilters
        ),
        $target: $ButtonSecondary({
          $container: $defaultButtonSecondary(
            style({
              height: '36px',
              padding: '0 14px',
              fontSize: text.sm,
              fontWeight: '500',
              alignSelf: 'center',
              borderColor: colorShade(palette.foreground, 40),
              transition: 'background-color 120ms ease-out'
            }),
            stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 15) })
          ),
          $content: $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
            $text(map(p => `${sortLabelMap[p.sort.selector]} · ${getMappedValue(activityOptionShortLabelMap, p.tf)}`, combine({ sort, tf: activityTimeframe }))),
            $icon({ $content: $caretDown, width: '10px', viewBox: '0 0 32 32', svgOps: style({ marginLeft: '2px' }) })
          )
        })({ click: clickFiltersTether() })
      })({})

      const $emptyMessage = $column(spacing.default, style({ padding: '32px 20px', alignItems: 'center', textAlign: 'center' }))(
        $node(style({ color: palette.foreground }))($text('No traders yet. The first cycle a trading account opens puts it on this board.')),
        $row($navPill('Trade with backing', routeSchema.portfolio, true))
      )

      const backer: IStream<{ root: IRootState | null; mandates: IMandateRow[] }> = op(
        combine({ root: walletRoot, mandates: op(mandatesQuery, switchPromises) }),
        state()
      )
      const $table = switchMap(params => {
        const now = getUnixTimestamp()
        const sinceSec = now - params.tf
        const avatarSize = isDesktopScreen ? 50 : 32
        return $Table<ITraderRank>({
          $container: $leaderboardTableContainer,
          $cell: $leaderboardCell,
          scrollConfig: { $loader: $leaderboardLoader, $emptyMessage, $$fail: $errorCard },
          sortBy: params.sort,
          dataSource: just(
            params.entries.then(async list =>
              rankTraders(list, await fetchMasterMetrics(params.tf, list.map(e => e.master)), params.tf, sinceSec, now, params.sort)
            )
          ),
          columns: [
            {
              $head: $text('Trader'),
              gridTemplate: isDesktopScreen ? 'minmax(220px, 1fr)' : '200px',
              $bodyCallback: map((row: ITraderRank) => {
                const master = row.master
                const url = href(routeSchema.traders.detail, { master })
                const $profile = $defaultAnchor(
                  attr({ href: url }),
                  spacing.small,
                  style({ display: 'flex', alignItems: 'center', minWidth: '0', flex: 1, color: palette.message, textDecoration: 'none' }),
                  effectProp(
                    'onclick',
                    nowWith(() => (ev: MouseEvent) => {
                      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                      ev.preventDefault()
                      pushUrl(url)
                    })
                  )
                )(
                  $roboAvatar(master, avatarSize, row.traits),
                  $column(style({ gap: '3px', minWidth: '0' }))(
                    $node(style({ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))(
                      $text(accountDisplayName(master))
                    ),
                    $accountLabel({ address: master, primarySize: 0.85 })
                  )
                )
                return switchMap(b => {
                  const root = b.root
                  const mine = root === null ? undefined : b.mandates.find(m => isAddressEqual(m.master, master) && isAddressEqual(m.puppet, root.account))
                  const active = mine !== undefined && mine.expiry > BigInt(now)
                  const isSelf = root !== null && isAddressEqual(root.account, master)
                  return $Popover({
                    $container: $node(style({ display: 'flex', flex: 1, minWidth: '0' })),
                    $contentContainer: $editorPopoverContentContainer,
                    $target: $row(spacing.default, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
                      $profile,
                      $ButtonSecondary({
                        $container: $defaultMiniButtonPrimary,
                        disabled: just(root === null || isSelf),
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                          active ? $node(style({ width: '6px', height: '6px', borderRadius: '50%', background: palette.positive }))() : empty,
                          $text(isSelf ? 'You' : active ? 'Backing' : 'Back'),
                          $popoverCaret()
                        )
                      })({ click: popMandateTether(map(() => master)) })
                    ),
                    $open: map(
                      () =>
                        $MandateEditor({
                          registry: params.registry,
                          master,
                          existing: mine,
                          draft: map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, master)) ?? null, draftMandateList)
                        })({ changeMandateDraft: changeMandateDraftTether() }),
                      filter(key => isAddressEqual(key, master), popMandate)
                    ),
                    dismiss: changeMandateDraft
                  })({})
                }, backer)
              })
            },
            {
              $head: $row(spacing.tiny, style({ alignItems: 'center' }))(
                $text('Cycles'),
                $infoTooltip('Cycles currently running across this trader’s books, and the backers matched into them.', palette.foreground)
              ),
              gridTemplate: isDesktopScreen ? '92px' : '80px',
              $headerCellContainer: $leaderboardHeaderCellEnd,
              $bodyCellContainer: $leaderboardCellEnd,
              $bodyCallback: map((row: ITraderRank) =>
                $stack(
                  $node(style({ color: row.openCycles === 0 ? palette.foreground : palette.message }))($text(`${row.openCycles} open`)),
                  $secondaryText(`${row.backers} backer${row.backers === 1 ? '' : 's'}`),
                  'flex-end'
                )
              )
            },
            {
              $head: $node(style({ flex: 1, textAlign: 'right' }))($text('Backing')),
              sortBy: 'backing',
              gridTemplate: isDesktopScreen ? '132px' : '108px',
              $headerCellContainer: $leaderboardHeaderCellEnd,
              $bodyCellContainer: $leaderboardCellEnd,
              $bodyCallback: map((row: ITraderRank) =>
                $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))($text(readableTokenAmountLabel(value, row.backing)))
              )
            },
            {
              $head: $row(spacing.small, style({ flex: 1, alignItems: 'center', placeContent: 'space-between' }))(
                $row(spacing.tiny, style({ alignItems: 'center' }))(
                  $text('PnL / ROI'),
                  $infoTooltip(
                    "PnL is every marked change of this trader's value net of deposits that landed inside the timeframe, in hub USDC terms, bucketed as it lands so open positions move it before they settle. ROI is that sum over the capital at cost in the trader's books.",
                    palette.foreground)
                ),
                $node(style({ color: palette.foreground, whiteSpace: 'nowrap' }))($text(`${getMappedValue(activityOptionShortLabelMap, params.tf)} activity`))
              ),
              sortBy: 'performance',
              gridTemplate: 'minmax(180px, 1fr)',
              $bodyCallback: map((row: ITraderRank) => {
                const pnl = row.performance
                const roi = row.roi
                const $value =
                  pnl === null
                    ? $node(style({ color: palette.foreground }))($text('-'))
                    : $stack(
                        $node(style({ fontWeight: '700', color: pnl > 0n ? palette.positive : pnl < 0n ? palette.negative : palette.foreground }))(
                          $text(
                            map(price => {
                              const usd = formatUsd(pnl < 0n ? -pnl : pnl, price)
                              return usd === '-' ? usd : `${pnl < 0n ? '-' : pnl > 0n ? '+' : ''}${usd}`
                            }, hubPrice)
                          )
                        ),
                        $secondaryText(`${roi === null ? '-' : `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`} · ${row.settledCount} settled`),
                        'flex-start'
                      )
                return $timelineCell($value, just(sparklineSeries(row.series, sinceSec)))
              })
            }
          ]
        })({ sortBy: changeColumnSortTether() })
      }, combine({ entries: entriesQuery, tf: activityTimeframe, sort, registry: fromPromise(context.getTokenRegistry()) }))

      return [
        $column(spacing.default)(
          $card2(style({ padding: '0', gap: 0 }))(
            $row(
              spacing.default,
              style(
                isDesktopScreen
                  ? { padding: '18px 28px', placeContent: 'space-between', alignItems: 'center' }
                  : { padding: '12px', placeContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }
              )
            )(
              $row(spacing.small, style({ alignItems: 'center' }))(
                $node(style({ fontWeight: '600', fontSize: text.lg }))($text('Traders')),
                $infoTooltip(
                  `Every trading account that has opened a cycle. Bond ${bond.symbol} once on the hub, then sign a mandate naming a trader: your bond is one pool shared across every trader you name, and each cycle they open matches it within your rules.`,
                  palette.foreground)
              ),
              $filters
            ),
            $table
          )
        ),
        { changeActivityTimeframe, changeMandateDraft }
      ]
    }
  )
