import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import {
  formatFixed,
  getEtherscanMultichainUrl,
  getUnixTimestamp,
  pagingQuery,
  readableAddress,
  readableUnitAmount,
  readableUsd
} from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  combine,
  constant,
  empty,
  type IStream,
  just,
  map,
  merge,
  nowWith,
  op,
  start,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'

import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { pushUrl } from 'aelea/ui-router'
import type { Address } from 'viem/accounts'
import {
  $anchor,
  $arrowRight,
  $ButtonSecondary,
  $external,
  $icon,
  $infoLabel,
  $infoTooltip,
  $intermediatePromise,
  $spinner,
  $Table,
  type IPageRequest,
  type ISortBy,
  text
} from '@/ui-components'
import { $drawdownDisplay, $errorWithRetry } from '../common/$common.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card, $responsiveFlex } from '../common/elements/$common.js'
import { $accountLabel, readableAccountName } from '../components/$AccountProfile.js'
import { $MasterRouteTimeline } from '../components/participant/$ProfilePeformanceTimeline.js'
import { $defaultFundEditorContainer, $FundEditor } from '../components/portfolio/$FundEditor.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import { entryColumn, pnlColumn, puppetsColumn, sizeColumn, timeColumn } from '../components/table/$TableColumn.js'
import * as context from '../io/context.js'
import {
  fetchMasterPoolState,
  fetchMasterRouteMetricList,
  fetchMasterSubscribers,
  fetchPositionDecreaseList,
  fetchPositionIncreaseList
} from '../io/indexer/query.js'
import { accountSettledPositionListSummary, aggregatePositionList } from './common'
import type { IPageFilterParams } from './types.js'

interface I$MasterPage extends IPageFilterParams {
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  draftMatchingRuleList: IStream<ISubscribeRule[]>
}

export const $MasterPage = ({
  activityTimeframe,
  collateralTokenList,
  indexTokenList,
  userMatchingRuleQuery,
  draftMatchingRuleList
}: I$MasterPage) =>
  component(
    (
      [scrollRequest, scrollRequestTether]: IBehavior<IPageRequest>,
      [sortByChange, _sortByChangeTether]: IBehavior<ISortBy>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, selectIndexTokenListTether]: IBehavior<Address[]>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      // Retry control for the position-history fetch. A PointerEvent behavior (so a $Button
      // `click` output tethers in directly) mapped to the default sortBy and merged into
      // `sortByChange`, which re-emits through `sortBy` and re-runs the `pageParams` fetch.
      [retryPositions, retryPositionsTether]: IBehavior<PointerEvent>
    ) => {
      const defaultSortBy: ISortBy = { direction: 'desc', selector: 'openTimestamp' }
      const sortBy = state(defaultSortBy, merge(sortByChange, constant(defaultSortBy, retryPositions)))

      const urlFragments = document.location.pathname.split('/')
      const fund = urlFragments[urlFragments.length - 1].toLowerCase() as Address

      const routeMetricListQuery = op(
        combine({ activityTimeframe, collateralTokenList, indexTokenList }),
        map(async params =>
          fetchMasterRouteMetricList({
            fund,
            activityTimeframe: params.activityTimeframe,
            collateralTokenList: params.collateralTokenList
          })
        ),
        multicast
      )

      const metricsQuery = op(
        routeMetricListQuery,
        map(async metricList => accountSettledPositionListSummary(fund, await metricList)),
        multicast
      )

      const subscribersQuery = just(fetchMasterSubscribers(fund))
      const fundStateQuery = just(fetchMasterPoolState(fund))

      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)

      const aumUsdQuery = op(
        combine({ routes: routeMetricListQuery, registry: tokenRegistryValue }),
        map(async p => {
          const routes = await p.routes
          let usd = 0
          for (const route of routes) {
            const info = p.registry.get(HUB_CHAIN_ID)?.get(route.baseTokenId)
            if (info) usd += formatFixed(getTokenDescription(info.token).decimals, route.allocated)
          }
          return usd
        }),
        multicast
      )

      const pageParams = map(params => {
        const since = getUnixTimestamp() - params.activityTimeframe
        const pageQuery = Promise.all([
          params.routeMetricListQuery,
          fetchPositionIncreaseList({ account: fund, collateralTokenList: params.collateralTokenList, since }),
          fetchPositionDecreaseList({ account: fund, collateralTokenList: params.collateralTokenList, since })
        ])
        return pageQuery.then(([routeMetricList, increaseList, decreaseList]) => {
          const openPositionList = aggregatePositionList([...increaseList, ...decreaseList])
          return { ...params, routeMetricList, openPositionList }
        })
      }, combine({ sortBy, activityTimeframe, collateralTokenList, routeMetricListQuery }))

      const $sectionLabel = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500', letterSpacing: '0.5px' }))(
          $text(label)
        )

      const $metric = (label: string, $value: I$Node): I$Node => $column(spacing.tiny)($infoLabel($text(label)), $value)

      const $metricsLead = $intermediatePromise({
        $display: map(
          async p => {
            const summary = await p.metrics
            const aum = await p.aum
            return $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'flex-start' }))(
              $metric(
                'Win / Loss',
                $node(style({ fontWeight: '700', color: palette.message }))(
                  $text(`${summary.winCount} / ${summary.lossCount}`)
                )
              ),
              $metric(
                'Allocated',
                $node(style({ fontWeight: '700', color: palette.message }))($text(`$${readableUnitAmount(aum)}`))
              ),
              $metric(
                'Realised PnL',
                $node(
                  style({ fontWeight: '700', color: summary.realisedPnl >= 0n ? palette.positive : palette.negative })
                )($text(readableUsd(summary.realisedPnl)))
              )
            )
          },
          combine({ metrics: metricsQuery, aum: aumUsdQuery })
        )
      })

      const $vitals = $intermediatePromise({
        $display: map(
          async p => {
            const summary = await p.metrics
            const subs = await p.subs
            const aum = await p.aum
            const realisedUsd = formatFixed(USD_DECIMALS, summary.realisedPnl)
            const roi = aum > 0 ? (realisedUsd / aum) * 100 : 0
            const totalTrades = summary.winCount + summary.lossCount
            const winRate = totalTrades > 0 ? (summary.winCount / totalTrades) * 100 : 0

            // Max drawdown: largest peak-to-trough decline of the running cumulative
            // PnL over the timeframe, expressed in bps (2500 = 25%) relative to AUM.
            // Worst trade: the single most negative realised PnL in the timeline.
            let cumulative = 0n
            let peak = 0n
            let maxDrawdown = 0n
            let worstTrade = 0n
            for (const point of summary.pnlTimeline) {
              if (point.value < worstTrade) worstTrade = point.value
              cumulative += point.value
              if (cumulative > peak) peak = cumulative
              const decline = peak - cumulative
              if (decline > maxDrawdown) maxDrawdown = decline
            }
            const maxDrawdownUsd = formatFixed(USD_DECIMALS, maxDrawdown)
            const drawdownBps = aum > 0 ? BigInt(Math.round((maxDrawdownUsd / aum) * 10000)) : 0n

            const $value = (label: string, $v: I$Node, tooltip?: string) =>
              $column(spacing.tiny)(
                tooltip
                  ? $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $infoLabel($text(label)),
                      $infoTooltip(tooltip, palette.foreground, '16px')
                    )
                  : $infoLabel($text(label)),
                $node(style({ fontWeight: '700' }))($v)
              )
            return $row(spacing.big, style({ flexWrap: 'wrap', rowGap: '12px' }))(
              $value('AUM', $node(style({ color: palette.message }))($text(`$${readableUnitAmount(aum)}`))),
              $value(
                'ROI',
                $node(style({ color: roi >= 0 ? palette.positive : palette.negative }))($text(`${roi.toFixed(1)}%`)),
                'ROI = realised PnL / AUM. Total return over the selected timeframe relative to capital trusted by backers.'
              ),
              $value(
                'Max drawdown',
                $drawdownDisplay(drawdownBps),
                'Max drawdown = the largest peak-to-trough decline of cumulative PnL over the timeframe, as a share of AUM. Lower is better.'
              ),
              $value(
                'Worst trade',
                $node(style({ color: worstTrade < 0n ? palette.negative : palette.message }))(
                  $text(readableUsd(worstTrade))
                )
              ),
              $value('Win rate', $node(style({ color: palette.message }))($text(`${winRate.toFixed(0)}%`))),
              $value('Subscribers', $node(style({ color: palette.message }))($text(`${subs.length}`)))
            )
          },
          combine({ metrics: metricsQuery, subs: subscribersQuery, aum: aumUsdQuery })
        )
      })

      const $identityHeader = (accountName?: string) =>
        $column(spacing.tiny)(
          $heading3($accountLabel({ address: fund, ensName: accountName })),
          // Show the truncated 0x address as a secondary, verifiable identifier when a name is set,
          // alongside the 'View on explorer' link.
          $row(spacing.small, style({ alignItems: 'center' }))(
            accountName
              ? $node(style({ color: palette.foreground, fontSize: text.sm }))($text(readableAddress(fund)))
              : empty,
            $anchor(
              attr({ href: getEtherscanMultichainUrl(fund), target: '_blank' }),
              style({ color: palette.foreground, fontSize: text.sm })
            )($text('View on explorer'), $icon({ $content: $external, width: '11px' }))
          )
        )

      const $profileOverview = $column(spacing.default)(
        $row(spacing.default, style({ alignItems: 'center' }))(
          $roboAvatar(fund, 56),
          $intermediatePromise({
            $loader: $identityHeader(),
            $display: map(
              async fundStateFuture => $identityHeader(readableAccountName((await fundStateFuture)?.name)),
              fundStateQuery
            )
          })
        ),
        $vitals,
        $sectionLabel('Fund this trader'),
        $intermediatePromise({
          $display: map(
            async p => {
              const fundState = await p.fund
              if (!fundState) return $infoLabel($text('Fund not found'))
              const info = p.registry.get(HUB_CHAIN_ID)?.get(fundState.baseTokenId)
              if (!info) return $infoLabel($text('Unsupported collateral'))
              return $FundEditor({
                collateralToken: info.token,
                userMatchingRuleQuery,
                draftMatchingRuleList,
                master: fund,
                prominent: true,
                $container: $defaultFundEditorContainer(style({ marginLeft: '-12px' }))
              })({
                changeMatchRuleList: changeMatchRuleListTether()
              })
            },
            combine({ fund: fundStateQuery, registry: tokenRegistryValue })
          )
        })
      )

      const $puppetDistribution = $column(
        spacing.default,
        style({ flex: 1, backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px' })
      )(
        $sectionLabel('Puppet distribution'),
        $intermediatePromise({
          $display: map(async subscribersFuture => {
            const subscribers = await subscribersFuture
            if (subscribers.length === 0) {
              return $node(style({ color: palette.foreground, fontSize: text.sm }))($text('No subscribers yet'))
            }
            const total = subscribers.reduce((acc, s) => acc + s.signedBalance, 0n)
            const ranked = [...subscribers].sort((a, b) => (b.signedBalance > a.signedBalance ? 1 : -1))
            return $column(spacing.default)(
              ...ranked.map(s => {
                const share = total > 0n ? Number((s.signedBalance * 10000n) / total) / 100 : 0
                return $column(spacing.tiny)(
                  $row(spacing.small, style({ alignItems: 'center' }))(
                    $roboAvatar(s.puppet, 26),
                    $node(style({ fontSize: text.sm, color: palette.message }))($text(readableAddress(s.puppet))),
                    $node(style({ flex: 1 }))(),
                    $node(style({ fontSize: text.sm, color: palette.foreground }))($text(`${share.toFixed(1)}%`))
                  ),
                  $node(
                    style({ height: '4px', borderRadius: '4px', backgroundColor: colorShade(palette.foreground, 20) })
                  )(
                    $node(
                      style({
                        height: '4px',
                        borderRadius: '4px',
                        width: `${share}%`,
                        backgroundColor: palette.primary
                      })
                    )()
                  )
                )
              })
            )
          }, subscribersQuery)
        })
      )

      const $hero = $node(
        style({
          position: 'relative',
          width: '100%',
          backgroundColor: palette.middleground,
          overflow: 'hidden',
          ...(isDesktopScreen ? { height: '480px' } : {})
        })
      )(
        $node(
          style({
            position: 'relative',
            width: '100%',
            maxWidth: '1400px',
            margin: '0 auto',
            ...(isDesktopScreen ? { height: '100%' } : {})
          })
        )(
          $MasterRouteTimeline({
            activityTimeframe,
            collateralTokenList,
            indexTokenList,
            metricsQuery,
            chartHeight: isDesktopScreen ? '480px' : '300px',
            $lead: $row(style({ flex: 1, pointerEvents: 'all' }))($metricsLead)
          })({
            selectCollateralTokenList: selectCollateralTokenListTether(),
            selectIndexTokenList: selectIndexTokenListTether(),
            changeActivityTimeframe: changeActivityTimeframeTether()
          }),
          isDesktopScreen
            ? $node(
                style({
                  position: 'absolute',
                  inset: '0',
                  zIndex: 10,
                  pointerEvents: 'none',
                  background: `linear-gradient(to right, ${palette.middleground} 0%, ${palette.middleground} 22%, transparent 52%)`
                })
              )()
            : empty,
          $card(
            style({
              padding: '24px',
              zIndex: 20,
              border: `1px solid ${colorShade(palette.foreground, 15)}`,
              ...(isDesktopScreen
                ? { position: 'absolute', bottom: '36px', left: '20px', width: '440px', maxWidth: 'calc(100% - 40px)' }
                : { margin: '12px' })
            })
          )($profileOverview)
        )
      )

      const $positionHistory = $column(
        spacing.default,
        style({ flex: 1, minWidth: 0, backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px' })
      )(
        $sectionLabel('Position History'),
        $intermediatePromise({
          $loader: $spinner,
          // The outer promise resolves the on-chain position fetch (fetchPositionIncrease/DecreaseList),
          // so it can network-fail. Render the shared $errorCard with a Retry that re-emits sortBy to
          // re-run `pageParams` (the inner $Table dataSource is a synchronous slice and cannot
          // network-fail, so it keeps the default fail handling).
          $$fail: error =>
            $errorWithRetry(
              error,
              $ButtonSecondary({ $content: $text('Retry') })({
                click: retryPositionsTether()
              })
            ),
          $display: map(async paramsQuery => {
            const params = await paramsQuery
            const paging = start({ offset: 0, pageSize: 20 }, scrollRequest)

            if (params.openPositionList.length === 0) {
              return $node(style({ color: palette.foreground, fontSize: text.sm }))($text('No positions'))
            }

            const dataSource = map(async pageParam => {
              const result = pagingQuery({ ...pageParam.paging, ...pageParam.sortBy }, params.openPositionList)
              return { ...result, $items: result.page }
            }, combine({ sortBy, paging }))

            return $row(
              $Table({
                dataSource: dataSource as any,
                sortBy: params.sortBy,
                scrollConfig: { $loader: $spinner },
                columns: [
                  ...(isDesktopScreen ? [timeColumn] : []),
                  entryColumn,
                  ...(isDesktopScreen ? [puppetsColumn] : []),
                  sizeColumn(),
                  pnlColumn()
                ]
              })({
                scrollRequest: scrollRequestTether()
              })
            )
          }, pageParams)
        })
      )

      return [
        $column(spacing.default, style({ width: '100%' }))(
          $row(
            spacing.small,
            style({
              alignItems: 'center',
              padding: isDesktopScreen ? '0 20px' : '0 12px',
              maxWidth: '1400px',
              width: '100%',
              margin: '0 auto',
              fontSize: text.sm,
              color: palette.foreground
            })
          )(
            $element('a')(
              attr({ href: '/' }),
              style({ color: colorShade(palette.message, 85), cursor: 'pointer' }),
              stylePseudo(':hover', { color: palette.message }),
              effectProp(
                'onclick',
                nowWith(() => (ev: MouseEvent) => {
                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                  ev.preventDefault()
                  pushUrl('/')
                })
              )
            )($text('Leaderboard')),
            $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
            $intermediatePromise({
              $loader: $node(style({ color: palette.message }))($text(readableAddress(fund))),
              $display: map(
                async fundStateFuture =>
                  $node(style({ color: palette.message }))(
                    $text(readableAccountName((await fundStateFuture)?.name) ?? readableAddress(fund))
                  ),
                fundStateQuery
              )
            })
          ),

          $hero,

          $responsiveFlex(
            style({
              alignItems: 'flex-start',
              maxWidth: '1400px',
              width: '100%',
              margin: '0 auto',
              padding: isDesktopScreen ? '0 20px' : '0 12px'
            })
          )(
            $column(
              spacing.default,
              style({ width: isDesktopScreen ? '440px' : '100%', flexShrink: 0 })
            )($puppetDistribution),
            $positionHistory
          )
        ),
        { changeActivityTimeframe, selectCollateralTokenList, selectIndexTokenList, changeMatchRuleList }
      ]
    }
  )
