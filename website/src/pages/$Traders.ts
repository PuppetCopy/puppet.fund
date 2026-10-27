import { fundSymbolOf, gridOf } from '@puppet/sdk/account'
import type { IMandateDraft, IOwnState, IRootState } from '@puppet/sdk/client'
import type { IntervalTime } from '@puppet/sdk/const'
import { getMappedValue, getUnixTimestamp } from '@puppet/sdk/core'
import type { IDigestClient } from '@puppet/sdk/datastore'
import type { IGetRate } from '@puppet/sdk/evaluate'
import { cashFor } from '@puppet/sdk/pool'
import { fundTable, holdingTable, type IMandateRow } from '@puppet/sdk/schema'
import { combine, filter, filterNull, type IStream, just, map, op, sampleMap, skipRepeats, start, switchLatest, switchMap, take } from 'aelea/stream'
import { type IBehavior, PromiseStatus, state } from 'aelea/stream-extended'
import { $element, attrBehavior, component, type I$Node, $node, style, styleBehavior, $text } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, isAddressEqual } from 'viem'
import {
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultTableCell,
  $defaultTableContainer,
  $defaultTableHeaderCell,
  $defaultTableRowContainer,
  $errorCard,
  $icon,
  $infoTooltip,
  $intermediateList,
  $intermediatePill,
  $intermediateProfile,
  $intermediatePromise,
  $intermediateRow,
  $intermediateText,
  $popoverCaret,
  $Table,
  text,
  intermediateState
} from '@/ui-components'
import { ethPrice, ethUsd } from '../common/$common.js'
import { $puppetLogo } from '../common/$icons.js'
import { $venueIcon } from '../common/$operationView.js'
import { $card2 } from '../common/elements/$common.js'
import { $fundProfile } from '../components/$AccountProfile.js'
import { mandateTermsOf } from '../components/$MandatePosition.js'
import { $ActivityFilter } from '../components/$ActivityFilter.js'
import { activityOptionShortLabelMap } from '../components/$LastActivity.js'
import { $performanceCell, type IPerformanceMetric, performanceMetricLabelMap } from '../components/$PerformanceMetric.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import { $avatarStack } from '../components/$avatarStack.js'
import { $fundHolders } from '../components/$FundHolders.js'
import { $jazzicon, AVATAR_SIZE } from '../common/$avatar.js'
import { readFundBook } from '@puppet/sdk/intent'
import { walletsOf } from '@puppet/sdk/state'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import { uiStorage } from '@/ui-storage'
import { type ILeaderboardSort, LEADERBOARD_SORT_KEYS } from '../app/localStoreSchema.js'
import { getRate, localGetRate } from '../io/context.js'
import { answerState, client, localFirst, localReader } from '../io/datastore/reads.js'
import { mandatesInForce } from '../io/datastore/own.js'
import { holdersOf, type ILeaderboardEntry, leaderboardEntries, traderPerformance } from '../io/datastore/traders.js'
import { $caption, $stack, ago } from './common.js'
import type { IPageFilterParams } from './types.js'


function rankTraders(
  entries: readonly ILeaderboardEntry[],
  puppetsOf: Promise<{ held: readonly { master: Address; holder: Address; shares: bigint }[]; wallets: ReadonlyMap<Address, Address> }>,
  interval: number,
  sinceSec: number,
  untilSec: number
) {
  return entries.map(e => {
    return {
      master: e.master,
      profile: e.profile,
      puppets: puppetsOf.then(p => p.held.filter(h => isAddressEqual(h.master, e.master)).map(h => ({ wallet: p.wallets.get(h.holder) ?? h.holder, shares: h.shares }))),
      wallets: puppetsOf.then(p => p.wallets),
      nav: e.valuation,
      valuedAt: e.lastUpdatedTimestamp,
      performance: traderPerformance(e, interval, sinceSec, untilSec),
      allocated: cashFor(e.backerShares, e.totalShares, e.valuation),
      platforms: e.venueList
        .map((venue, index) => ({ venue, time: e.venueTimeList[index]! }))
        .filter(active => active.time >= sinceSec)
        .sort((a, b) => b.time - a.time)
        .map(active => active.venue)
    }
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
const $leaderboardHeaderCell = $defaultTableHeaderCell(style({ alignItems: 'flex-start', alignSelf: 'center' }))
const $leaderboardHeaderCellEnd = $leaderboardHeaderCell(style({ placeContent: 'flex-end' }))
const $leaderboardCellCenter = $leaderboardCell(style({ placeContent: 'center' }))
const $leaderboardHeaderCellCenter = $leaderboardHeaderCell(style({ placeContent: 'center' }))

const $leaderboardLoader = $intermediateList(8, $intermediateRow($intermediateProfile(32)))

export interface I$Traders extends IPageFilterParams {
  walletRoot: IStream<Promise<IRootState | null>>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  draftMandateList: IStream<IMandateDraft[]>
  hideBalances: IStream<boolean>
}

export const $Traders = ({ walletRoot, ownStateQuery, draftMandateList, hideBalances, activityTimeframe, performanceMetric }: I$Traders) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [popMandate, popMandateTether]: IBehavior<PointerEvent, Address>,
      [changeColumnSort, changeColumnSortTether]: IBehavior<{ direction: 'asc' | 'desc'; selector: string }>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>
    ) => {
      const sort = op(
        uiStorage.replayWrite<ILeaderboardSort>(
          'leaderboardSort',
          { direction: 'desc', selector: 'performance' },
          op(
            changeColumnSort,
            map((next): ILeaderboardSort => {
              const selector = LEADERBOARD_SORT_KEYS.find(k => k === next.selector)
              if (selector === undefined) throw new Error(`unknown sort column ${next.selector}`)
              return { direction: next.direction, selector }
            })
          )
        ),
        state()
      )

      const $filters = $ActivityFilter({ activityTimeframe, metric: { value: performanceMetric, labels: performanceMetricLabelMap } })({
        changeActivityTimeframe: changeActivityTimeframeTether(),
        changePerformanceMetric: changePerformanceMetricTether()
      })

      const $emptyMessageOf = (byValue: boolean) =>
        $column(spacing.default, style({ padding: '32px 20px', alignItems: 'center', textAlign: 'center' }))(
          $node(style({ color: palette.foreground }))(
            $text(
              byValue
                ? "No funds yet. A fund joins this board when its master's first allocation round opens it on the hub."
                : 'No fund was active in this timeframe. Pick a longer one or sort by fund value.'
            )
          )
        )

      const viewerQuery: IStream<Promise<{ root: IRootState | null; mandates: IMandateRow[] }>> = op(
        combine({ root: walletRoot, own: ownStateQuery }),
        map(p => Promise.all([p.root, p.own]).then(([root, own]) => ({ root, mandates: own === null ? [] : mandatesInForce(own) }))),
        answerState
      )
      const viewerSettled = op(
        intermediateState(viewerQuery),
        map(s => (s.status === PromiseStatus.DONE ? s.value : null)),
        filterNull,
        state()
      )
      const $table = switchMap(params => {
        const now = Math.floor(getUnixTimestamp() / 60) * 60
        const sinceSec = now - params.tf
        const byValue = params.sort.selector === 'nav'
        const $board = (rows: Promise<ITraderRank[]>): I$Node =>
        $Table<ITraderRank>({
          $container: $leaderboardTableContainer,
          $cell: $leaderboardCell,
          $headerCell: $leaderboardHeaderCell,
          $rowContainer: $defaultTableRowContainer(style(isDesktopScreen ? { gap: '20px', justifyContent: 'space-between' } : {})),
          scrollConfig: { $loader: $leaderboardLoader, $emptyMessage: $emptyMessageOf(byValue), $$fail: $errorCard },
          sortBy: params.sort,
          dataSource: just(rows),
          columns: [
            {
              $head: $node(style({ fontWeight: '700' }))($text('Fund')),
              gridTemplate: isDesktopScreen ? '216px' : '188px',
              $bodyCallback: map((row: ITraderRank) => {
                const master = row.master
                const mandate = op(
                  viewerSettled,
                  map(v => {
                    const root = v.root
                    const mine = root === null ? undefined : v.mandates.find(m => isAddressEqual(m.master, master) && isAddressEqual(m.puppet, root.account))
                    return {
                      mine,
                      active: mine !== undefined && mandateTermsOf(mine).until > BigInt(now),
                      isSelf: root !== null && root.fund !== null && 'account' in root.fund && isAddressEqual(root.fund.account, master)
                    }
                  }),
                  state()
                )
                const isSelf = op(
                  mandate,
                  map(m => m.isSelf),
                  skipRepeats
                )
                const $mandate = $Popover({
                  $container: $node(style({ display: 'flex', flexShrink: '0' })),
                  $contentContainer: $editorPopoverContentContainer,
                  $target: $ButtonSecondary({
                    $container: $defaultMiniButtonPrimary(
                      style({ flexShrink: '0' }),
                      attrBehavior(map(self => ({ 'aria-label': self ? 'Your fund' : 'Mandate', title: self ? 'Your fund' : 'Mandate' }), isSelf)),
                      styleBehavior(map(m => (m.active ? { borderColor: palette.indeterminate } : null), mandate))
                    ),
                    disabled: isSelf,
                    $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                      switchLatest(map(self => (self ? $node($text('You')) : $icon({ $content: $puppetLogo, width: '18px', viewBox: '0 0 32 32' })), isSelf)),
                      ...(isDesktopScreen ? [$popoverCaret()] : [])
                    )
                  })({ click: popMandateTether(map(() => master)) }),
                  $open: op(
                    popMandate,
                    filter(key => isAddressEqual(key, master)),
                    sampleMap(
                      m =>
                        $MandateEditor({
                          master,
                          existing: m.mine,
                          draft: map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, master)) ?? null, draftMandateList)
                        })({ changeMandateDraft: changeMandateDraftTether() }),
                      mandate
                    )
                  ),
                  dismiss: changeMandateDraft
                })({})
                return $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                  $node(style({ display: 'flex', minWidth: '0', width: isDesktopScreen ? '154px' : '140px' }))($fundProfile(master, gridOf(row.profile), fundSymbolOf(row.profile))),
                  switchLatest(
                    op(
                      viewerSettled,
                      take(1),
                      map(() => $mandate),
                      start($intermediatePill(isDesktopScreen ? '52px' : '40px', '30px'))
                    )
                  )
                )
              })
            },
            ...(isDesktopScreen
              ? [
                {
                  $head: $row(spacing.tiny, style({ alignItems: 'flex-start' }))(
                    $node(style({ fontWeight: '700' }))($text('Venues')),
                    $infoTooltip(
                      'Venues this fund was active on during the timeframe, most recent first.',
                      palette.foreground
                    )
                  ),
                  gridTemplate: '96px',
                  $headerCellContainer: $leaderboardHeaderCellCenter,
                  $bodyCellContainer: $leaderboardCellCenter,
                  $bodyCallback: map((row: ITraderRank) => {
                    const truncated = row.platforms.length > 3
                    return row.platforms.length === 0
                      ? $caption('-')
                      : $row(style({ alignItems: 'center' }))(
                          ...row.platforms.slice(0, truncated ? 2 : 3).map((venue, i) =>
                            $node(
                              style({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '34px',
                                height: '34px',
                                marginLeft: i === 0 ? '0' : '-14px',
                                borderRadius: '50%',
                                border: `4px solid ${palette.background}`,
                                backgroundColor: palette.horizon
                              })
                            )($venueIcon(venue, 15))
                          ),
                          ...(truncated
                            ? [
                                $node(
                                  style({
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minWidth: '34px',
                                    height: '34px',
                                    padding: '0 3px',
                                    marginLeft: '-14px',
                                    borderRadius: '17px',
                                    border: `4px solid ${palette.background}`,
                                    backgroundColor: palette.horizon,
                                    color: palette.message,
                                    fontSize: '12px',
                                    fontWeight: '700'
                                  })
                                )($text(`${row.platforms.length - 2}`))
                              ]
                            : [])
                        )
                  })
                },
                {
                  $head: $row(spacing.tiny, style({ flex: 1, alignItems: 'flex-start', placeContent: 'flex-end' }))(
                    $stack($node(style({ fontWeight: '700', whiteSpace: 'nowrap' }))($text('Fund value')), $caption('Allocated'), 'flex-end'),
                    $infoTooltip("What the fund holds now, and the part puppets hold. A value with an info icon is its last valuation, shown when the live one is unavailable.", palette.foreground)
                  ),
                  sortBy: 'nav',
                  gridTemplate: '140px',
                  $headerCellContainer: $leaderboardHeaderCellEnd,
                  $bodyCellContainer: $leaderboardCellEnd,
                  $bodyCallback: map((row: ITraderRank) => {
                    const holdersAt = (reader: IDigestClient, rate: IGetRate) =>
                      readFundBook({ chronicle: reader }, row.master).then(book =>
                        Promise.all([book, reader.find(fundTable, { master: getAddress(row.master) }), holdersOf(reader, rate, book), row.wallets])
                      )
                    return $stack(
                      $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
                        $infoTooltip(`The fund's last valuation, ${ago(row.valuedAt)}.`, palette.foreground),
                        $node(style({ color: palette.message, fontFamily: 'var(--font-numbers)' }))($intermediateText(ethUsd(row.nav)))
                      ),
                      $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground }))(
                        $intermediatePromise({
                          $loader: $intermediatePill('40px', '18px'),
                          $display: just(
                            row.puppets.then(puppets =>
                              $avatarStack(
                                [...puppets].sort((a, b) => (a.shares > b.shares ? -1 : a.shares < b.shares ? 1 : 0)).map(puppet => $jazzicon(puppet.wallet, 14)),
                                $intermediatePromise({
                                  $loader: $column(spacing.default)($intermediateRow($intermediateProfile(AVATAR_SIZE)), $intermediateRow($intermediateProfile(AVATAR_SIZE))),
                                  $display: map(
                                    q =>
                                      q.then(([book, fundRow, held, wallets]) => {
                                        if (fundRow === undefined) throw new Error(`the chronicle holds no fund for ${row.master}`)
                                        const holding = book.holdings.filter(h => !isAddressEqual(h.holder, book.master) && h.shares > 0n)
                                        return $fundHolders(hideBalances, null, wallets, fundRow, holding, book, held.balances, just(held.quotes), { wei: just(fundRow.value), price: ethPrice() }, just(null), just(null))
                                      }),
                                    localFirst(
                                      () => holdersAt(localReader, localGetRate),
                                      () => holdersAt(client, getRate)
                                    )
                                  )
                                })
                              )
                            )
                          )
                        }),
                        $element('span')($text('· '), $intermediateText(ethUsd(row.allocated)))
                      ),
                      'flex-end'
                    )
                  })
                }
                ]
              : []),
            {
              $head: $row(spacing.small, style({ flex: 1, alignItems: 'center', placeContent: 'space-between' }))(
                params.metric === 'pnl'
                  ? $row(spacing.tiny, style({ alignItems: 'flex-start' }))(
                      $stack($node(style({ fontWeight: '700', whiteSpace: 'nowrap' }))($text('PnL')), $caption('ROI'), 'flex-start'),
                      $infoTooltip(
                        "Change in fund value over the timeframe, net of allocations and payouts.",
                        palette.foreground)
                    )
                  : $row(spacing.tiny, style({ alignItems: 'flex-start' }))(
                      $stack($node(style({ fontWeight: '700', whiteSpace: 'nowrap' }))($text('ROI')), $caption('PnL'), 'flex-start'),
                      $infoTooltip(
                        "How the fund's Performance Index moved over the timeframe. The index is fund value per 1.00 invested, in ETH after the master's fee, and new money joins at 1.00.",
                        palette.foreground)
                    ),
                $node(style({ color: palette.foreground, whiteSpace: 'nowrap' }))($text(`${getMappedValue(activityOptionShortLabelMap, params.tf)} activity`))
              ),
              sortBy: 'performance',
              $headerCellContainer: $defaultTableHeaderCell(style({ alignSelf: 'center' })),
              gridTemplate: isDesktopScreen ? '220px' : 'minmax(0, 1fr)',
              $bodyCallback: map((row: ITraderRank) => {
                return $performanceCell(sinceSec, row.performance, params.metric)
              })
            }
          ]
        })({ sortBy: changeColumnSortTether() })
        const rankedOf = (reader: IDigestClient) =>
          leaderboardEntries(reader, params.tf, byValue ? 'valuation' : params.metric === 'pnl' ? 'pnl' : 'roi', params.sort.direction, sinceSec).then(list => {
            const masters = list.map(e => getAddress(e.master))
            const puppetsOf =
              masters.length === 0
                ? Promise.resolve({ held: [], wallets: new Map<Address, Address>() })
                : reader.select(holdingTable, { where: { master: { in: masters } } }).then(async rows => {
                    const held = rows
                      .filter(h => h.shares > 0n && !isAddressEqual(h.holder, h.master))
                      .map(h => ({ master: getAddress(h.master), holder: getAddress(h.holder), shares: h.shares }))
                    return { held, wallets: await walletsOf(reader, held.map(h => h.holder)) }
                  })
            const ranks = rankTraders(list, puppetsOf, params.tf, sinceSec, now)
            return byValue || params.metric === 'pnl'
              ? ranks
              : ranks.sort((a, b) =>
                  a.performance.roi === null || b.performance.roi === null
                    ? Number(a.performance.roi === null) - Number(b.performance.roi === null)
                    : params.sort.direction === 'desc'
                      ? b.performance.roi - a.performance.roi
                      : a.performance.roi - b.performance.roi
                )
          })
        return $intermediatePromise({
          $loader: $board(new Promise(() => {})),
          $$fail: $errorCard,
          $display: map(
            query => query.then(rows => $board(Promise.resolve(rows))),
            localFirst(
              () => rankedOf(localReader),
              () => rankedOf(client).then(ranks => Promise.allSettled(ranks.map(rank => rank.puppets)).then(() => ranks))
            )
          )
        })
      }, combine({ tf: activityTimeframe, metric: performanceMetric, sort }))

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
                $node(style({ fontWeight: '600', fontSize: text.lg }))($text('Funds')),
                $infoTooltip(
                  'Every fund on Puppet. Deposit on the hub, then sign a mandate naming a fund: each round its master allocates takes up to your per-round rate of your deposit, within your skin cap, and buys you fund shares at the round price.',
                  palette.foreground)
              ),
              $filters
            ),
            $table
          )
        ),
        { changeActivityTimeframe, changePerformanceMetric, changeMandateDraft }
      ]
    }
  )
