import { FLOAT_PRECISION, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type IntervalTime, PLATFORM_STAT_INTERVAL, USD_DECIMALS } from '@puppet/sdk/const'
import {
  formatFixed,
  getMappedValue,
  getUnixTimestamp,
  readableFactorPercentage,
  readablePnl,
  readableTokenAmount,
  readableUsd,
  resampleTimeSeries
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { tokenInfoFor } from '@puppet/sdk/state'
import {
  combine,
  type IStream,
  just,
  map,
  merge,
  op,
  sampleMap,
  start,
  switchLatest,
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, $Tooltip, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type BaselineData, LineType } from 'lightweight-charts'
import { getAddress, isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import {
  $Baseline,
  $ButtonToggle,
  $DropSelect,
  $defaultDropSelectContainer,
  $defaultTableCell,
  $defaultTableContainer,
  $defaultTableRowContainer,
  $icon,
  $spinner,
  $Table,
  $tokenLabelFromSummary,
  type IMarker,
  type IPageRequest,
  type ISeriesTime,
  type ISortBy,
  type TableColumn
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { $leverage, $MasterDisplay, $pnlDisplay, $route, $tokenIcon } from '../common/$common.js'
import { $card2 } from '../common/elements/$common.js'
import { $bagOfCoins, $trophy } from '../common/elements/$icons.js'
import { $AccountLabel, $profileAvatar, readableAccountName } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import { activityOptionLabelMap, activityOptionShortLabelMap } from '../components/$LastActivity.js'
import { $AllocationEditor } from '../components/portfolio/$AllocationEditor.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
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

export const $Leaderboard = (config: I$Leaderboard) =>
  component(
    (
      [scrollRequest, scrollRequestTether]: IBehavior<IPageRequest>,
      [selectLeaderboardView, selectLeaderboardViewTether]: IBehavior<ILeaderboardView>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,

      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, selectIndexTokenListTether]: IBehavior<Address[]>,

      [filterAccount, _filterAccountTether]: IBehavior<string | undefined>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [changeSort, changeSortTether]: IBehavior<{ direction: 'asc' | 'desc'; selector: string }, IShadowSort>,
      [toggleCollateral, toggleCollateralTether]: IBehavior<INode, Address[]>
    ) => {
      const { activityTimeframe, collateralTokenList, userMatchingRuleQuery, draftMatchingRuleList } = config

      const leaderboardView = uiStorage.replayWrite(localStoreSchema.leaderboard.view, selectLeaderboardView)
      const performanceMetric = uiStorage.replayWrite(
        localStoreSchema.leaderboard.performanceMetric,
        changePerformanceMetric
      )
      const account = uiStorage.replayWrite(localStoreSchema.leaderboard.account, filterAccount)
      const shadowSort = op(uiStorage.replayWrite(localStoreSchema.leaderboard.shadowSort, changeSort), state())
      const paging = start({ offset: 0, pageSize: 20 }, scrollRequest)
      const registry = switchPromises(context.tokenRegistryQuery)

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
              $ButtonToggle({
                value: leaderboardView,
                optionList: ['masters', 'shadow'] satisfies ILeaderboardView[],
                $$option: map((view: ILeaderboardView) =>
                  $node(style({ whiteSpace: 'nowrap' }))($text(view === 'masters' ? 'Accounts' : 'Shadow'))
                )
              })({ select: selectLeaderboardViewTether() }),

              $SelectCollateralToken({
                selectedList: collateralTokenList,
                tokenList: switchPromises(context.registeredCollateralListQuery)
              })({
                changeCollateralTokenList: selectCollateralTokenListTether()
              }),

              $ButtonToggle({
                value: performanceMetric,
                optionList: ['navPerShare', 'realisedPnl'] as IPerformanceMetric[],
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
              })({ select: changePerformanceMetricTether() }),

              $DropSelect({
                value: activityTimeframe,
                optionList: [...PLATFORM_STAT_INTERVAL],
                $anchor: $defaultDropSelectContainer(style({ borderRadius: '100px' })),
                closeOnSelect: true,
                $valueLabel: map(tf =>
                  $node(style({ whiteSpace: 'nowrap' }))($text(getMappedValue(activityOptionShortLabelMap, tf)))
                ),
                $$option: map(tf => $node($text(getMappedValue(activityOptionLabelMap, tf))))
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
                          })($spinner)
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
                                $profileAvatar({ address, size: isDesktopScreen ? 50 : 32 }),
                                $AccountLabel({ address })
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
                            $head: $stackHead(
                              params.metric === 'navPerShare' ? 'ROI %' : 'PnL $',
                              params.metric === 'navPerShare' ? 'PnL $' : 'ROI %'
                            ),
                            sortBy: 'pnlroi',
                            gridTemplate: isDesktopScreen ? '120px' : '100px',
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
                              return $column(
                                spacing.tiny,
                                style({ alignItems: 'flex-end', placeContent: 'center', flex: 1 })
                              )(
                                showRoiPrimary ? $primaryRoi : $pnlDisplay(row.realisedPnlUsd),
                                $separator2,
                                showRoiPrimary ? $secondaryPnl : $secondaryRoi
                              )
                            })
                          },
                          {
                            $head: $node(style({ flex: 1, textAlign: 'right' }))(
                              $text(`Last ${getMappedValue(activityOptionLabelMap, params.activityTimeframe)} activity`)
                            ),
                            gridTemplate: isDesktopScreen ? 'minmax(120px, 1fr)' : '120px',
                            $bodyCallback: map((row: I$ShadowCellData) => {
                              if (row.pnlTimeline.length === 0) {
                                return $row(style({ alignItems: 'center', placeContent: 'flex-end', flex: 1 }))(
                                  $node(style({ color: palette.foreground }))($text('No activity'))
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
                                      lineType: LineType.Curved
                                    }
                                  })({})
                                )
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

                return switchMap(params => {
                  const dataSource = map(async filterParams => {
                    const metricList = await fetchLeaderboardPage({
                      activityTimeframe: params.activityTimeframe,
                      account: params.account as Address | undefined,
                      collateralTokenList: params.collateralTokenList as Address[],
                      sortBy: { direction: 'desc', selector: params.performanceMetric },
                      paging: { pageSize: filterParams.paging.pageSize, offset: filterParams.paging.offset }
                    })
                    return { ...filterParams.paging, page: metricList, $items: metricList }
                  }, combine({ paging }))

                  type I$LeaderboardCellData = ILeaderboardRow

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
                      })($spinner)
                    },
                    sortBy: { direction: 'desc', selector: params.performanceMetric },
                    dataSource,
                    columns: [
                      {
                        $head: $text('Master'),
                        gridTemplate: isDesktopScreen ? '149px' : '136px',
                        $bodyCallback: map(pos => {
                          return $MasterDisplay({
                            address: pos.master,
                            ensName: readableAccountName(pos.name),
                            puppetList: pos.puppetList
                          })({})
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
                      ...((isDesktopScreen
                        ? [
                            {
                              $head: $text('AUM'),
                              gridTemplate: '120px',
                              $bodyCallback: map((pos: I$LeaderboardCellData) => {
                                const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseTokenId).token
                                const desc = getTokenDescription(token)
                                return $row(style({}))($text(readableTokenAmount(desc, pos.allocated)))
                              })
                            }
                          ]
                        : []) as TableColumn<I$LeaderboardCellData>[]),
                      {
                        $head: $row(
                          spacing.small,
                          style({ flex: 1, placeContent: 'space-between', alignItems: 'center' })
                        )(
                          $text(params.performanceMetric === 'navPerShare' ? 'Performance' : 'Realised PnL'),
                          $node(style({ textAlign: 'right', alignSelf: 'center' }))(
                            $text(`${getMappedValue(activityOptionLabelMap, params.activityTimeframe)} Activity`)
                          )
                        ),
                        gridTemplate: isDesktopScreen ? 'minmax(0, 1fr)' : undefined,
                        $bodyCallback: map(pos => {
                          const isNav = params.performanceMetric === 'navPerShare'
                          const endTime = getUnixTimestamp()
                          const startTime = endTime - params.activityTimeframe
                          const timeline = isNav
                            ? pos.navTimeline
                            : resampleTimeSeries({
                                sourceList: [
                                  { value: 0n, time: startTime },
                                  ...pos.pnlList
                                    .map((pnl: bigint, index: number) => ({
                                      value: pnl,
                                      time: pos.pnlTimestampList[index]
                                    }))
                                    .filter((item: { value: bigint; time: number }) => item.time > startTime),
                                  { value: pos.pnlList[pos.pnlList.length - 1] ?? 0n, time: endTime }
                                ],
                                getTime: item => item.time,
                                sourceMap: next => formatFixed(USD_DECIMALS, next.value)
                              })

                          const navReturn = (Number(formatFixed(USD_DECIMALS, pos.navPerShare)) - 1) * 100
                          const $value = isNav
                            ? $node(style({ color: navReturn >= 0 ? palette.positive : palette.negative }))(
                                $text(`${navReturn >= 0 ? '+' : ''}${navReturn.toFixed(2)}%`)
                              )
                            : $pnlDisplay(pos.realisedPnl)

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
                                data: timeline as any as BaselineData<ISeriesTime>[],
                                baselineOptions: {
                                  baseValue: { price: isNav ? 1 : 0, type: 'price' },
                                  lineWidth: 1,
                                  lineType: LineType.Curved
                                }
                              })({})
                            ),
                            $row(
                              style({
                                position: 'absolute',
                                background: `linear-gradient(to right, ${palette.background} 0%, ${palette.background} 23%, transparent 100%)`,
                                inset: 0,
                                zIndex: 1,
                                alignItems: 'center'
                              })
                            )($value)
                          )
                        })
                      },
                      {
                        $head: $text('Allocate'),
                        gridTemplate: isDesktopScreen ? '140px' : '120px',
                        $bodyCallback: map((pos: I$LeaderboardCellData) => {
                          const token = tokenInfoFor(params.registry, HUB_CHAIN_ID, pos.baseTokenId).token
                          return $AllocationEditor({
                            master: pos.master,
                            collateralToken: token,
                            userMatchingRuleQuery,
                            draftMatchingRuleList
                          })({ changeMatchRuleList: changeMatchRuleListTether() })
                        })
                      }
                    ] as TableColumn<I$LeaderboardCellData>[]
                  })({
                    scrollRequest: scrollRequestTether()
                  })
                }, combine({ performanceMetric, activityTimeframe, account, collateralTokenList, registry }))
              }, leaderboardView)
            )
          )
        ),

        {
          changeActivityTimeframe,
          selectCollateralTokenList: merge(selectCollateralTokenList, toggleCollateral),
          selectIndexTokenList,
          changeMatchRuleList
        }
      ]
    }
  )
