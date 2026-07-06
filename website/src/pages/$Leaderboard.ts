import { HUB_CHAIN_ID, PRECISION, PROTOCOL } from '@puppet/contracts/const'
import { BYTES32_ZERO, IntervalTime, PLATFORM_STAT_INTERVAL } from '@puppet/sdk/const'
import {
  getMappedValue,
  readableFactorPercentage,
  readablePnl,
  readableTokenAmount,
  readableUsd
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { tokenInfoFor } from '@puppet/sdk/state'
import {
  combine,
  constant,
  debounce,
  empty,
  filter,
  fromPromise,
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
  take
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, $Tooltip, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type BaselineData, LineType } from 'lightweight-charts'
import { getAddress, isAddress, isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import {
  $Baseline,
  $ButtonCircular,
  $ButtonSecondary,
  $ButtonToggle,
  $caretDown,
  $DropSelect,
  $defaultDropSelectAnchor,
  $defaultMiniButtonSecondary,
  $defaultTableCell,
  $defaultTableContainer,
  $defaultTableRowContainer,
  $defaultTextFieldContainer,
  $errorCard,
  $FieldLabeled,
  $fundCompositionGauge,
  $icon,
  $spinner,
  $Table,
  $tokenLabelFromSummary,
  $xCross,
  floorAutoscaleByAum,
  type IMarker,
  type IPageRequest,
  type ISeriesTime,
  type ISortBy,
  type TableColumn
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import {
  $leverage,
  $MasterDisplay,
  $pnlDisplay,
  $route,
  $tokenIcon,
} from '../common/$common.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $card2 } from '../common/elements/$common.js'
import { $bagOfCoins, $trophy } from '../common/elements/$icons.js'
import { $accountLabel, fundRankTraits, readableAccountName } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import {
  activityOptionLabelMap,
  activityOptionPeriodLabelMap,
  activityOptionShortLabelMap
} from '../components/$LastActivity.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import { $SubscribeEditor } from '../components/portfolio/$SubscribeEditor.js'
import context from '../io/context.js'
import {
  fetchGmxTraderLeaderboardPage,
  fetchLeaderboardPage,
  type IGmxTraderRow,
  type ILeaderboardRow,
  type ILeaderboardView,
  type IPerformanceMetric
} from '../io/datastore/query.js'
import { fundRank } from '../io/datastore/reads.js'
import { livePlatformScale } from '../io/live.js'
import { $separator2 } from './common.js'
import type { IPageFilterParams } from './types.js'

const $leaderboardTableContainer = $defaultTableContainer(
  style({
    backgroundColor: palette.background,
    borderTop: `1px solid ${colorShade(palette.foreground, 40)}`,
    padding: isDesktopScreen ? '24px 36px 36px' : '12px'
  })
)

const $leaderboardCell = $defaultTableCell(style({ padding: '0', height: '60px' }))

const $leaderboardLoader = style({
  placeContent: 'center',
  margin: '0 1px',
  background: palette.background,
  flexDirection: 'row-reverse',
  padding: '16px 0'
})($spinner)

const $activityHead = (metricLabel: string, timeframe: IntervalTime): I$Node =>
  $row(spacing.small, style({ flex: 1, placeContent: 'space-between', alignItems: 'center' }))(
    $text(metricLabel),
    $node(style({ textAlign: 'right', alignSelf: 'center', color: palette.foreground }))(
      $text(`${getMappedValue(activityOptionShortLabelMap, timeframe)} activity`)
    )
  )

const $timelineCell = ($value: I$Node, timeline: readonly unknown[], autoscaleFloor: number): I$Node => {
  if (timeline.length === 0) {
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
          leftPriceScale: { visible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
          crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
          timeScale: { visible: false }
        },
        data: timeline as any as BaselineData<ISeriesTime>[],
        baselineOptions: {
          baseValue: { price: 0, type: 'price' },
          lineWidth: 1,
          lineType: LineType.Curved,
          autoscaleInfoProvider: floorAutoscaleByAum(autoscaleFloor)
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
}

interface I$Leaderboard extends IPageFilterParams {
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  draftMatchingRuleList: IStream<ISubscribeRule[]>
}

type IMastersSort = { direction: 'asc' | 'desc'; selector: 'allocated' | IPerformanceMetric }
type IShadowSort = { direction: 'asc' | 'desc'; selector: 'size' | 'pnlroi' }

export const $Leaderboard = (config: I$Leaderboard) =>
  component(
    (
      [scrollRequest, scrollRequestTether]: IBehavior<IPageRequest>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,

      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,

      [filterAccount, filterAccountTether]: IBehavior<string | undefined>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [changeMastersSort, changeMastersSortTether]: IBehavior<
        { direction: 'asc' | 'desc'; selector: string },
        IMastersSort
      >,
      [toggleCollateral, toggleCollateralTether]: IBehavior<INode, Address[]>,
      [clearCollateralFilter, clearCollateralFilterTether]: IBehavior<PointerEvent>,
      [clearAllFilters, clearAllFiltersTether]: IBehavior<PointerEvent>,
      [clickFilters, clickFiltersTether]: IBehavior<PointerEvent>,
      [selectLeaderboardView, selectLeaderboardViewTether]: IBehavior<ILeaderboardView>,
      [changeSort, changeSortTether]: IBehavior<{ direction: 'asc' | 'desc'; selector: string }, IShadowSort>
    ) => {
      const { activityTimeframe, collateralTokenList, userMatchingRuleQuery, draftMatchingRuleList } = config

      const performanceMetric = op(
        uiStorage.replayWrite(localStoreSchema.leaderboard.performanceMetric, changePerformanceMetric),
        state()
      )
      const account = op(
        uiStorage.replayWrite(
          localStoreSchema.leaderboard.account,
          merge(filterAccount, constant(undefined, clearAllFilters))
        ),
        state()
      )
      const mastersSort = op(
        start({ direction: 'desc', selector: 'realisedPnl' } as IMastersSort, changeMastersSort),
        state()
      )
      const leaderboardView = op(
        uiStorage.replayWrite(
          localStoreSchema.leaderboard.view,
          merge(selectLeaderboardView, constant('masters' as ILeaderboardView, clearAllFilters))
        ),
        state()
      )
      const shadowSort = op(start({ direction: 'desc', selector: 'size' } as IShadowSort, changeSort), state())
      const paging = start({ offset: 0, pageSize: 20 } as IPageRequest, scrollRequest)
      const registry = fromPromise(context.getTokenRegistry())

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
          $column(style({ placeSelf: 'center', margin: 'auto', alignItems: 'center', padding: '24px 0', width: '100%' }))(
            $errorCard(error)
          )

        return { $emptyMessage, $$fail }
      }

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

          const hasFilter = op(
            account,
            map(a => Boolean(a)),
            skipRepeats
          )

          return [
            $row(spacing.small, style({ alignItems: 'center' }))(
              $FieldLabeled({
                label: null,
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

      const $advancedFilters = $Popover({
        $open: constant(
          $column(spacing.default, style({ minWidth: '280px' }))(
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
              $node(style({ color: palette.foreground, fontSize: '0.85rem' }))($text('Collateral')),
              $SelectCollateralToken({
                selectedList: collateralTokenList,
                tokenList: fromPromise(
                  context
                    .getTokenRegistry()
                    .then(reg =>
                      [...(reg.get(HUB_CHAIN_ID)?.values() ?? [])].map(i => i.token).filter(t => t !== PROTOCOL.nativeToken)
                    )
                )
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

      const $shadowTable = switchMap(
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
            $container: $leaderboardTableContainer,
            $cell: $leaderboardCell,
            scrollConfig: {
              $loader: $leaderboardLoader,
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
                $head: $activityHead(
                  params.metric === 'navPerShare' ? 'ROI % / PnL $' : 'PnL $ / ROI %',
                  params.activityTimeframe
                ),
                sortBy: 'pnlroi',
                gridTemplate: isDesktopScreen ? 'minmax(0, 1fr)' : '220px',
                $bodyCallback: map((row: I$ShadowCellData) => {
                  const roi =
                    row.collateralUsd === 0n
                      ? 0n
                      : (row.realisedPnlUsd * PRECISION.floatPrecisionExp) / row.collateralUsd
                  const roiColor =
                    row.collateralUsd === 0n ? palette.foreground : roi >= 0n ? palette.positive : palette.negative
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

                  return $timelineCell(
                    $value,
                    row.pnlTimeline,
                    Number(row.collateralUsd) / Number(PRECISION.floatPrecisionExp)
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
        combine({ activityTimeframe, account, collateralTokenList, sort: shadowSort, metric: performanceMetric })
      )

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
              $advancedFilters,

              $DropSelect({
                value: activityTimeframe,
                optionList: [...PLATFORM_STAT_INTERVAL],
                $anchor: $defaultDropSelectAnchor(style({ borderRadius: '100px' })),
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
              map(
                (view: ILeaderboardView) =>
                  view === 'shadow'
                    ? $shadowTable
                    : switchMap(
                        params => {
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
                            $container: $leaderboardTableContainer,
                            $cell: $leaderboardCell,
                            scrollConfig: {
                              $loader: $leaderboardLoader,
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
                                  const avatarSeed = (pos.shareToken ?? pos.fund) as Address
                                  const $master = $MasterDisplay({
                                    address: pos.fund as Address,
                                    ensName: readableAccountName(pos.name),
                                    avatarSeed: pos.shareToken ?? undefined,
                                    traits: fundRankTraits(pos.name, avatarSeed, fundRank(pos, params.platformScale)),
                                    puppetList: pos.puppetList,
                                    profileSize: isDesktopScreen ? 50 : 32
                                  })({})
                                  // The profile rides INSIDE the editor's popover anchor ($lead): the open backdrop
                                  // highlights trader + button together, while only the Follow button triggers.
                                  return $SubscribeEditor({
                                    master: pos.master,
                                    name: pos.name ?? BYTES32_ZERO,
                                    baseToken: pos.baseToken,
                                    userMatchingRuleQuery,
                                    draftMatchingRuleList,
                                    $lead: style({ display: 'flex', flex: 1, minWidth: '0', overflow: 'hidden' })($master)
                                  })({ changeMatchRuleList: changeMatchRuleListTether() })
                                })
                              },
                              {
                                $head: $text('Token'),
                                gridTemplate: isDesktopScreen ? '104px' : '58px',
                                $bodyCallback: map((pos: I$LeaderboardCellData) => {
                                  const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseToken).token
                                  return $route(getTokenDescription(token), isDesktopScreen)
                                })
                              },
                              {
                                $head: $activityHead(
                                  params.performanceMetric === 'navPerShare' ? 'ROI % / AUM' : 'PnL $ / AUM',
                                  params.activityTimeframe
                                ),
                                sortBy: params.performanceMetric,
                                gridTemplate: isDesktopScreen ? 'minmax(0, 1fr)' : '220px',
                                $bodyCallback: map(pos => {
                                  const isNav = params.performanceMetric === 'navPerShare'
                                  const navReturn =
                                    (Number(pos.navPerShare) / Number(PRECISION.floatPrecisionExp / PRECISION.sharePrecisionExp) - 1) * 100
                                  const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseToken).token
                                  const desc = getTokenDescription(token)
                                  const $primary = isNav
                                    ? $node(
                                        style({
                                          fontWeight: 'bold',
                                          color: navReturn >= 0 ? palette.positive : palette.negative
                                        })
                                      )($text(`${navReturn >= 0 ? '+' : ''}${navReturn.toFixed(2)}%`))
                                    : $pnlDisplay(pos.realisedPnl + pos.openPnl)
                                  const aum = (pos.totalShareSupply * pos.navPerShare) / PRECISION.floatPrecisionExp
                                  const redemptions = (pos.queuedShares * pos.navPerShare) / PRECISION.floatPrecisionExp
                                  const $value = $column(
                                    spacing.tiny,
                                    style({ alignItems: 'flex-start', placeContent: 'center', whiteSpace: 'nowrap' })
                                  )(
                                    $primary,
                                    $fundCompositionGauge({
                                      utilized: pos.allocated,
                                      liquid: aum - pos.allocated - redemptions,
                                      redemptions
                                    }),
                                    $node(style({ color: palette.message, fontSize: '0.85em' }))(
                                      $text(readableTokenAmount(desc, pos.allocated))
                                    )
                                  )

                                  return $timelineCell(
                                    $value,
                                    pos.pnlTimeline,
                                    Number(pos.allocated) / 10 ** desc.decimals
                                  )
                                })
                              }
                            ] as TableColumn<I$LeaderboardCellData>[]
                          })({
                            scrollRequest: scrollRequestTether(),
                            sortBy: changeMastersSortTether(
                              sampleMap(
                                (current: IMastersSort, next: { direction: 'asc' | 'desc'; selector: string }) => {
                                  const selector = next.selector as IMastersSort['selector']
                                  return selector === current.selector
                                    ? { direction: current.direction === 'asc' ? 'desc' : 'asc', selector }
                                    : { direction: current.direction, selector }
                                },
                                mastersSort
                              )
                            )
                          })
                        },
                        combine({
                          performanceMetric,
                          activityTimeframe,
                          account,
                          collateralTokenList,
                          registry,
                          platformScale: livePlatformScale,
                          sort: mastersSort
                        })
                      ),
                leaderboardView
              )
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
          changeMatchRuleList
        }
      ]
    }
  )
