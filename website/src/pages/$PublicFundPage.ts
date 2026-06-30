import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { symbolForBaseTokenId } from '@puppet/sdk/account'
import { ACROSS_PERIPHERY } from '@puppet/sdk/attestation'
import { type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import {
  dustToZeroUsd,
  formatFixed,
  getAccountExplorerUrl,
  getDuration,
  getRegisteredTokenDescription,
  getUnixTimestamp,
  readableAddress,
  readablePercentage,
  readableTokenAmountLabel,
  readableUnitAmount,
  readableUsd,
  toBasisPoints
} from '@puppet/sdk/core'
import { composeCashLeg, evaluateAccountNav } from '@puppet/sdk/evaluate'
import { getMarketDescription, getPositionPnlUsd, getTokenDescription } from '@puppet/sdk/gmx'
import { GMX_ROUTER, GMX_TOKEN_SPENDER, type IAccountPosition, LIFI_DIAMOND } from '@puppet/sdk/venue'
import {
  combine,
  combineMap,
  empty,
  fromPromise,
  type IStream,
  just,
  map,
  nowWith,
  op,
  start,
  switchMap,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'

import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { pushUrl } from 'aelea/ui-router'
import { getAddress } from 'viem'
import type { Address } from 'viem/accounts'
import {
  $amountDisplay,
  $anchor,
  $arrowRight,
  $external,
  $gmx,
  $icon,
  $infoLabel,
  $infoTooltip,
  $intermediatePromise,
  $unknown,
  text
} from '@/ui-components'
import { $tokenWithChainBadge, chainExplorerAddressUrl } from '../common/$chain.js'
import { $drawdownDisplay, $pnlDisplay, $size } from '../common/$common.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card, $responsiveFlex } from '../common/elements/$common.js'
import { $accountLabel, $fundProfile, readableAccountName } from '../components/$AccountProfile.js'
import { $FundAccountTimeline } from '../components/participant/$ProfilePeformanceTimeline.js'
import { $allocationDistribution } from '../components/portfolio/$fundHoldings.js'
import type { ISubscribeRule } from '../components/portfolio/$MatchingRuleEditor.js'
import { $defaultSubscribeEditorContainer, $SubscribeEditor } from '../components/portfolio/$SubscribeEditor.js'
import { $tokenIconBySymbol } from '../components/portfolio/$tokenOption.js'
import context, { getRate } from '../io/context.js'
import {
  fetchFundActivity,
  fetchFundAllocationDistribution,
  fetchMasterPoolState,
  fetchFundAccountMetricList,
  fetchMasterSubscribers,
  type IFundAction
} from '../io/datastore/query.js'
import { gmxPositionProvider } from '../io/gmx/navProviders.js'
import { formatUsd, priceFor } from '../io/gmx/priceFeed.js'
import { fetchOpenPositions } from '../io/matchmaker/reads.js'
import { readSubaccountState } from '../io/matchmaker/walletState.js'
import { $separator2, accountSettledPositionListSummary } from './common'
import type { IPageFilterParams } from './types.js'

interface I$PublicFundPage extends IPageFilterParams {
  hideBalances: IStream<boolean>
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  draftMatchingRuleList: IStream<ISubscribeRule[]>
}

const VENUE_DISPLAY: Record<string, { name: string; $glyph: I$Node<SVGPathElement> }> = {
  gmx: { name: 'GMX', $glyph: $gmx },
  swap: { name: 'Swap', $glyph: $unknown },
  bridge: { name: 'Bridge', $glyph: $unknown }
}
const venueDisplay = (venueId: string): { name: string; $glyph: I$Node<SVGPathElement> } =>
  VENUE_DISPLAY[venueId] ?? { name: venueId.toUpperCase(), $glyph: $unknown }

const TARGET_VENUE_BY_ADDRESS: Record<string, string> = {
  [GMX_ROUTER.toLowerCase()]: 'gmx',
  [GMX_TOKEN_SPENDER.toLowerCase()]: 'gmx',
  [LIFI_DIAMOND.toLowerCase()]: 'swap',
  [ACROSS_PERIPHERY.toLowerCase()]: 'bridge'
}
const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
const venueForAddress = (addr: Address | undefined): string | undefined =>
  addr ? TARGET_VENUE_BY_ADDRESS[addr.toLowerCase()] : undefined
const approveSpender = (callData: string): Address | undefined => {
  if (callData.slice(0, 10) !== ERC20_APPROVE_SELECTOR || callData.length < 74) return undefined
  try {
    return getAddress(`0x${callData.slice(34, 74)}`)
  } catch {
    return undefined
  }
}
const operateVenue = (
  callList: readonly { target: Address; callData: string }[]
): { venueId: string; target: Address | undefined } => {
  for (const c of callList) {
    const direct = venueForAddress(c.target)
    if (direct) return { venueId: direct, target: c.target }
    const spender = approveSpender(c.callData)
    const viaApprove = venueForAddress(spender)
    if (viaApprove) return { venueId: viaApprove, target: spender }
  }
  const action = callList.find(c => c.callData.slice(0, 10) !== ERC20_APPROVE_SELECTOR)
  return { venueId: 'unknown', target: (action ?? callList[0])?.target }
}

export const $PublicFundPage = ({
  hideBalances,
  activityTimeframe,
  collateralTokenList,
  userMatchingRuleQuery,
  draftMatchingRuleList
}: I$PublicFundPage) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>
    ) => {
      const urlFragments = document.location.pathname.split('/')
      const fund = urlFragments[urlFragments.length - 1].toLowerCase() as Address

      const fundAccountMetricQuery = op(
        combine({ activityTimeframe, collateralTokenList }),
        map(async params =>
          fetchFundAccountMetricList({
            fund,
            activityTimeframe: params.activityTimeframe,
            collateralTokenList: params.collateralTokenList
          })
        ),
        multicast
      )

      const metricsQuery = op(
        fundAccountMetricQuery,
        map(async metricList => accountSettledPositionListSummary(fund, await metricList)),
        multicast
      )

      const poolStatePromise = fetchMasterPoolState(fund)
      const fundStateQuery = just(poolStatePromise)
      const openPositionsQuery = just(fetchOpenPositions(getAddress(fund)).catch(() => []))
      const subscribersQuery = just(
        poolStatePromise
          .then(async f => (f ? fetchMasterSubscribers(await context.getTokenRegistry(), fund, f.baseToken) : []))
          .catch(() => [])
      )
      const distributionQuery = just(
        poolStatePromise.then(f => (f ? fetchFundAllocationDistribution(fund, f.master) : []))
      )
      const activityQuery = just(fetchFundActivity(fund))

      const tokenRegistryValue = fromPromise(context.getTokenRegistry())

      // Capital trusted by puppets (cumulative, time-decayed): the "Allocated" figure, the ROI/drawdown denominator,
      // and the timeline autoscale floor. NOT current AUM — see navUsdQuery.
      const aumUsdQuery = op(
        combine({ metrics: fundAccountMetricQuery, registry: tokenRegistryValue }),
        map(async p => {
          const metrics = await p.metrics
          return metrics.flatMap(metric => {
            const info = p.registry.get(HUB_CHAIN_ID)?.get(metric.baseToken)
            return info ? [{ allocated: metric.allocated, token: getAddress(info.token) }] : []
          })
        }),
        switchPromises,
        switchMap((legs): IStream<number | null> => {
          if (legs.length === 0) return just(0)
          return combineMap(
            (...prices: (bigint | null)[]) => {
              // Any unresolved/unpriceable leg makes the total indeterminate: emit null (shown as '-') rather than
              // skipping the leg and presenting a partial/zero figure as real.
              if (prices.some(price => price === null)) return null
              return legs.reduce((usd, leg, i) => usd + formatFixed(USD_DECIMALS, leg.allocated * prices[i]!), 0)
            },
            ...legs.map(leg => priceFor(leg.token))
          )
        }),
        multicast
      )

      // AUM = the fund's CURRENT NAV (supply x navPerShare), folded as post-state on allocate/redeem/liquidate, so a
      // liquidation drops it to the outstanding-claims value (0 once fully claimed). The stale-after-liquidation bug
      // was the AUM display reading `allocated` (above) instead of this.
      const navUsdQuery = op(
        combine({ fund: fundStateQuery, registry: tokenRegistryValue }),
        map(async p => {
          const f = await p.fund
          const info = f ? p.registry.get(HUB_CHAIN_ID)?.get(f.baseToken) : undefined
          if (!f || !info) return null
          return { aumBase: (f.totalShareSupply * f.navPerShare) / PRECISION.floatPrecisionExp, token: getAddress(info.token) }
        }),
        switchPromises,
        switchMap((leg): IStream<number | null> => {
          if (leg === null) return just(null)
          if (leg.aumBase === 0n) return just(0)
          return map(price => (price === null ? null : formatFixed(USD_DECIMALS, leg.aumBase * price)), priceFor(leg.token))
        }),
        multicast
      )

      const livePnlBaseQuery: IStream<{ pnlBase: bigint; baseToken: Address } | null> = op(
        combine({
          fund: fundStateQuery,
          registry: tokenRegistryValue,
          health: fromPromise(context.getChainLiveness()),
          tf: activityTimeframe
        }),
        map(async p => {
          const f = await p.fund
          if (!f) return null
          const info = p.registry.get(HUB_CHAIN_ID)?.get(f.baseToken)
          if (!info) return null
          const subaccount = await readSubaccountState(p.registry, fund)
          if (!subaccount) return null
          const nav = await evaluateAccountNav({
            master: fund,
            baseToken: info.token,
            kind: 'view',
            cashLeg: composeCashLeg(subaccount, p.health, f.baseToken),
            getRate,
            positions: await gmxPositionProvider(getAddress(fund), info.token)
          })
          const pnlBase = nav.breakdown.positions.reduce((acc, position) => acc + position.pnlBase, 0n)
          return { pnlBase, baseToken: info.token }
        }),
        switchPromises,
        state(null)
      )
      const livePnlUsd: IStream<number> = start(
        0,
        switchMap(base => {
          if (base === null) return just(0)
          return map(
            price => (price === null ? 0 : formatFixed(USD_DECIMALS, base.pnlBase * price)),
            priceFor(getAddress(base.baseToken))
          )
        }, livePnlBaseQuery)
      )

      const $sectionLabel = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500', letterSpacing: '0.5px' }))(
          $text(label)
        )

      const $metric = (label: string, $value: I$Node): I$Node =>
        $column(spacing.tiny)($infoLabel($node(style({ whiteSpace: 'nowrap' }))($text(label))), $value)

      const $metricsLead = $intermediatePromise({
        $display: map(
          async p => {
            const aum = await p.aum
            const openAllocation = (await p.open).reduce((acc, pos) => acc + pos.collateralInUsd, 0n)
            return $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'flex-start' }))(
              $metric(
                'Allocated',
                $node(style({ fontWeight: '700', color: palette.message }))(
                  $text(aum === null ? '-' : `$${readableUnitAmount(aum)}`)
                )
              ),
              $metric(
                'Open allocation',
                $node(style({ fontWeight: '700', color: palette.message }))(
                  $text(`$${readableUnitAmount(formatFixed(USD_DECIMALS, openAllocation))}`)
                )
              )
            )
          },
          combine({ aum: aumUsdQuery, open: openPositionsQuery })
        )
      })

      const $vitals = $intermediatePromise({
        $display: map(
          async p => {
            const summary = await p.metrics
            const subs = await p.subs
            const aum = await p.aum
            const nav = await p.nav
            const realisedUsd = formatFixed(USD_DECIMALS, dustToZeroUsd(summary.realisedPnl))
            const roi = aum !== null && aum > 0 ? (realisedUsd / aum) * 100 : 0

            let cumulative = 0n
            let peak = 0n
            let maxDrawdown = 0n
            let worstTrade = 0n
            for (const point of summary.pnlTimeline) {
              const value = dustToZeroUsd(point.value)
              if (value < worstTrade) worstTrade = value
              cumulative += value
              if (cumulative > peak) peak = cumulative
              const decline = peak - cumulative
              if (decline > maxDrawdown) maxDrawdown = decline
            }
            const maxDrawdownUsd = formatFixed(USD_DECIMALS, maxDrawdown)
            const drawdownBps = aum !== null && aum > 0 ? BigInt(Math.round((maxDrawdownUsd / aum) * 10000)) : 0n

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
              $value(
                'AUM',
                $node(style({ color: palette.message }))($text(nav === null ? '-' : `$${readableUnitAmount(nav)}`))
              ),
              $value(
                'ROI',
                $node(style({ color: roi > 0 ? palette.positive : roi < 0 ? palette.negative : palette.foreground }))(
                  $text(aum === null ? '-' : `${roi.toFixed(1)}%`)
                ),
                'ROI = realised PnL / AUM. Total return over the selected timeframe relative to capital trusted by puppets.'
              ),
              $value(
                'Max drawdown',
                aum === null ? $node(style({ color: palette.foreground }))($text('-')) : $drawdownDisplay(drawdownBps),
                'Max drawdown = the largest peak-to-trough decline of cumulative PnL over the timeframe, as a share of AUM. Lower is better.'
              ),
              $value(
                'Worst trade',
                $node(style({ color: worstTrade < 0n ? palette.negative : palette.message }))(
                  $text(readableUsd(worstTrade))
                )
              ),
              $value('Puppets', $node(style({ color: palette.message }))($text(`${subs.length}`)))
            )
          },
          combine({ metrics: metricsQuery, subs: subscribersQuery, aum: aumUsdQuery, nav: navUsdQuery })
        )
      })

      const $identityHeader = (accountName?: string) =>
        $column(spacing.tiny)(
          $heading3($accountLabel({ address: fund, ensName: accountName })),
          $row(spacing.small, style({ alignItems: 'center' }))(
            accountName
              ? $node(style({ color: palette.foreground, fontSize: text.sm }))($text(readableAddress(fund)))
              : empty,
            $anchor(
              attr({ href: getAccountExplorerUrl(fund), target: '_blank' }),
              style({ color: palette.foreground, fontSize: text.sm })
            )($text('View on explorer'), $icon({ $content: $external, width: '11px' }))
          )
        )

      const $profileOverview = $column(spacing.default)(
        $column(spacing.small)(
          $intermediatePromise({
            $loader: $row(spacing.default, style({ alignItems: 'center' }))($roboAvatar(fund, 56), $identityHeader()),
            $display: map(async fundStateFuture => {
              const fundState = await fundStateFuture
              return fundState
                ? $fundProfile(
                    { master: fundState.master, baseToken: fundState.baseToken, name: fundState.name },
                    56
                  )
                : $row(spacing.default, style({ alignItems: 'center' }))($roboAvatar(fund, 56), $identityHeader())
            }, fundStateQuery)
          }),
          $anchor(
            attr({ href: getAccountExplorerUrl(fund), target: '_blank' }),
            style({ color: palette.foreground, fontSize: text.sm })
          )($text('View fund account on explorer'), $icon({ $content: $external, width: '11px' }))
        ),
        $vitals,
        $intermediatePromise({
          $display: map(
            async p => {
              const fundState = await p.fund
              if (!fundState) return $infoLabel($text('Fund not found'))
              const info = p.registry.get(HUB_CHAIN_ID)?.get(fundState.baseToken)
              if (!info) return $infoLabel($text('Unsupported collateral'))
              return $SubscribeEditor({
                collateralToken: info.token,
                baseToken: fundState.baseToken,
                userMatchingRuleQuery,
                draftMatchingRuleList,
                master: fundState.master as Address,
                name: fundState.name,
                prominent: true,
                $container: $defaultSubscribeEditorContainer(style({ marginLeft: '-12px' }))
              })({
                changeMatchRuleList: changeMatchRuleListTether()
              })
            },
            combine({ fund: fundStateQuery, registry: tokenRegistryValue })
          )
        })
      )

      const $fundBalances = $column(
        spacing.default,
        style({ backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px' })
      )(
        $sectionLabel('Liquid balances'),
        $intermediatePromise({
          $display: map(
            async p => {
              const state = await readSubaccountState(p.registry, getAddress(fund))
              const rows = [...(state?.balances.values() ?? [])].filter(b => b.signedBalance > 0n)
              if (rows.length === 0) {
                return $node(style({ color: palette.foreground, fontSize: text.sm }))($text('No balances yet'))
              }
              return $column(spacing.default)(
                ...rows.map(b => {
                  const info = p.registry.get(HUB_CHAIN_ID)?.get(b.token)
                  if (!info) return empty
                  const desc = getRegisteredTokenDescription(info.token)
                  const symbol = symbolForBaseTokenId(b.token) ?? desc.symbol
                  return $row(spacing.small, style({ alignItems: 'center' }))(
                    $tokenWithChainBadge($tokenIconBySymbol(symbol, '32px'), Number(b.chainId), 32, 14),
                    $node(style({ fontSize: text.sm, color: palette.message }))($text(symbol)),
                    $node(style({ flex: 1 }))(),
                    $amountDisplay({
                      hideBalances,
                      usd: map(price => formatUsd(b.signedBalance, price), priceFor(info.token)),
                      amount: readableTokenAmountLabel(desc, b.signedBalance),
                      align: 'flex-end',
                      usdFontSize: text.sm
                    })
                  )
                })
              )
            },
            combine({ registry: tokenRegistryValue })
          )
        })
      )

      const $puppetDistribution = $column(
        spacing.default,
        style({ flex: 1, backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px' })
      )(
        $sectionLabel('Puppet distribution'),
        $intermediatePromise({
          $display: map(
            async p => $allocationDistribution(hideBalances, await p.dist, await p.pool, p.registry),
            combine({ dist: distributionQuery, pool: fundStateQuery, registry: tokenRegistryValue })
          )
        })
      )

      const marketIndexToken = (market: Address): Address | null => {
        try {
          return getMarketDescription(market).indexToken
        } catch {
          return null
        }
      }
      const indexTokenDescription = (token: Address | null) => {
        if (!token) return undefined
        try {
          return getTokenDescription(token)
        } catch {
          return undefined
        }
      }
      const positionPnl = (pos: IAccountPosition, indexToken: Address | null): IStream<bigint> =>
        indexToken === null
          ? just(pos.realizedPnlUsd + pos.pnl)
          : map(price => {
              const marked =
                price === null ? pos.pnl : getPositionPnlUsd(pos.isLong, pos.sizeInUsd, pos.sizeInTokens, price)
              return pos.realizedPnlUsd + marked
            }, priceFor(indexToken))

      const $directionPill = (isLong: boolean): I$Node => {
        const color = isLong ? palette.positive : palette.negative
        return $node(
          style({
            fontSize: text.xs,
            fontWeight: '600',
            padding: '1px 7px',
            borderRadius: '4px',
            color,
            backgroundColor: colorShade(color, 12)
          })
        )($text(isLong ? 'Long' : 'Short'))
      }

      const $platformHeader = (venueId: string, count: number, $trailing?: I$Node): I$Node => {
        const venue = venueDisplay(venueId)
        return $row(spacing.small, style({ alignItems: 'center' }))(
          $icon({ $content: venue.$glyph, width: '20px', viewBox: '0 0 32 32', fill: palette.message }),
          $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(venue.name)),
          $node(style({ color: palette.foreground, fontSize: text.xs }))($text(`${count}`)),
          ...($trailing ? [$node(style({ flex: 1 }))(), $trailing] : [])
        )
      }

      const $positionRow = (pos: IAccountPosition, indexToken: Address | null): I$Node => {
        const symbol = indexTokenDescription(indexToken)?.symbol ?? '?'
        const pnl = positionPnl(pos, indexToken)
        const roi: IStream<string> = map(
          v => readablePercentage(toBasisPoints(dustToZeroUsd(v), pos.collateralInUsd)),
          pnl
        )
        return $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'center' }))(
          $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
            $tokenIconBySymbol(symbol, '28px'),
            $node(style({ fontSize: text.base, color: palette.message, fontWeight: '600' }))($text(symbol)),
            $directionPill(pos.isLong)
          ),
          $size(pos.sizeInUsd, pos.collateralInUsd),
          $column(spacing.tiny, style({ alignItems: 'flex-end', minWidth: '64px' }))(
            $pnlDisplay(pnl),
            $separator2,
            $node(style({ fontSize: text.xs, color: palette.foreground }))($text(roi))
          )
        )
      }

      const $openPositions = $column(
        spacing.default,
        style({ backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px' })
      )(
        $sectionLabel('Open positions'),
        $intermediatePromise({
          $display: map(async positionsFuture => {
            const positions = (await positionsFuture).filter(p => p.sizeInUsd > 0n)
            if (positions.length === 0) {
              return $node(style({ color: palette.foreground, fontSize: text.sm }))($text('No open positions'))
            }
            const enriched = positions
              .map(pos => ({ pos, indexToken: marketIndexToken(pos.market) }))
              .sort((a, b) => (b.pos.sizeInUsd > a.pos.sizeInUsd ? 1 : -1))
            const netPnl: IStream<bigint> = combineMap(
              (...prices: (bigint | null)[]) =>
                enriched.reduce((acc, { pos }, i) => {
                  const price = prices[i] ?? null
                  const marked =
                    price === null ? pos.pnl : getPositionPnlUsd(pos.isLong, pos.sizeInUsd, pos.sizeInTokens, price)
                  return acc + pos.realizedPnlUsd + marked
                }, 0n),
              ...enriched.map(e => (e.indexToken ? priceFor(getAddress(e.indexToken)) : just<bigint | null>(null)))
            )
            const byVenue = new Map<string, typeof enriched>()
            for (const e of enriched) {
              const group = byVenue.get(e.pos.venueId) ?? []
              group.push(e)
              byVenue.set(e.pos.venueId, group)
            }
            const venues = [...byVenue.entries()]
            const single = venues.length === 1
            const $net = $row(spacing.small, style({ alignItems: 'center' }))(
              $infoLabel(style({ fontSize: text.xs }))($text('Net')),
              $pnlDisplay(netPnl)
            )
            return $column(spacing.default)(
              ...(single
                ? []
                : [
                    $row(spacing.small, style({ alignItems: 'center' }))(
                      $infoLabel($text(`${positions.length} open`)),
                      $node(style({ flex: 1 }))(),
                      $net
                    )
                  ]),
              ...venues.map(([venueId, group]) =>
                $column(spacing.default)(
                  $platformHeader(venueId, group.length, single ? $net : undefined),
                  $column(
                    spacing.small,
                    style({
                      paddingLeft: '12px',
                      marginLeft: '10px',
                      borderLeft: `1px solid ${colorShade(palette.foreground, 30)}`
                    })
                  )(
                    ...group.flatMap(({ pos, indexToken }, i) =>
                      i === 0
                        ? [$positionRow(pos, indexToken)]
                        : [
                            $node(
                              style({
                                height: '1px',
                                width: '100%',
                                backgroundColor: colorShade(palette.foreground, 30)
                              })
                            )(),
                            $positionRow(pos, indexToken)
                          ]
                    )
                  )
                )
              )
            )
          }, openPositionsQuery)
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
          $FundAccountTimeline({
            hideBalances,
            activityTimeframe,
            collateralTokenList,
            metricsQuery,
            livePnlUsd,
            aumUsd: aumUsdQuery,
            chartHeight: isDesktopScreen ? '480px' : '300px',
            $lead: $row(style({ flex: 1, pointerEvents: 'all' }))($metricsLead)
          })({
            selectCollateralTokenList: selectCollateralTokenListTether(),
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

      const $actionDetail = (a: IFundAction, baseDesc: ReturnType<typeof getTokenDescription> | undefined): I$Node => {
        if (a.kind === 'event') return empty
        if (a.kind === 'allocate') {
          const allocatedLabel = baseDesc ? readableTokenAmountLabel(baseDesc, a.allocated) : `${a.puppetCount} matched`
          return $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
            $node($text(`Allocated ${allocatedLabel}`)),
            baseDesc && a.masterAmount > 0n
              ? $node(style({ color: colorShade(palette.foreground, 70) }))(
                  $text(`· master ${readableTokenAmountLabel(baseDesc, a.masterAmount)}`)
                )
              : empty
          )
        }
        const { venueId, target } = operateVenue(a.callList)
        const venue = venueDisplay(venueId)
        return $row(
          spacing.small,
          style({ alignItems: 'center', flexWrap: 'wrap', fontSize: text.sm, color: palette.foreground })
        )(
          $icon({ $content: venue.$glyph, width: '16px', viewBox: '0 0 32 32', fill: palette.message }),
          ...a.transferList
            .filter(leg => leg.amountIn > 0n || leg.amountOut > 0n)
            .map(leg => {
              const d = indexTokenDescription(leg.token)
              const isOut = leg.amountOut > 0n
              const amt = isOut ? leg.amountOut : leg.amountIn
              const label = d ? readableTokenAmountLabel(d, amt) : readableAddress(leg.token)
              return $node(style({ color: isOut ? palette.negative : palette.positive }))(
                $text(`${isOut ? '−' : '+'}${label}`)
              )
            }),
          ...(target
            ? [
                $anchor(
                  attr({ href: chainExplorerAddressUrl(a.chainId, target), target: '_blank' }),
                  style({ color: colorShade(palette.foreground, 70), fontSize: text.xs })
                )($text(`→ ${readableAddress(target)}`))
              ]
            : [])
        )
      }

      const activityViewQuery = op(
        combine({ actions: activityQuery, fund: fundStateQuery, registry: tokenRegistryValue }),
        map(async p => {
          const actions = await p.actions
          const fundState = await p.fund
          const info = fundState ? p.registry.get(HUB_CHAIN_ID)?.get(fundState.baseToken) : undefined
          const baseDesc = info ? indexTokenDescription(info.token) : undefined
          return { actions, baseDesc }
        })
      )

      const $activity = $column(
        spacing.default,
        style({ flex: 1, minWidth: 0, backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px' })
      )(
        $sectionLabel('Activity'),
        $intermediatePromise({
          $display: map(async viewFuture => {
            const { actions, baseDesc } = await viewFuture
            if (actions.length === 0) {
              return $node(style({ color: palette.foreground, fontSize: text.sm }))($text('No activity yet'))
            }
            const now = getUnixTimestamp()
            return $column(spacing.small)(
              ...actions.map(a =>
                $row(spacing.small, style({ alignItems: 'center' }))(
                  $node(
                    style({
                      fontWeight: '600',
                      minWidth: '76px',
                      color: a.kind === 'allocate' ? palette.primary : palette.message
                    })
                  )(
                    $text(
                      a.kind === 'allocate'
                        ? 'Allocate'
                        : a.kind === 'event'
                          ? (a.label ?? 'Event')
                          : venueDisplay(operateVenue(a.callList).venueId).name
                    )
                  ),
                  $actionDetail(a, baseDesc),
                  $node(style({ flex: 1 }))(),
                  a.relayFee > 0n && baseDesc
                    ? $node(
                        style({ fontSize: text.xs, color: colorShade(palette.foreground, 70), whiteSpace: 'nowrap' })
                      )($text(`fee ${readableTokenAmountLabel(baseDesc, a.relayFee)}`))
                    : empty,
                  $node(style({ fontSize: text.sm, color: palette.foreground, whiteSpace: 'nowrap' }))(
                    $text(`${getDuration(now - a.blockTimestamp)} ago`)
                  )
                )
              )
            )
          }, activityViewQuery)
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
              attr({ href: '/leaderboard' }),
              style({ color: colorShade(palette.message, 85), cursor: 'pointer' }),
              stylePseudo(':hover', { color: palette.message }),
              effectProp(
                'onclick',
                nowWith(() => (ev: MouseEvent) => {
                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                  ev.preventDefault()
                  pushUrl('/leaderboard')
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
            $column(spacing.default, style({ width: isDesktopScreen ? '440px' : '100%', flexShrink: 0 }))(
              $fundBalances,
              $puppetDistribution
            ),
            $column(spacing.default, style({ flex: 1, minWidth: 0 }))($openPositions, $activity)
          )
        ),
        { changeActivityTimeframe, selectCollateralTokenList, changeMatchRuleList }
      ]
    }
  )
