import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { type ChainId, type IntervalTime, USD_DECIMALS } from '@puppet/sdk/const'
import {
  formatFixed,
  getAccountExplorerUrl,
  getDuration,
  getTokenDescription,
  getUnixTimestamp,
  readableAddress,
  readablePercentage,
  readableTokenAmountLabel,
  readableUnitAmount
} from '@puppet/sdk/core'
import { type IGmxPositionRow, VALUE_KEY } from '@puppet/sdk/evaluate'
import { GMX_V2_CHAIN_ID, getGmxTokenDescription, getMarketDescription, getPositionPnlUsd } from '@puppet/sdk/gmx'
import type { IMandateRow } from '@puppet/sdk/schema'
import { chainTokenOfKey } from '@puppet/sdk/state'
import { combine, delay, empty, filter, type IStream, just, map, merge, op, start, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, type INode, type IStyleCSS, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, getAddress, isAddressEqual } from 'viem'
import {
  $anchor,
  $arrowRight,
  $ButtonSecondary,
  $copy,
  $defaultMiniButtonPrimary,
  $external,
  $icon,
  $infoLabel,
  $infoTooltip,
  $inlineSpinner,
  $intermediatePromise,
  $popoverCaret,
  $Table,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $chainIcon, chainExplorerTxUrl, chainName } from '../common/$chain.js'
import { $pnlDisplay, $size, $tokenProfile } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card, $responsiveFlex } from '../common/elements/$common.js'
import { operationSummary, readableFlow } from '../common/operation.js'
import { $accountLabel, accountDisplayName } from '../components/$AccountProfile.js'
import { $ValueTimeline } from '../components/participant/$ValueTimeline.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import { $tokenIconBySymbol } from '../components/portfolio/$tokenOption.js'
import type { IMandateDraft } from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import context from '../io/context.js'
import { fetchBonds, fetchDeposits } from '../io/datastore/reads.js'
import { type ITraderView, traderOperations, traderPositions, traderTimeline, traderView } from '../io/datastore/traders.js'
import type { ITradeView } from '../io/datastore/trading.js'
import type { IAccountAction } from '../io/journal/history.js'
import { formatUsd, priceFor } from '../io/price.js'
import { walletValueUsd } from '../io/walletValue.js'
import { $amountDisplay } from '../ui-components/$hintAdjustment.js'
import type { IRootState } from '../wallet/index.js'
import { $navPill } from './$onboarding.js'
import { $separator2 } from './common.js'
import type { IPageFilterParams } from './types.js'

export interface I$TraderPage extends IPageFilterParams {
  master: Address
  hideBalances: IStream<boolean>
  walletRoot: IStream<IRootState | null>
  mandatesQuery: IStream<Promise<IMandateRow[]>>
  draftMandateList: IStream<IMandateDraft[]>
}

const VALUE_TOKEN = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
const value = getTokenDescription(HUB_CHAIN_ID, VALUE_TOKEN)

const $sectionLabel = (label: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500', letterSpacing: '0.5px' }))($text(label))

const $panel = (label: string, extraStyle: IStyleCSS, $content: I$Node): I$Node =>
  $column(spacing.default, style({ backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px', ...extraStyle }))($sectionLabel(label), $content)

const $metric = (label: string, $value: I$Node): I$Node =>
  $column(spacing.tiny)($infoLabel($node(style({ whiteSpace: 'nowrap' }))($text(label))), $value)

const $value = (label: string, $v: I$Node, tooltip?: string): I$Node =>
  $column(spacing.tiny)(
    tooltip
      ? $row(spacing.tiny, style({ alignItems: 'center' }))($infoLabel($text(label)), $infoTooltip(tooltip, palette.foreground))
      : $infoLabel($text(label)),
    $node(style({ fontWeight: '700' }))($v)
  )

const $emptyNote = (title: string, detail: string): I$Node =>
  $column(spacing.tiny)(
    $node(style({ color: palette.message, fontSize: text.sm }))($text(title)),
    $infoLabel(style({ fontSize: text.xs }))($text(detail))
  )

const $signedToken = (desc: ReturnType<typeof getTokenDescription>, amount: bigint): I$Node =>
  $node(style({ color: amount > 0n ? palette.positive : amount < 0n ? palette.negative : palette.foreground, whiteSpace: 'nowrap' }))(
    $text(`${amount > 0n ? '+' : ''}${readableTokenAmountLabel(desc, amount)}`)
  )

const $directionPill = (isLong: boolean): I$Node => {
  const color = isLong ? palette.positive : palette.negative
  return $node(style({ fontSize: text.xs, fontWeight: '600', padding: '1px 7px', borderRadius: '4px', color, backgroundColor: colorShade(color, 12) }))(
    $text(isLong ? 'Long' : 'Short')
  )
}

const marketIndexToken = (market: Address): Address | null => {
  try {
    return getMarketDescription(market).indexToken
  } catch {
    return null
  }
}

export const $TraderPage = ({ master, hideBalances, activityTimeframe, walletRoot, mandatesQuery, draftMandateList }: I$TraderPage) =>
  component(
    (
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [copyShareLink, copyShareLinkTether]: IBehavior<INode, string>,
      [popMandate, popMandateTether]: IBehavior<PointerEvent, Address>
    ) => {
      const viewQuery: IStream<Promise<ITraderView | undefined>> = op(just(traderView(master)), state())
      const sessionQuery = op(
        combine({ root: walletRoot, mandates: mandatesQuery }),
        map(async p => ({ root: p.root, mandates: await p.mandates, registry: await context.getTokenRegistry() })),
        state()
      )
      const timelineQuery = op(
        combine({ view: viewQuery, tf: activityTimeframe }),
        map(async p => {
          const view = await p.view
          if (view === undefined) return []
          const until = getUnixTimestamp()
          const [points, live] = await Promise.all([
            traderTimeline(view, until - p.tf, until),
            Promise.all([fetchDeposits([view.master]), fetchBonds([view.master])]).then(([deposits, bonds]) =>
              walletValueUsd(view.books, [], deposits, bonds)
            )
          ])
          return live === null ? points : [...points.slice(0, -1), { time: until, value: live }]
        }),
        state()
      )
      const balancesQuery = op(
        viewQuery,
        map(async q => {
          const view = await q
          if (view === undefined) return []
          const rows = await fetchDeposits([view.master])
          return rows
            .filter(row => row.deposit > 0n)
            .map(row => ({
              chainId: Number(row.chainId) as ChainId,
              token: getAddress(row.token),
              account: getAddress(row.account),
              balance: row.deposit
            }))
        }),
        state()
      )
      const operationsQuery = op(
        viewQuery,
        map(async q => {
          const view = await q
          return view === undefined ? [] : traderOperations(view)
        }),
        state()
      )
      const positionsQuery = op(
        viewQuery,
        map(async q => {
          const view = await q
          return view === undefined ? [] : traderPositions(view)
        }),
        state()
      )

      const shareLinkLabel = start('Copy share link', switchMap(() => merge(just('Link copied'), delay(1800, just('Copy share link'))), copyShareLink))
      const $shareLink = $element('span')(
        spacing.tiny,
        style({ color: palette.foreground, fontSize: text.sm, cursor: 'pointer', display: 'flex', alignItems: 'center' }),
        stylePseudo(':hover', { color: palette.message }),
        copyShareLinkTether(
          nodeEvent('click'),
          map(() => {
            const url = `${document.location.origin}/traders/${master}?s=${Date.now().toString(36)}`
            navigator.clipboard.writeText(url)
            return url
          })
        )
      )($icon({ $content: $copy, width: '12px' }), $text(shareLinkLabel))

      const $breadcrumb = $row(
        spacing.small,
        style({ alignItems: 'center', padding: isDesktopScreen ? '0 20px' : '0 12px', maxWidth: '1400px', width: '100%', margin: '0 auto', fontSize: text.sm, color: palette.foreground })
      )(
        $Link({ route: routeSchema.traders, $anchor: $defaultAnchor(style({ color: colorShade(palette.message, 85), textDecoration: 'none' })), $content: $text('Traders') })({}),
        $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
        $node(style({ color: palette.message }))($text(accountDisplayName(master)))
      )

      const $unknown = $card(spacing.big)(
        $heading3($text('Unknown trader')),
        $infoLabel($text(`${readableAddress(master)} has not opened a cycle yet.`)),
        $row($navPill('All traders', routeSchema.traders, false))
      )

      const $page = (view: ITraderView): I$Node => {
        const name = accountDisplayName(view.master)
        const totalBacking = view.books.reduce((acc, b) => acc + b.book.backed, 0n)
        const openBooks = view.books.filter(b => b.book.cycle > b.settledCycle).length
        const outcomes = view.settlements.map(s => view.outcomes.get(s.id) ?? null)
        const settledPnl = outcomes.every(o => o !== null) ? outcomes.reduce((acc, o) => acc + o!.pnl, 0n) : null
        const backingUsd = map(price => formatUsd(totalBacking, price), priceFor(HUB_CHAIN_ID, VALUE_TOKEN))
        const markedValue = view.books.reduce((acc, b) => acc + (b.mark && !b.mark.pending && b.mark.closeValue !== undefined ? b.mark.closeValue : 0n), 0n)

        const $identity = $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
          $node(style({ width: '56px', height: '56px', borderRadius: '50%', overflow: 'hidden', flexShrink: '0' }))($roboAvatar(view.master, 56)),
          $column(style({ minWidth: '0', gap: '2px' }))(
            $node(style({ fontWeight: '600', fontSize: isDesktopScreen ? text.lg : text.base, color: palette.message, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(name)),
            $row(spacing.tiny, style({ alignItems: 'center' }))($accountLabel({ address: view.master, primarySize: 1 }))
          )
        )

        const $vitals = $row(spacing.big, style({ flexWrap: 'wrap', rowGap: '12px' }))(
          $value(
            'Backing',
            $amountDisplay({ hideBalances, usd: backingUsd, amount: readableTokenAmountLabel(value, totalBacking), align: 'flex-start' }),
            'Bond currently locked behind this trader across all its open cycles, in hub USDC terms.'
          ),
          $value('Backers', $node(style({ color: palette.message }))($text(`${view.backers.length}`))),
          $value('Books', $node(style({ color: palette.message }))($text(`${view.books.length} · ${openBooks} open`)), 'One book per chain this trader trades on. Open means a cycle is running.'),
          $value(
            'Settled PnL',
            view.settlements.length === 0 || settledPnl === null ? $node(style({ color: palette.foreground }))($text('-')) : $signedToken(value, settledPnl),
            'Sum of closing value minus opening value over every settled cycle, in hub USDC terms.'
          ),
          $value(
            'Fee',
            $node(style({ color: palette.message }))($text(readablePercentage(PROTOCOL.performanceFee))),
            'Protocol performance fee the trader takes on backer gains at settlement.'
          ),
          $value(
            'Skin',
            $node(style({ color: palette.message }))(
              $text(view.books.length === 0 ? '-' : readablePercentage(view.books.reduce((max, b) => (b.book.skin > max ? b.book.skin : max), 0n)))
            ),
            'The highest skin this trader has committed on a book; backing never exceeds that ratio of the trader’s own value.'
          ),
          $value(
            'Trades in',
            $node(style({ color: palette.message }))(
              $text(
                view.books.length === 0
                  ? '-'
                  : [...new Set(view.books.map(b => getTokenDescription(Number(b.book.chainId) as ChainId, getAddress(b.book.token)).symbol))].join(', ')
              )
            ),
            'The tokens this trader opens cycles in. A mandate only matches when it lists the token the trader operates in.'
          )
        )

        const $back = $intermediatePromise({
          $loader: $inlineSpinner,
          $display: map(async q => {
            const s = await q
            const root = s.root
            if (root !== null && isAddressEqual(root.account, view.master)) {
              return $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text('This is your account'))
            }
            const nowSec = getUnixTimestamp()
            const mine = root === null ? undefined : s.mandates.find(m => isAddressEqual(m.master, view.master) && isAddressEqual(m.puppet, root.account))
            const active = mine !== undefined && mine.expiry > BigInt(nowSec)
            return $Popover({
              $contentContainer: $editorPopoverContentContainer,
              $target: $ButtonSecondary({
                $container: $defaultMiniButtonPrimary,
                disabled: just(root === null),
                $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                  active ? $node(style({ width: '6px', height: '6px', borderRadius: '50%', background: palette.positive }))() : empty,
                  $text(active ? 'Backing' : 'Back'),
                  $popoverCaret()
                )
              })({ click: popMandateTether(map(() => view.master)) }),
              $open: map(
                () =>
                  $MandateEditor({
                    registry: s.registry,
                    master: view.master,
                    existing: mine,
                    draft: map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, view.master)) ?? null, draftMandateList)
                  })({ changeMandateDraft: changeMandateDraftTether() }),
                filter(key => isAddressEqual(key, view.master), popMandate)
              ),
              dismiss: changeMandateDraft
            })({})
          }, sessionQuery)
        })

        const $iconLink = (href: string, label: string, $glyph: I$Node): I$Node =>
          $anchor(
            attr({ href, target: '_blank', 'aria-label': label, title: label }),
            style({ color: palette.foreground, display: 'inline-flex', alignItems: 'center', padding: '4px' }),
            stylePseudo(':hover', { color: palette.message })
          )($glyph)

        const $profileOverview = $column(spacing.default)(
          $row(spacing.default, style({ alignItems: 'center', justifyContent: 'space-between' }))($identity, $back),
          $row(spacing.small, style({ alignItems: 'center' }))(
            $iconLink(getAccountExplorerUrl(view.master), 'View trading account on explorer', $icon({ $content: $external, width: '13px' })),
            $shareLink
          ),
          $vitals
        )

        const $metricsLead = $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'flex-start' }))(
          $metric(
            'Account value',
            $intermediatePromise({
              $loader: $inlineSpinner,
              $display: map(async q => {
                const tl = await q
                return $node(style({ fontWeight: '700', color: palette.message }))($text(tl.length ? `$${tl[tl.length - 1]!.value.toFixed(2)}` : '-'))
              }, timelineQuery)
            })
          ),
          $metric('Backing', $node(style({ fontWeight: '700', color: palette.message }))($text(backingUsd))),
          $metric('Marked value', $node(style({ fontWeight: '700', color: palette.message }))($text(readableTokenAmountLabel(value, markedValue))))
        )

        const $hero = $node(style({ position: 'relative', width: '100%', backgroundColor: palette.middleground, overflow: 'hidden', ...(isDesktopScreen ? { height: '480px' } : {}) }))(
          $node(style({ position: 'relative', width: '100%', maxWidth: '1400px', margin: '0 auto', ...(isDesktopScreen ? { height: '100%' } : {}) }))(
            $ValueTimeline({
              hideBalances,
              timelineQuery,
              unit: '$',
              label: 'Account value',
              tooltip:
                'Everything this trading account holds, over time: every settled deposit and withdrawal at its value when it landed, every mark the chronicle valued while a cycle was open, and each settlement at its closing value. The last point is the live value.',
              activityTimeframe,
              chartHeight: isDesktopScreen ? '480px' : '300px',
              $lead: $row(style({ flex: 1, pointerEvents: 'all' }))($metricsLead)
            })({ changeActivityTimeframe: changeActivityTimeframeTether() }),
            isDesktopScreen
              ? $node(style({ position: 'absolute', inset: '0', zIndex: 10, pointerEvents: 'none', background: `linear-gradient(to right, ${palette.middleground} 0%, ${palette.middleground} 22%, transparent 52%)` }))()
              : empty,
            $card(
              style({
                padding: '24px',
                zIndex: 20,
                border: `1px solid ${colorShade(palette.foreground, 15)}`,
                ...(isDesktopScreen ? { position: 'absolute', bottom: '36px', left: '20px', width: '440px', maxWidth: 'calc(100% - 40px)' } : { margin: '12px' })
              })
            )($profileOverview)
          )
        )

        const $balances = $panel(
          'Balances',
          {},
          $intermediatePromise({
            $loader: $inlineSpinner,
            $display: map(async q => {
              const rows = await q
              if (rows.length === 0) return $emptyNote('No balances yet', 'What this trading account has deposited on each chain appears here.')
              return $column(spacing.default)(
                ...rows.map(r => {
                  const desc = getTokenDescription(r.chainId, r.token)
                  return $row(spacing.small, style({ alignItems: 'center' }))(
                    $tokenProfile(r.chainId, r.token, 28),
                    $node(style({ flex: 1 }))(),
                    $amountDisplay({
                      hideBalances,
                      usd: map(price => formatUsd(r.balance, price), priceFor(r.chainId, r.token)),
                      amount: readableTokenAmountLabel(desc, r.balance),
                      align: 'flex-end'
                    })
                  )
                })
              )
            }, balancesQuery)
          })
        )

        const $backerDistribution = $panel(
          'Backer distribution',
          { flex: 1 },
          view.backers.length === 0
            ? $emptyNote('No backers yet', 'Backers who sign a mandate and get matched into a cycle appear here with their share.')
            : (() => {
                const ranked = [...view.backers].sort((a, b) => (b.stake + b.pending > a.stake + a.pending ? 1 : -1))
                const total = ranked.reduce((acc, b) => acc + b.stake + b.pending, 0n)
                return $column(spacing.default)(
                  ...ranked.map(b => {
                    const held = b.stake + b.pending
                    const share = total > 0n ? Number((held * 10000n) / total) / 100 : 0
                    return $column(spacing.tiny)(
                      $row(spacing.small, style({ alignItems: 'center' }))(
                        $jazzicon(getAddress(b.puppet), 26),
                        $accountLabel({ address: b.puppet }),
                        $node(style({ flex: 1 }))(),
                        $amountDisplay({
                          hideBalances,
                          usd: map(price => formatUsd(held, price), priceFor(HUB_CHAIN_ID, VALUE_TOKEN)),
                          amount: readableTokenAmountLabel(value, held),
                          align: 'flex-end'
                        })
                      ),
                      $node(style({ height: '4px', borderRadius: '4px', backgroundColor: colorShade(palette.foreground, 20) }))(
                        $node(style({ height: '4px', borderRadius: '4px', width: `${share}%`, backgroundColor: palette.primary }))()
                      )
                    )
                  })
                )
              })()
        )

        const $bookLine = (v: ITradeView): I$Node => {
          const chainId = Number(v.book.chainId) as ChainId
          const open = v.book.cycle > v.settledCycle
          const markLabel = v.mark === undefined ? '-' : v.mark.pending || v.mark.closeValue === undefined ? 'evaluating' : readableTokenAmountLabel(value, v.mark.closeValue)
          return $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
            $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '160px' }))(
              $chainIcon(chainId, 26),
              $column(spacing.tiny)(
                $node(style({ fontWeight: '600' }))($text(getTokenDescription(chainId, getAddress(v.book.token)).symbol)),
                $node(style({ color: palette.foreground, fontSize: text.xs }))($text(`${chainFor(chainId).name} · cycle ${v.book.cycle} · ${open ? 'open' : 'settled'}`))
              )
            ),
            $column(spacing.tiny, style({ minWidth: '140px' }))(
              $node(style({ fontSize: text.sm }))($text(`${readableTokenAmountLabel(value, v.book.backed)} backing`)),
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text(`${v.book.backerList.length} backer${v.book.backerList.length === 1 ? '' : 's'}`))
            ),
            $column(spacing.tiny, style({ minWidth: '110px', alignItems: 'flex-end' }))(
              $node(style({ fontWeight: '700', color: palette.message }))($text(markLabel)),
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text('marked value'))
            )
          )
        }
        const $books = $panel(
          'Books',
          { flex: 1, minWidth: 0 },
          view.books.length === 0 ? $emptyNote('No cycle opened yet', 'A book appears once this trader opens a cycle on a chain.') : $column(style({ gap: '0' }))(...view.books.map($bookLine))
        )

        const $positionRow = (pos: IGmxPositionRow): I$Node => {
          const indexToken = marketIndexToken(pos.market)
          const symbol = indexToken ? getGmxTokenDescription(indexToken).symbol : '?'
          const pnl: IStream<bigint> =
            indexToken === null
              ? just(pos.storedPnlUsd)
              : map(price => (price === null ? pos.storedPnlUsd : getPositionPnlUsd(pos.isLong, pos.sizeInUsd, pos.sizeInTokens, price)), priceFor(GMX_V2_CHAIN_ID, indexToken))
          const netValue = map(v => `$${readableUnitAmount(formatFixed(USD_DECIMALS, pos.collateralUsd + v))}`, pnl)
          return $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'center' }))(
            $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '0' }))(
              $tokenIconBySymbol(symbol, '28px'),
              $node(style({ fontSize: text.base, color: palette.message, fontWeight: '600' }))($text(symbol)),
              $directionPill(pos.isLong)
            ),
            $size(pos.sizeInUsd, pos.collateralUsd),
            $column(spacing.tiny, style({ alignItems: 'flex-end', minWidth: '64px' }))($pnlDisplay(pnl), $separator2),
            $column(spacing.tiny, style({ alignItems: 'flex-end', minWidth: '72px' }))(
              $node(style({ fontWeight: '700', fontSize: text.base, color: palette.message }))($text(netValue)),
              $node(style({ fontSize: text.xs, color: palette.foreground }))($text(readableTokenAmountLabel(getGmxTokenDescription(pos.collateralToken), pos.collateralAmount)))
            )
          )
        }
        const $openPositions = $panel(
          'Open positions',
          { flex: 1, minWidth: 0 },
          $intermediatePromise({
            $loader: $inlineSpinner,
            $display: map(async q => {
              const list = await q
              if (list.length === 0) return $emptyNote('No open positions', 'Positions this trader holds on GMX appear here while they are open.')
              return $column(spacing.default)(...list.map($positionRow))
            }, positionsQuery)
          })
        )

        const $operationCell = (a: IAccountAction): I$Node => {
          const accent = a.kind === 'operate' ? palette.message : palette.primary
          const summary = a.kind === 'operate' ? operationSummary(a.chainId, a.steps) : null
          const titles = summary === null ? [] : summary.actions.map(x => x.title)
          const label = a.kind === 'settle' ? 'Settle' : a.kind === 'draw' ? 'Draw' : titles.length === 0 ? 'Operate' : titles.join(' · ')
          const detailList = summary === null ? [] : [...summary.flows.map(readableFlow), ...summary.actions.flatMap(x => x.details)]
          const context =
            a.kind === 'operate'
              ? `cycle ${a.cycle} · ${a.backers} backer${a.backers === 1 ? '' : 's'}`
              : a.kind === 'settle'
                ? `cycle ${a.cycle} on ${chainName(a.chainId)}`
                : a.kind === 'draw'
                  ? `cycle ${a.cycle} drawn for ${chainName(Number(a.spokeChainId))}`
                  : null
          return $column(spacing.tiny, style({ minWidth: 0 }))(
            $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }))(
              $node(style({ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: accent, flexShrink: '0' }))(),
              $node(style({ fontWeight: '600', color: accent, fontSize: text.sm }))($text(label)),
              ...(context === null ? [] : [$node(style({ color: palette.foreground, fontSize: text.xs, whiteSpace: 'nowrap' }))($text(context))])
            ),
            ...(detailList.length > 0
              ? [$node(style({ color: palette.foreground, fontSize: text.xs, paddingLeft: '15px' }))($text(detailList.join(' · ')))]
              : [])
          )
        }
        const $operationValue = (a: IAccountAction): I$Node => {
          if (a.kind === 'operate') {
            return $column(spacing.tiny, style({ alignItems: 'flex-end' }))(
              $node(style({ fontSize: text.sm }))($text(readableTokenAmountLabel(value, a.value))),
              $node(style({ fontSize: text.xs, color: palette.foreground }))($text(`${readableTokenAmountLabel(value, a.backed)} backing`))
            )
          }
          if (a.kind !== 'settle') return empty
          return $column(spacing.tiny, style({ alignItems: 'flex-end' }))(
            $node(style({ fontSize: text.sm }))($text(readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.value))),
            $node(style({ fontSize: text.xs, color: palette.foreground }))($text('at close'))
          )
        }
        const $operations = $panel(
          'Operations',
          { flex: 1, minWidth: 0 },
          $intermediatePromise({
            $loader: $inlineSpinner,
            $display: map(async q => {
              const list = await q
              if (list.length === 0) return $emptyNote('No operations yet', 'Cycle opens, settlements and draws this trader executes appear here as they settle.')
              const now = getUnixTimestamp()
              return $Table<IAccountAction>({
                dataSource: list,
                columns: [
                  { $head: $text('Action'), gridTemplate: 'minmax(140px, 1.6fr)', $bodyCallback: map((a: IAccountAction) => $operationCell(a)) },
                  { $head: $node(style({ flex: 1, textAlign: 'right' }))($text('Value')), gridTemplate: 'minmax(110px, 1fr)', $bodyCallback: map((a: IAccountAction) => $operationValue(a)) },
                  {
                    $head: $node(style({ flex: 1, textAlign: 'right' }))($text('Time')),
                    gridTemplate: 'minmax(100px, auto)',
                    $bodyCallback: map((a: IAccountAction) =>
                      $row(spacing.small, style({ alignItems: 'center', placeContent: 'flex-end', flex: 1 }))(
                        $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(`${getDuration(now - a.time)} ago`)),
                        $anchor(attr({ href: chainExplorerTxUrl(a.chainId, a.txHash), target: '_blank' }), style({ color: colorShade(palette.foreground, 70), display: 'flex', alignItems: 'center' }))(
                          $icon({ $content: $external, width: '12px', viewBox: '0 0 24 24', fill: 'currentColor' })
                        )
                      )
                    )
                  }
                ]
              })({})
            }, operationsQuery)
          })
        )

        const $activity = $panel(
          'Activity',
          { flex: 1, minWidth: 0 },
          view.settlements.length === 0 && view.backers.length === 0
            ? $emptyNote('No activity yet', 'Settlements paid to backers appear here as cycles close.')
            : $column(style({ gap: '0' }))(
                ...view.settlements.map(s =>
                  $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                    $column(spacing.tiny, style({ flex: 1, minWidth: '160px' }))(
                      $text(`cycle ${s.cycle} · ${s.kind === 'draw' ? 'losses drawn' : 'gains settled'}`),
                      $node(style({ color: palette.foreground, fontSize: text.xs }))(
                        $text(`${chainName(Number(s.spokeChainId))} · ${new Date(s.blockTimestamp * 1000).toLocaleString()}`)
                      )
                    ),
                    $column(spacing.tiny, style({ minWidth: '120px', alignItems: 'flex-end' }))(
                      view.outcomes.get(s.id) == null
                        ? $node(style({ color: palette.foreground }))($text('evaluating'))
                        : $signedToken(value, view.outcomes.get(s.id)!.pnl),
                      $node(style({ color: palette.foreground, fontSize: text.xs }))(
                        $text(s.kind === 'draw' ? 'drawn from bond on the hub' : 'paid out on the trading chain')
                      )
                    )
                  )
                )
              )
        )

        return $column(spacing.default, style({ width: '100%' }))(
          $breadcrumb,
          $hero,
          $responsiveFlex(style({ alignItems: 'flex-start', maxWidth: '1400px', width: '100%', margin: '0 auto', padding: isDesktopScreen ? '0 20px' : '0 12px' }))(
            $column(spacing.default, style({ width: isDesktopScreen ? '440px' : '100%', flexShrink: 0 }))($balances, $backerDistribution),
            $column(spacing.default, style({ flex: 1, minWidth: 0 }))($books, $openPositions, $operations, $activity)
          )
        )
      }

      return [
        $intermediatePromise({
          $display: map(async q => {
            const view = await q
            return view === undefined ? $unknown : $page(view)
          }, viewQuery)
        }),
        { changeMandateDraft, changeActivityTimeframe }
      ]
    }
  )
