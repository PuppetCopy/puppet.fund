import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { fundSymbolOf, gridOf } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import { getMappedValue, getTokenDescription, getUnixTimestamp, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import type { IMandateRow, IMasterMetricRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey } from '@puppet/sdk/state'
import { combine, constant, filter, fromPromise, type IStream, just, map, merge, op, start, switchMap, switchPromises } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
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
  $defaultTableRowContainer,
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
import { $card2 } from '../common/elements/$common.js'
import { $fundProfile } from '../components/$AccountProfile.js'
import { $LastAtivity, activityOptionShortLabelMap } from '../components/$LastActivity.js'
import { $PerformanceMetricToggle, $performanceCell, $performanceMetricIcon, type IPerformanceMetric, performanceMetricLabelMap } from '../components/$PerformanceMetric.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import type { IMandateDraft } from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import context from '../io/context.js'
import { fetchMasterMetrics } from '../io/datastore/reads.js'
import { type ILeaderboardEntry, leaderboardEntries, traderPerformance } from '../io/datastore/traders.js'
import { balanceAt, type IRootState } from '../wallet/root.js'
import { $navPill } from './$onboarding.js'
import { $caption, $stack } from './common.js'

const VALUE_TOKEN = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
const value = getTokenDescription(HUB_CHAIN_ID, VALUE_TOKEN)
const bond = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))

const SORT_KEYS = ['metric', 'backing', 'value', 'genesis'] as const
type ITraderSortKey = (typeof SORT_KEYS)[number]
interface ITraderSort {
  direction: 'asc' | 'desc'
  selector: ITraderSortKey
}
const DEFAULT_SORT: ITraderSort = { direction: 'desc', selector: 'metric' }
const sortLabelOf = (key: ITraderSortKey, metric: IPerformanceMetric): string =>
  key === 'metric' ? performanceMetricLabelMap[metric] : { backing: 'Backed', value: 'NAV', genesis: 'Newest' }[key]

function rankTraders(
  entries: readonly ILeaderboardEntry[],
  metrics: readonly IMasterMetricRow[],
  interval: number,
  sinceSec: number,
  untilSec: number,
  metric: IPerformanceMetric,
  sort: ITraderSort
) {
  const metricsOf = new Map<Address, IMasterMetricRow[]>()
  for (const m of metrics) {
    const master = getAddress(m.master)
    metricsOf.set(master, [...(metricsOf.get(master) ?? []), m])
  }
  const scored = entries.map(e => {
    const performance = traderPerformance(e.fundRow, e.valuations, metricsOf.get(e.master) ?? [], interval, sinceSec, untilSec)
    return {
      master: e.master,
      fundRow: e.fundRow,
      backers: e.backers,
      value: e.fundRow.value,
      performance,
      metric: metric === 'pnl' ? performance.pnl : performance.change,
      backing: e.backing,
      genesis: e.createdAt
    }
  })
  const sign = sort.direction === 'desc' ? -1 : 1
  return scored
    .sort((a, b) => {
      const ka = a[sort.selector]
      const kb = b[sort.selector]
      if (ka === null) return kb === null ? 0 : 1
      if (kb === null) return -1
      return sign * (ka > kb ? 1 : ka < kb ? -1 : 0)
    })
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
const $leaderboardHeaderCell = $defaultTableHeaderCell(style({ fontSize: text.xs }))
const $leaderboardHeaderCellEnd = $leaderboardHeaderCell(style({ placeContent: 'flex-end' }))

const $leaderboardLoader = style({
  placeContent: 'center',
  margin: '0 1px',
  background: palette.background,
  flexDirection: 'row-reverse',
  padding: '16px 0'
})($spinner)

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
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>
    ) => {
      const activityTimeframe = op(uiStorage.replayWrite(localStoreSchema.global.activityTimeframe, changeActivityTimeframe), state())
      const performanceMetric = op(uiStorage.replayWrite(localStoreSchema.global.performanceMetric, changePerformanceMetric), state())
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

      const $filters = $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '240px' }))(
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Rank by')),
              $ButtonToggle({
                value: map(s => s.selector, sort),
                optionList: [...SORT_KEYS],
                $$option: map((k: ITraderSortKey) => $node(style({ whiteSpace: 'nowrap' }))($text(map(metric => sortLabelOf(k, metric), performanceMetric))))
              })({ select: selectSortKeyTether() })
            ),
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Metric')),
              $PerformanceMetricToggle({ performanceMetric })({ changePerformanceMetric: changePerformanceMetricTether() })
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
            switchMap(metric => $performanceMetricIcon(metric, '14px'), performanceMetric),
            $text(
              map(
                p => `${sortLabelOf(p.sort.selector, p.metric)} · ${getMappedValue(activityOptionShortLabelMap, p.tf)}`,
                combine({ sort, tf: activityTimeframe, metric: performanceMetric })
              )
            ),
            $icon({ $content: $caretDown, width: '10px', viewBox: '0 0 32 32', svgOps: style({ marginLeft: '2px' }) })
          )
        })({ click: clickFiltersTether() })
      })({})

      const $emptyMessage = $column(spacing.default, style({ padding: '32px 20px', alignItems: 'center', textAlign: 'center' }))(
        $node(style({ color: palette.foreground }))($text('No traders yet. A trading account joins this board once its first trade is valued on the hub.')),
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
          $headerCell: $leaderboardHeaderCell,
          $rowContainer: $defaultTableRowContainer(style(isDesktopScreen ? { gap: '20px' } : {})),
          scrollConfig: { $loader: $leaderboardLoader, $emptyMessage, $$fail: $errorCard },
          sortBy: params.sort,
          dataSource: just(
            params.entries.then(async list =>
              rankTraders(list, await fetchMasterMetrics(params.tf, list.map(e => e.master)), params.tf, sinceSec, now, params.metric, params.sort)
            )
          ),
          columns: [
            {
              $head: $node(style({ fontWeight: '700' }))($text('Trader')),
              gridTemplate: isDesktopScreen ? '224px' : '200px',
              $bodyCallback: map((row: ITraderRank) => {
                const master = row.master
                const $profile = $node(style({ display: 'flex', minWidth: '0' }))($fundProfile(master, gridOf(row.fundRow), fundSymbolOf(row.fundRow), avatarSize))
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
                        $container: active ? $defaultMiniButtonPrimary(style({ borderColor: palette.indeterminate })) : $defaultMiniButtonPrimary,
                        disabled: just(isSelf),
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text(isSelf ? 'You' : 'Back'), $popoverCaret())
                      })({ click: popMandateTether(map(() => master)) })
                    ),
                    $open: map(
                      () =>
                        $MandateEditor({
                          master,
                          existing: mine,
                          draft: map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, master)) ?? null, draftMandateList),
                          needsDeposit: root === null || balanceAt(root.balances, HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)) === 0n
                        })({ changeMandateDraft: changeMandateDraftTether() }),
                      filter(key => isAddressEqual(key, master), popMandate)
                    ),
                    dismiss: changeMandateDraft
                  })({})
                }, backer)
              })
            },
            ...(isDesktopScreen
              ? [
                {
                  $head: $row(spacing.tiny, style({ flex: 1, alignItems: 'center', placeContent: 'flex-end' }))(
                    $stack($node(style({ fontWeight: '700', whiteSpace: 'nowrap' }))($text('NAV')), $caption('Backed'), 'flex-end'),
                    $infoTooltip('What this trader’s fund holds at its latest valuation, and the part of it held by backers.', palette.foreground)
                  ),
                  sortBy: 'value',
                  gridTemplate: '140px',
                  $headerCellContainer: $leaderboardHeaderCellEnd,
                  $bodyCellContainer: $leaderboardCellEnd,
                  $bodyCallback: map((row: ITraderRank) =>
                    $stack(
                      $node(style({ whiteSpace: 'nowrap' }))($text(readableTokenAmountLabel(value, row.value))),
                      $caption(`${row.backers} backer${row.backers === 1 ? '' : 's'} · ${readableTokenAmountLabel(value, row.backing)}`),
                      'flex-end'
                    )
                  )
                }
                ]
              : []),
            {
              $head: $row(spacing.small, style({ flex: 1, alignItems: 'center', placeContent: 'space-between' }))(
                params.metric === 'pnl'
                  ? $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $stack($node(style({ fontWeight: '700', whiteSpace: 'nowrap' }))($text('PnL')), $caption('ROI'), 'flex-start'),
                      $infoTooltip(
                        "PnL is the change in this trader's fund value between valuations inside the timeframe, net of contributions and redemptions, in hub USDC terms. ROI is that sum over the capital the trader kept in the fund.",
                        palette.foreground)
                    )
                  : $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $stack($node(style({ fontWeight: '700', whiteSpace: 'nowrap' }))($text('Share price')), $caption('ROI'), 'flex-start'),
                      $infoTooltip(
                        'The price of one fund share at its latest valuation, and how much it moved over the timeframe. Allocations and redemptions buy in and out at this price, so it moves only with trading results and fees.',
                        palette.foreground)
                    ),
                $node(style({ color: palette.foreground, whiteSpace: 'nowrap' }))($text(`${getMappedValue(activityOptionShortLabelMap, params.tf)} activity`))
              ),
              sortBy: 'metric',
              gridTemplate: 'minmax(220px, 1fr)',
              $bodyCallback: map((row: ITraderRank) => {
                return $performanceCell(sinceSec, row.performance, params.metric)
              })
            }
          ]
        })({ sortBy: changeColumnSortTether() })
      }, combine({ entries: entriesQuery, tf: activityTimeframe, metric: performanceMetric, sort, registry: fromPromise(context.getTokenRegistry()) }))

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
                  `Every trading account with a fund. Deposit ${bond.symbol} on the hub, then sign a mandate naming a trader: each round they fund takes your share within your rules and buys you a share of their fund.`,
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
