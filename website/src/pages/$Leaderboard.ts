import { FLOAT_PRECISION, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { IntervalTime, PLATFORM_STAT_INTERVAL } from '@puppet/sdk/const'
import {
  getMappedValue,
  readableFactorPercentage,
  readablePnl,
  readableTokenAmount,
  readableUsd,
  SHARE_PRECISION
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { tokenInfoFor } from '@puppet/sdk/state'
import {
  combine,
  constant,
  debounce,
  empty,
  filter,
  type IOps,
  type IStream,
  just,
  map,
  merge,
  op,
  sampleMap,
  skipRepeats,
  start,
  switchLatest,
  switchMap,
  switchPromises,
  take
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, $Tooltip, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type BaselineData, LineType } from 'lightweight-charts'
import { getAddress, isAddress, isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import {
  $Baseline,
  floorAutoscaleByAum,
  $ButtonCircular,
  $ButtonSecondary,
  $ButtonToggle,
  $caretDown,
  $DropSelect,
  $defaultDropSelectContainer,
  $defaultMiniButtonSecondary,
  $defaultTableCell,
  $defaultTableContainer,
  $defaultTableRowContainer,
  $defaultTextFieldContainer,
  $FieldLabeled,
  $icon,
  $spinner,
  $Table,
  $tokenLabelFromSummary,
  $xCross,
  type IMarker,
  type IPageRequest,
  type ISeriesTime,
  type ISortBy,
  type TableColumn
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import {
  $errorWithRetry,
  $leverage,
  $MasterDisplay,
  $pnlDisplay,
  $route,
  $tokenIcon,
  $winRateDisplay
} from '../common/$common.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $card2 } from '../common/elements/$common.js'
import { $bagOfCoins, $trophy } from '../common/elements/$icons.js'
import { $accountLabel, readableAccountName } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import {
  activityOptionLabelMap,
  activityOptionPeriodLabelMap,
  activityOptionShortLabelMap
} from '../components/$LastActivity.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import { $SubscribeEditor } from '../components/portfolio/$SubscribeEditor.js'
import * as context from '../io/context.js'
import {
  fetchGmxTraderLeaderboardPage,
  fetchLeaderboardPage,
  type IGmxTraderRow,
  type ILeaderboardRow,
  type ILeaderboardView,
  type IPerformanceMetric
} from '../io/indexer/query.js'
import { $separator2 } from './common.js'
import type { IPageFilterParams } from './types.js'

interface I$Leaderboard extends IPageFilterParams {
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  draftMatchingRuleList: IStream<ISubscribeRule[]>
}

type IShadowSort = { direction: 'asc' | 'desc'; selector: 'size' | 'pnlroi' }
type IMastersSort = { direction: 'asc' | 'desc'; selector: 'allocated' | IPerformanceMetric }

export const $Leaderboard = (config: I$Leaderboard) =>
  component(
    (
      [scrollRequest, scrollRequestTether]: IBehavior<IPageRequest>,
      [selectLeaderboardView, selectLeaderboardViewTether]: IBehavior<ILeaderboardView>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,

      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, selectIndexTokenListTether]: IBehavior<Address[]>,

      [filterAccount, filterAccountTether]: IBehavior<string | undefined>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [changeSort, changeSortTether]: IBehavior<{ direction: 'asc' | 'desc'; selector: string }, IShadowSort>,
      [changeMastersSort, changeMastersSortTether]: IBehavior<
        { direction: 'asc' | 'desc'; selector: string },
        IMastersSort
      >,
      [toggleCollateral, toggleCollateralTether]: IBehavior<INode, Address[]>,
      // Recovery actions surfaced inside the table empty/error states. Each is a PointerEvent
      // behavior (so a $Button `click` output can tether into it directly) that is mapped to the
      // relevant value and merged into the page request / filter outputs below.
      [retryFetch, retryFetchTether]: IBehavior<PointerEvent>,
      [clearCollateralFilter, clearCollateralFilterTether]: IBehavior<PointerEvent>,
      // Clears every active filter at once, driven by the (x) on the Filters anchor; fans out to the
      // account, view, and collateral sources below.
      [clearAllFilters, clearAllFiltersTether]: IBehavior<PointerEvent>,
      // Opens the advanced-filters popover (view toggle + collateral + address search live there,
      // keeping the top bar to the two core filters: Performance/PnL + activity timeframe).
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>
    ) => {
      const { activityTimeframe, collateralTokenList, userMatchingRuleQuery, draftMatchingRuleList } = config

      // The View toggle and "Clear all" feed the same stored value; clearing routes through 'masters'
      // (the default), which also makes the Shadow chip disappear.
      const leaderboardView = op(
        uiStorage.replayWrite(
          localStoreSchema.leaderboard.view,
          merge(selectLeaderboardView, constant('masters' as ILeaderboardView, clearAllFilters))
        ),
        state()
      )
      const performanceMetric = op(
        uiStorage.replayWrite(localStoreSchema.leaderboard.performanceMetric, changePerformanceMetric),
        state()
      )
      // `replayWrite` is a cold stream (each subscriber re-runs its own IndexedDB read + write
      // pipeline), so different consumers (hasFilter gate, trigger chip, tables, active-filters row)
      // could observe divergent values and a clear could appear to "not work". `state()` collapses it
      // to a single authoritative multicast value that replays the latest to every subscriber, so a
      // cleared `undefined` propagates everywhere at once — matching the shadowSort/mastersSort treatment.
      //
      // The stored value is fed by the debounced search field (`filterAccount`, also driven by the
      // field's own clear x) and "Clear all" (`clearAllFilters`). The cleared `undefined` is what empties
      // the search field (its value stream reacts to `account` going falsy), so clearing never depends on
      // where the x was clicked.
      const account = op(
        uiStorage.replayWrite(
          localStoreSchema.leaderboard.account,
          merge(filterAccount, constant(undefined, clearAllFilters))
        ),
        state()
      )
      const shadowSort = op(start(localStoreSchema.leaderboard.shadowSort.initialValue, changeSort), state())
      // Masters-view sort. There is no dedicated localStoreSchema key for this (the schema file is out of scope
      // for this change), so it is kept as in-memory reactive state seeded to sort by the active performance metric.
      const mastersSort = op(
        start({ direction: 'desc', selector: 'realisedPnl' } as IMastersSort, changeMastersSort),
        state()
      )
      // Retrying re-emits the first page request, which re-runs the page fetcher (combine has no
      // skipRepeats, so re-pushing an identical request still re-triggers the async fetch).
      const paging = start(
        { offset: 0, pageSize: 20 },
        merge(scrollRequest, constant({ offset: 0, pageSize: 20 } as IPageRequest, retryFetch))
      )
      const registry = switchPromises(context.tokenRegistryQuery)

      // Filter-aware empty state + recoverable error state for the leaderboard tables.
      // An empty result under an active collateral filter / short timeframe reads as
      // "no traders match these filters" with one-tap recovery actions instead of the generic
      // "No items to display"; a failed fetch renders the shared $errorCard with a Retry button
      // that re-runs the fetcher, instead of the default tiny inline alert pill.
      const $tableScrollStates = (filterParams: {
        collateralTokenList: Address[]
        activityTimeframe: IntervalTime
      }) => {
        const hasCollateralFilter = filterParams.collateralTokenList.length > 0
        const isNarrowTimeframe = filterParams.activityTimeframe < IntervalTime.QUARTER
        const timeframeLabel = getMappedValue(activityOptionLabelMap, filterParams.activityTimeframe)

        const $action = (label: string, click: IOps<PointerEvent, PointerEvent>) =>
          $ButtonSecondary({ $content: $text(label), $container: $defaultMiniButtonSecondary })({ click })

        const $emptyMessage =
          hasCollateralFilter || isNarrowTimeframe
            ? $column(spacing.default, style({ padding: '32px 20px', alignItems: 'center', textAlign: 'center' }))(
                $node(style({ color: palette.foreground }))(
                  $text(`No traders match these filters in the last ${timeframeLabel}`)
                ),
                hasCollateralFilter
                  ? $row(
                      spacing.small,
                      style({ placeContent: 'center', flexWrap: 'wrap' })
                    )($action('Clear filters', clearCollateralFilterTether()))
                  : empty
              )
            : $column(
                spacing.default,
                style({ padding: '32px 20px', alignItems: 'center' })
              )($node(style({ color: palette.foreground }))($text('No traders yet')))

        const $$fail = (error: unknown) =>
          $errorWithRetry(error, $ButtonSecondary({ $content: $text('Retry') })({ click: retryFetchTether() }))

        return { $emptyMessage, $$fail }
      }

      // Trader address search. Emits a checksummed address when the (debounced) input is a plausible 0x address,
      // and `undefined` to clear the filter (empty/invalid input, or the clear affordance). The single `change`
      // output is fed into the existing `filterAccount` behavior, whose value already flows into both fetchers.
      const $traderSearch = component(
        (
          [searchInput, searchInputTether]: IBehavior<string>,
          [clearSearch, clearSearchTether]: IBehavior<PointerEvent, undefined>
        ) => {
          const validatedInput: IStream<string | undefined> = op(
            searchInput,
            debounce(300),
            map(raw => {
              const trimmed = raw.trim()
              return isAddress(trimmed) ? getAddress(trimmed) : undefined
            }),
            skipRepeats
          )

          // Drives the clear (x) affordance: shown only while a filter is active.
          const hasFilter = op(
            account,
            map(a => Boolean(a)),
            skipRepeats
          )

          return [
            $row(spacing.small, style({ alignItems: 'center' }))(
              $FieldLabeled({
                label: null,
                // Seed once from the restored filter, and empty the field whenever the address filter is
                // cleared — either via the in-field (x) (`clearSearch`) or via any external clear (the
                // popover "Active filters" trader chip / "Clear all"), which all drive `account` to a
                // falsy value. We only react to `account` becoming falsy (never re-push the address back),
                // so the field is not overwritten mid-type while the user is entering an address.
                value: merge(
                  take(
                    1,
                    op(
                      account,
                      map(a => a ?? '')
                    )
                  ),
                  constant('', clearSearch),
                  constant(
                    '',
                    op(
                      account,
                      filter(a => !a)
                    )
                  )
                ),
                placeholder: 'Search by address (0x…)',
                $container: $defaultTextFieldContainer(style({ width: '220px', maxWidth: '260px' }))
              })({
                change: searchInputTether()
              }),
              switchLatest(
                map(
                  active =>
                    active
                      ? $ButtonCircular({ $iconPath: $xCross })({
                          click: clearSearchTether(map(() => undefined))
                        })
                      : empty,
                  hasFilter
                )
              )
            ),
            { change: merge(validatedInput, clearSearch) }
          ]
        }
      )

      // Small summary chip rendered on the Filters trigger so active filters are legible collapsed.
      const $filterChip = (label: string) =>
        $node(
          style({
            padding: '2px 8px',
            borderRadius: '100px',
            backgroundColor: colorShade(palette.foreground, 15),
            color: palette.message,
            fontSize: '0.75rem',
            whiteSpace: 'nowrap'
          })
        )($text(label))

      // Advanced-filters popover. The top bar shows only this Filters trigger (left) and the activity
      // timeframe (pinned right). Metric (Performance/PnL), the Accounts/Shadow view toggle, collateral
      // and the address search all live in the popover; the trigger anchor summarizes what's active.
      const $advancedFilters = $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '280px' }))(
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: '0.85rem' }))($text('Metric')),
              $ButtonToggle({
                value: performanceMetric,
                optionList: ['realisedPnl', 'navPerShare'] as IPerformanceMetric[],
                $$option: map(metric =>
                  $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
                    $icon({
                      $content: metric === 'navPerShare' ? $trophy : $bagOfCoins,
                      width: '18px',
                      viewBox: '0 0 32 32'
                    }),
                    $text(metric === 'navPerShare' ? 'Performance' : 'Profit & Loss')
                  )
                )
              })({ select: changePerformanceMetricTether() })
            ),
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: '0.85rem' }))($text('View')),
              $ButtonToggle({
                value: leaderboardView,
                optionList: ['masters', 'shadow'] satisfies ILeaderboardView[],
                $$option: map((view: ILeaderboardView) =>
                  $node(style({ whiteSpace: 'nowrap' }))($text(view === 'masters' ? 'Accounts' : 'Shadow'))
                )
              })({ select: selectLeaderboardViewTether() })
            ),
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: '0.85rem' }))($text('Collateral')),
              $SelectCollateralToken({
                selectedList: collateralTokenList,
                tokenList: switchPromises(context.registeredCollateralListQuery)
              })({
                changeCollateralTokenList: selectCollateralTokenListTether()
              })
            ),
            $column(spacing.small)(
              $node(style({ color: palette.foreground, fontSize: '0.85rem' }))($text('Find trader')),
              $traderSearch({
                change: filterAccountTether()
              })
            )
          ),
          clickFilters
        ),
        dismiss: empty,
        $target: $row(
          style({
            alignItems: 'stretch',
            borderRadius: '100px',
            border: `1px solid ${colorShade(palette.foreground, 40)}`,
            overflow: 'hidden'
          })
        )(
          $ButtonSecondary({
            $container: $node(
              style({
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                cursor: 'pointer',
                transition: 'background-color 120ms ease-out'
              }),
              stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 15) })
            ),
            $content: $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
              switchLatest(
                map(
                  p =>
                    $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
                      $icon({
                        $content: p.metric === 'navPerShare' ? $trophy : $bagOfCoins,
                        width: '16px',
                        viewBox: '0 0 32 32'
                      }),
                      $text(p.metric === 'navPerShare' ? 'Performance' : 'P&L'),
                      ...(p.view === 'shadow' ? [$filterChip('Shadow')] : []),
                      ...(p.collateral.length > 0 ? [$filterChip(`${p.collateral.length} collateral`)] : []),
                      ...(p.acct ? [$filterChip(`${p.acct.slice(0, 6)}…${p.acct.slice(-4)}`)] : [])
                    ),
                  combine({
                    metric: performanceMetric,
                    view: leaderboardView,
                    collateral: collateralTokenList,
                    acct: account
                  })
                )
              ),
              $icon({
                $content: $caretDown,
                width: '10px',
                viewBox: '0 0 32 32',
                svgOps: style({ marginLeft: '2px' })
              })
            )
          })({
            click: clickFiltersTether()
          }),
          switchLatest(
            map(
              p =>
                p.view === 'shadow' || p.collateral.length > 0 || p.acct
                  ? $row(style({ alignItems: 'stretch' }))(
                      $node(style({ width: '1px', backgroundColor: colorShade(palette.foreground, 40) }))(),
                      $ButtonSecondary({
                        $container: $node(
                          style({
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 12px',
                            cursor: 'pointer',
                            transition: 'background-color 120ms ease-out'
                          }),
                          stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 15) })
                        ),
                        $content: $icon({
                          $content: $xCross,
                          width: '11px',
                          viewBox: '0 0 32 32',
                          fill: palette.foreground
                        })
                      })({ click: clearAllFiltersTether() })
                    )
                  : empty,
              combine({ view: leaderboardView, collateral: collateralTokenList, acct: account })
            )
          )
        )
      })({})

      return [
        $column(spacing.default)(
          $card2(style({ padding: '0', gap: 0 }))(
            (isDesktopScreen
              ? $row(
                  spacing.default,
                  style({ padding: '18px 36px', placeContent: 'space-between', alignItems: 'center' })
                )
              : $row(
                  spacing.default,
                  style({ padding: '12px', placeContent: 'center', flexWrap: 'wrap', alignItems: 'flex-start' })
                ))(
              // Filters trigger on the left; activity timeframe pinned to the extreme right.
              $advancedFilters,

              $DropSelect({
                value: activityTimeframe,
                optionList: [...PLATFORM_STAT_INTERVAL],
                $anchor: $defaultDropSelectContainer(style({ borderRadius: '100px' })),
                closeOnSelect: true,
                $valueLabel: map(tf =>
                  $node(style({ whiteSpace: 'nowrap' }))($text(getMappedValue(activityOptionPeriodLabelMap, tf)))
                ),
                $$option: map(tf =>
                  $node(style({ display: 'block', padding: '8px 12px', whiteSpace: 'nowrap' }))(
                    $text(getMappedValue(activityOptionPeriodLabelMap, tf))
                  )
                )
              })({
                select: changeActivityTimeframeTether()
              })
            ),
            switchLatest(
              map((view: ILeaderboardView) => {
                if (view === 'shadow') {
                  return switchMap(
                    params => {
                      const fetchSort = {
                        direction: params.sort.direction,
                        selector:
                          params.sort.selector === 'pnlroi'
                            ? params.metric === 'navPerShare'
                              ? ('roi' as const)
                              : ('pnl' as const)
                            : ('size' as const)
                      }
                      const dataSource = map(async filterParams => {
                        const traderList = await fetchGmxTraderLeaderboardPage({
                          activityTimeframe: params.activityTimeframe,
                          account: params.account as Address | undefined,
                          collateralTokenList: params.collateralTokenList as Address[],
                          sortBy: fetchSort,
                          paging: { pageSize: filterParams.paging.pageSize, offset: filterParams.paging.offset }
                        })
                        return { ...filterParams.paging, page: traderList, $items: traderList }
                      }, combine({ paging }))

                      type I$ShadowCellData = IGmxTraderRow

                      const $stackHead = (primary: string, secondary: string) =>
                        $column(style({ alignItems: 'flex-end', flex: 1, gap: '2px', lineHeight: '1' }))(
                          $node(style({ color: palette.message }))($text(primary)),
                          $node(style({ fontSize: '0.8em', color: palette.foreground }))($text(secondary))
                        )

                      const { $emptyMessage, $$fail } = $tableScrollStates({
                        collateralTokenList: params.collateralTokenList as Address[],
                        activityTimeframe: params.activityTimeframe
                      })

                      return $Table({
                        $headerRowContainer: $defaultTableRowContainer,
                        $container: $defaultTableContainer(
                          style({
                            backgroundColor: palette.background,
                            borderTop: `1px solid ${colorShade(palette.foreground, 40)}`,
                            padding: isDesktopScreen ? '24px 36px 36px' : '12px'
                          })
                        ),
                        $cell: $defaultTableCell(style({ padding: '0', height: '60px' })),
                        scrollConfig: {
                          $loader: style({
                            placeContent: 'center',
                            margin: '0 1px',
                            background: palette.background,
                            flexDirection: 'row-reverse',
                            padding: '16px 0'
                          })($spinner),
                          $emptyMessage,
                          $$fail
                        },
                        sortBy: params.sort as unknown as ISortBy<I$ShadowCellData>,
                        dataSource,
                        columns: [
                          {
                            $head: $text('Trader'),
                            gridTemplate: isDesktopScreen ? '160px' : '128px',
                            $bodyCallback: map((row: I$ShadowCellData) => {
                              const address = getAddress(row.account)
                              return $row(spacing.small, style({ alignItems: 'center' }))(
                                $roboAvatar(address, isDesktopScreen ? 50 : 32),
                                $accountLabel({ address })
                              )
                            })
                          },
                          {
                            $head: $text('Token'),
                            gridTemplate: isDesktopScreen ? '52px' : '44px',
                            $bodyCallback: map((row: I$ShadowCellData) => {
                              const desc = getTokenDescription(row.collateralToken)
                              return desc
                                ? $Tooltip({
                                    $content: $tokenLabelFromSummary(desc),
                                    $anchor: $node(
                                      style({ cursor: 'pointer' }),
                                      toggleCollateralTether(
                                        nodeEvent('click'),
                                        sampleMap(
                                          (list: Address[]) =>
                                            list.some(t => isAddressEqual(t, row.collateralToken))
                                              ? list.filter(t => !isAddressEqual(t, row.collateralToken))
                                              : [...list, row.collateralToken],
                                          collateralTokenList
                                        )
                                      )
                                    )($tokenIcon(desc, '28px'))
                                  })({})
                                : $node($text('-'))
                            })
                          },
                          {
                            $head: $text('Win / Loss'),
                            gridTemplate: isDesktopScreen ? '90px' : '70px',
                            $bodyCallback: map((row: I$ShadowCellData) =>
                              $row(style({ alignItems: 'center' }))($text(`${row.winCount} / ${row.lossCount}`))
                            )
                          },
                          {
                            $head: $stackHead('Size', 'Leverage'),
                            sortBy: 'size',
                            gridTemplate: isDesktopScreen ? '120px' : '90px',
                            $bodyCallback: map((row: I$ShadowCellData) =>
                              $column(spacing.tiny, style({ alignItems: 'flex-end', placeContent: 'center', flex: 1 }))(
                                $text(readableUsd(row.sizeUsd)),
                                $separator2,
                                row.collateralUsd === 0n
                                  ? $node(style({ color: palette.foreground, fontSize: '0.85em' }))($text('-'))
                                  : $leverage(row.sizeUsd, row.collateralUsd)
                              )
                            )
                          },
                          {
                            // PnL/ROI overlaid on the activity chart in one column: numbers are
                            // left-aligned (the chart reads left→right, so the latest values on the
                            // right stay unobscured) over a palette.background→transparent gradient
                            // for legibility. Mirrors the masters-view performance column.
                            $head: $row(
                              spacing.small,
                              style({ flex: 1, placeContent: 'space-between', alignItems: 'center' })
                            )(
                              $text(params.metric === 'navPerShare' ? 'ROI % / PnL $' : 'PnL $ / ROI %'),
                              $node(style({ textAlign: 'right', alignSelf: 'center', color: palette.foreground }))(
                                $text(
                                  `${getMappedValue(activityOptionShortLabelMap, params.activityTimeframe)} activity`
                                )
                              )
                            ),
                            sortBy: 'pnlroi',
                            gridTemplate: isDesktopScreen ? 'minmax(0, 1fr)' : '220px',
                            $bodyCallback: map((row: I$ShadowCellData) => {
                              const roi =
                                row.collateralUsd === 0n
                                  ? 0n
                                  : (row.realisedPnlUsd * FLOAT_PRECISION) / row.collateralUsd
                              const roiColor =
                                row.collateralUsd === 0n
                                  ? palette.foreground
                                  : roi >= 0n
                                    ? palette.positive
                                    : palette.negative
                              const roiText = row.collateralUsd === 0n ? '-' : readableFactorPercentage(roi)
                              const showRoiPrimary = params.metric === 'navPerShare'
                              const $primaryRoi = $node(style({ fontWeight: 'bold', color: roiColor }))($text(roiText))
                              const $secondaryRoi = $node(
                                style({
                                  color: row.collateralUsd === 0n ? palette.foreground : palette.message,
                                  fontSize: '0.85em'
                                })
                              )($text(roiText))
                              const $secondaryPnl = $node(style({ color: palette.message, fontSize: '0.85em' }))(
                                $text(readablePnl(row.realisedPnlUsd))
                              )
                              const $value = $column(
                                spacing.tiny,
                                style({ alignItems: 'flex-start', placeContent: 'center', whiteSpace: 'nowrap' })
                              )(
                                showRoiPrimary ? $primaryRoi : $pnlDisplay(row.realisedPnlUsd),
                                $separator2,
                                showRoiPrimary ? $secondaryPnl : $secondaryRoi
                              )

                              if (row.pnlTimeline.length === 0) {
                                return $row(style({ alignItems: 'center', placeContent: 'flex-start', flex: 1 }))(
                                  $value
                                )
                              }

                              return $row(style({ position: 'relative', height: '100%', flex: 1, overflow: 'hidden' }))(
                                style({
                                  flex: 1,
                                  inset: '0px 0px 0px 0px',
                                  position: 'absolute',
                                  pointerEvents: 'none',
                                  width: '100%'
                                })(
                                  $Baseline({
                                    markers: just([] as IMarker[]),
                                    chartConfig: {
                                      leftPriceScale: {
                                        visible: false,
                                        scaleMargins: { top: 0.1, bottom: 0.1 }
                                      },
                                      crosshair: {
                                        horzLine: { visible: false },
                                        vertLine: { visible: false }
                                      },
                                      timeScale: { visible: false }
                                    },
                                    data: row.pnlTimeline as any as BaselineData<ISeriesTime>[],
                                    baselineOptions: {
                                      baseValue: { price: 0, type: 'price' },
                                      lineWidth: 1,
                                      lineType: LineType.Curved,
                                      autoscaleInfoProvider: floorAutoscaleByAum(Number(row.collateralUsd) / 1e30)
                                    }
                                  })({})
                                ),
                                $row(
                                  style({
                                    position: 'absolute',
                                    background: `linear-gradient(to right, ${palette.background} 0%, ${palette.background} 32%, transparent 100%)`,
                                    inset: 0,
                                    zIndex: 1,
                                    alignItems: 'center',
                                    paddingLeft: '4px',
                                    pointerEvents: 'none'
                                  })
                                )($value)
                              )
                            })
                          }
                        ] as TableColumn<I$ShadowCellData>[]
                      })({
                        scrollRequest: scrollRequestTether(),
                        sortBy: changeSortTether(
                          sampleMap((current: IShadowSort, next: { direction: 'asc' | 'desc'; selector: string }) => {
                            const selector = next.selector as 'size' | 'pnlroi'
                            return selector === current.selector
                              ? { direction: current.direction === 'asc' ? 'desc' : 'asc', selector }
                              : { direction: current.direction, selector }
                          }, shadowSort)
                        )
                      })
                    },
                    combine({
                      activityTimeframe,
                      account,
                      collateralTokenList,
                      sort: shadowSort,
                      metric: performanceMetric
                    })
                  )
                }

                return switchMap(
                  params => {
                    // When sorting on the performance column, follow the live Performance/PnL toggle. AUM ('allocated')
                    // is independent of the toggle.
                    const sortSelector: keyof ILeaderboardRow =
                      params.sort.selector === 'allocated' ? 'allocated' : params.performanceMetric
                    const mastersSortBy = { direction: params.sort.direction, selector: sortSelector }

                    const dataSource = map(async filterParams => {
                      const metricList = await fetchLeaderboardPage({
                        activityTimeframe: params.activityTimeframe,
                        account: params.account as Address | undefined,
                        collateralTokenList: params.collateralTokenList as Address[],
                        sortBy: mastersSortBy,
                        paging: { pageSize: filterParams.paging.pageSize, offset: filterParams.paging.offset }
                      })
                      return { ...filterParams.paging, page: metricList, $items: metricList }
                    }, combine({ paging }))

                    type I$LeaderboardCellData = ILeaderboardRow

                    const { $emptyMessage, $$fail } = $tableScrollStates({
                      collateralTokenList: params.collateralTokenList as Address[],
                      activityTimeframe: params.activityTimeframe
                    })

                    return $Table({
                      $headerRowContainer: $defaultTableRowContainer,
                      $container: $defaultTableContainer(
                        style({
                          backgroundColor: palette.background,
                          borderTop: `1px solid ${colorShade(palette.foreground, 40)}`,
                          padding: isDesktopScreen ? '24px 36px 36px' : '12px'
                        })
                      ),
                      $cell: $defaultTableCell(style({ padding: '0', height: '60px' })),
                      scrollConfig: {
                        $loader: style({
                          placeContent: 'center',
                          margin: '0 1px',
                          background: palette.background,
                          flexDirection: 'row-reverse',
                          padding: '16px 0'
                        })($spinner),
                        $emptyMessage,
                        $$fail
                      },
                      sortBy: mastersSortBy as unknown as ISortBy<I$LeaderboardCellData>,
                      dataSource,
                      columns: [
                        {
                          $head: $text('Master'),
                          gridTemplate: isDesktopScreen ? '280px' : '200px',
                          $bodyCallback: map(pos => {
                            const $master = $MasterDisplay({
                              address: pos.fund as Address,
                              ensName: readableAccountName(pos.name),
                              avatarSeed: pos.shareToken ?? undefined,
                              puppetList: pos.puppetList,
                              profileSize: isDesktopScreen ? 50 : 32
                            })({})
                            const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseTokenId).token
                            const $copy = $SubscribeEditor({
                              master: pos.master,
                              collateralToken: token,
                              baseTokenId: pos.baseTokenId,
                              userMatchingRuleQuery,
                              draftMatchingRuleList
                            })({ changeMatchRuleList: changeMatchRuleListTether() })
                            const $identity = $row(spacing.default, style({ alignItems: 'center', minWidth: '0', flex: 1 }))(
                              $node(style({ display: 'flex', flex: 1, minWidth: '0', overflow: 'hidden' }))(
                                style({ flexShrink: '1', minWidth: '0' })($master)
                              ),
                              $copy
                            )
                            // On mobile there is no dedicated Consistency column, so fold win-rate in as a secondary line.
                            // TODO(indexer): swap/augment with drawdown + Sharpe once MasterLatestMetric exposes them.
                            return isDesktopScreen
                              ? $identity
                              : $column(spacing.tiny)($identity, $winRateDisplay(pos.winCount, pos.lossCount))
                          })
                        },
                        {
                          $head: $text('Token'),
                          gridTemplate: isDesktopScreen ? '104px' : '58px',
                          $bodyCallback: map((pos: I$LeaderboardCellData) => {
                            const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseTokenId).token
                            return $route(getTokenDescription(token), isDesktopScreen)
                          })
                        },
                        {
                          // AUM + the active metric overlaid on the activity chart in one column: numbers are
                          // left-aligned (the chart reads left→right, so the latest values on the right stay
                          // unobscured) over a palette.background→transparent gradient. Mirrors the shadow view.
                          $head: $row(
                            spacing.small,
                            style({ flex: 1, placeContent: 'space-between', alignItems: 'center' })
                          )(
                            $text(params.performanceMetric === 'navPerShare' ? 'ROI % / AUM' : 'PnL $ / AUM'),
                            $node(style({ textAlign: 'right', alignSelf: 'center', color: palette.foreground }))(
                              $text(`${getMappedValue(activityOptionShortLabelMap, params.activityTimeframe)} activity`)
                            )
                          ),
                          sortBy: params.performanceMetric,
                          gridTemplate: isDesktopScreen ? 'minmax(0, 1fr)' : '220px',
                          $bodyCallback: map(pos => {
                            const isNav = params.performanceMetric === 'navPerShare'
                            const navReturn =
                              (Number(pos.navPerShare) / Number(FLOAT_PRECISION / SHARE_PRECISION) - 1) * 100
                            const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseTokenId).token
                            const desc = getTokenDescription(token)
                            const $primary = isNav
                              ? $node(
                                  style({
                                    fontWeight: 'bold',
                                    color: navReturn >= 0 ? palette.positive : palette.negative
                                  })
                                )($text(`${navReturn >= 0 ? '+' : ''}${navReturn.toFixed(2)}%`))
                              : $pnlDisplay(pos.realisedPnl)
                            const $value = $column(
                              spacing.tiny,
                              style({ alignItems: 'flex-start', placeContent: 'center', whiteSpace: 'nowrap' })
                            )(
                              $primary,
                              $separator2,
                              $node(style({ color: palette.message, fontSize: '0.85em' }))(
                                $text(readableTokenAmount(desc, pos.allocated))
                              )
                            )

                            if (pos.pnlTimeline.length === 0) {
                              return $row(style({ alignItems: 'center', placeContent: 'flex-start', flex: 1 }))($value)
                            }

                            return $row(style({ position: 'relative', height: '100%', flex: 1, overflow: 'hidden' }))(
                              style({
                                flex: 1,
                                inset: '0px 0px 0px 0px',
                                position: 'absolute',
                                pointerEvents: 'none',
                                width: '100%'
                              })(
                                $Baseline({
                                  markers: just([] as IMarker[]),
                                  chartConfig: {
                                    leftPriceScale: {
                                      visible: false,
                                      scaleMargins: { top: 0.1, bottom: 0.1 }
                                    },
                                    crosshair: {
                                      horzLine: { visible: false },
                                      vertLine: { visible: false }
                                    },
                                    timeScale: { visible: false }
                                  },
                                  data: pos.pnlTimeline as any as BaselineData<ISeriesTime>[],
                                  baselineOptions: {
                                    baseValue: { price: 0, type: 'price' },
                                    lineWidth: 1,
                                    lineType: LineType.Curved,
                                    autoscaleInfoProvider: floorAutoscaleByAum(Number(pos.allocated) / 10 ** desc.decimals)
                                  }
                                })({})
                              ),
                              $row(
                                style({
                                  position: 'absolute',
                                  background: `linear-gradient(to right, ${palette.background} 0%, ${palette.background} 32%, transparent 100%)`,
                                  inset: 0,
                                  zIndex: 1,
                                  alignItems: 'center',
                                  paddingLeft: '4px',
                                  pointerEvents: 'none'
                                })
                              )($value)
                            )
                          })
                        }
                      ] as TableColumn<I$LeaderboardCellData>[]
                    })({
                      scrollRequest: scrollRequestTether(),
                      sortBy: changeMastersSortTether(
                        sampleMap((current: IMastersSort, next: { direction: 'asc' | 'desc'; selector: string }) => {
                          const selector = next.selector as IMastersSort['selector']
                          return selector === current.selector
                            ? { direction: current.direction === 'asc' ? 'desc' : 'asc', selector }
                            : { direction: current.direction, selector }
                        }, mastersSort)
                      )
                    })
                  },
                  combine({
                    performanceMetric,
                    activityTimeframe,
                    account,
                    collateralTokenList,
                    registry,
                    sort: mastersSort
                  })
                )
              }, leaderboardView)
            )
          )
        ),

        {
          changeActivityTimeframe,
          selectCollateralTokenList: merge(
            selectCollateralTokenList,
            toggleCollateral,
            constant([] as Address[], clearCollateralFilter),
            constant([] as Address[], clearAllFilters)
          ),
          selectIndexTokenList,
          changeMatchRuleList
        }
      ]
    }
  )
