import { CHAIN_IDS, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__Position } from '@puppet/contracts/types'
import { fundSymbolOf, gridOf, predictUserAccount } from '@puppet/sdk/account'
import type { ChainId, IntervalTime } from '@puppet/sdk/const'
import {
  formatFixed,
  getAccountExplorerUrl,
  getTokenDescription,
  getTxExplorerUrl,
  getUnixTimestamp,
  readableAddress,
  readablePercentage,
  readableTokenAmountLabel
} from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { cashFor } from '@puppet/sdk/pool'
import type { IMandateRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey } from '@puppet/sdk/state'
import { robotCellsOf } from '@puppet/sdk/ui-components'
import { VENUES } from '@puppet/sdk/venue'
import { combine, constant, delay, empty, filter, type IStream, just, map, merge, nowWith, op, start, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, type INode, type IStyleCSS, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, designSheet, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, href, pushUrl } from 'aelea/ui-router'
import { type Address, getAddress, isAddressEqual } from 'viem'
import {
  $anchor,
  $arrowRight,
  $ButtonSecondary,
  $copy,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $defaultTooltipDropContainer,
  $defaultVScrollContainer,
  $external,
  $icon,
  $infoLabel,
  $infoTooltip,
  $inlineSpinner,
  $intermediatePromise,
  $popoverCaret,
  $puppeteer,
  $Table,
  $Tooltip,
  type IPageRequest,
  type TablePageResponse,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { chainName } from '../common/$chain.js'
import { $tokenProfile } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $venueIcon } from '../common/$operationView.js'
import { $heading3 } from '../common/$text.js'
import { $card, $responsiveFlex } from '../common/elements/$common.js'
import { operationSummary } from '../common/operation.js'
import { $accountLabel } from '../components/$AccountProfile.js'
import type { IPerformanceMetric } from '../components/$PerformanceMetric.js'
import { $ValueTimeline } from '../components/participant/$ValueTimeline.js'
import { $FamilyToggle, FAMILY, FAMILY_LABEL, type IFamily, PAGE } from '../components/portfolio/$AccountHistory.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import type { IMandateDraft } from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import context from '../io/context.js'
import { fetchMasterMetrics } from '../io/datastore/reads.js'
import { type ITraderView, masterMetric, traderPositions, traderTimeline, traderView, unitPriceOf } from '../io/datastore/traders.js'
import { accountHead, walkAccount } from '../io/journal/archive.js'
import { accountHistory, type IAccountAction } from '../io/journal/history.js'
import { formatUsd, priceFor } from '../io/price.js'
import { $amountDisplay } from '../ui-components/$hintAdjustment.js'
import { balanceAt, type IRootState } from '../wallet/index.js'
import { $OpenPositions, type IShownValuation, markOf, valuedLabel } from './$OpenPositions.js'
import { $navPill } from './$onboarding.js'
import { $caption, $emptyNote, $headerFigure, $headerStub, ago } from './common.js'
import type { IPageFilterParams } from './types.js'

export interface I$TraderPage extends IPageFilterParams {
  master: Address
  hideBalances: IStream<boolean>
  walletRoot: IStream<IRootState | null>
  mandatesQuery: IStream<Promise<IMandateRow[]>>
  draftMandateList: IStream<IMandateDraft[]>
}

const VALUE_TOKEN = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
const BOND_TOKEN = bondTokenOf(HUB_CHAIN_ID)
const value = getTokenDescription(HUB_CHAIN_ID, VALUE_TOKEN)
const bond = getTokenDescription(HUB_CHAIN_ID, BOND_TOKEN)

const $sectionLabel = (label: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500', letterSpacing: '0.5px' }))($text(label))

const $panel = (label: string, extraStyle: IStyleCSS, $content: I$Node, tooltip?: string, $headerEnd?: I$Node): I$Node => {
  const $title = tooltip === undefined ? $sectionLabel(label) : $row(spacing.tiny, style({ alignItems: 'center' }))($sectionLabel(label), $infoTooltip(tooltip, palette.foreground))
  return $column(spacing.default, style({ backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px', ...extraStyle }))(
    $headerEnd === undefined ? $title : $row(style({ alignItems: 'center', justifyContent: 'space-between', gap: '12px' }))($title, $headerEnd),
    $content
  )
}

const $metric = (label: string, $value: I$Node): I$Node =>
  $column(spacing.tiny)($infoLabel($node(style({ whiteSpace: 'nowrap' }))($text(label))), $value)

const $value = (label: string, $v: I$Node, tooltip?: string): I$Node =>
  $column(spacing.tiny)(
    tooltip
      ? $row(spacing.tiny, style({ alignItems: 'center' }))($infoLabel($text(label)), $infoTooltip(tooltip, palette.foreground))
      : $infoLabel($text(label)),
    $node(style({ fontWeight: '700' }))($v)
  )

const $rowSeparator = $node(style({ height: '1px', margin: '0 10px', backgroundColor: colorShade(palette.foreground, 15) }))()

const $hoverList = (rows: I$Node[]): I$Node =>
  $column(style({ margin: '0 -10px' }))(
    ...rows.flatMap((row, i) => {
      const $item = $row(style({ padding: '8px 10px', borderRadius: '6px', alignItems: 'center' }), stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 8) }))(row)
      return i === 0 ? [$item] : [$rowSeparator, $item]
    })
  )

const $total = (amount: bigint): I$Node => $headerFigure(readableTokenAmountLabel(value, amount))

interface ILeg {
  chainId: ChainId
  token: Address
  amount: bigint
}

const leg = (chainId: ChainId | bigint, token: Address, amount: bigint): ILeg => ({ chainId: Number(chainId) as ChainId, token, amount })
const bondLeg = (amount: bigint): ILeg => leg(HUB_CHAIN_ID, BOND_TOKEN, amount)

const legsOf = (a: IAccountAction): { ins: ILeg[]; outs: ILeg[] } => {
  switch (a.kind) {
    case 'deposit':
      return { ins: [leg(a.chainId, a.token, a.amount)], outs: [] }
    case 'selfWithdraw':
    case 'withdraw':
      return { ins: [], outs: [leg(a.chainId, a.token, a.amount)] }
    case 'swap':
    case 'fundSwap':
      return { ins: [leg(a.destinationChainId, a.outputToken, a.outputAmount)], outs: [leg(a.chainId, a.token, a.amount)] }
    case 'operate': {
      const flows = a.steps.flatMap(s => (s.kind === 'venue' ? s.flows : []))
      return {
        ins: flows.filter(f => f.delta > 0n).map(f => leg(a.chainId, f.token, f.delta)),
        outs: flows.filter(f => f.delta < 0n).map(f => leg(a.chainId, f.token, -f.delta))
      }
    }
    case 'allocate':
      return { ins: a.credit === null ? [] : [leg(a.credit.chainId, a.credit.token, a.credit.amount)], outs: [] }
    case 'escrow':
      return { ins: [], outs: [leg(a.chainId, a.token, a.amount)] }
    case 'fulfil':
      return { ins: [leg(a.chainId, a.token, a.amount)], outs: [] }
    case 'refund':
      return { ins: [], outs: [leg(a.chainId, a.token, a.amount)] }
    case 'allocation':
      return { ins: [], outs: [bondLeg(a.stake)] }
    case 'sell':
    case 'claim':
      return { ins: [bondLeg(a.payout)], outs: [] }
    case 'sellFee':
    case 'claimFee':
      return { ins: [bondLeg(a.payoutFee)], outs: [] }
    case 'redeem':
      return { ins: [], outs: [bondLeg(a.cash)] }
    case 'genesis':
    case 'createFund':
    case 'revoke':
    case 'withdrawRequest':
    case 'mandate':
      return { ins: [], outs: [] }
  }
}

const describeAction = (a: IAccountAction): { label: string; venue: string | null; detail: string } => {
  switch (a.kind) {
    case 'genesis':
      return { label: a.parent === null ? 'Account created' : 'Fund account created', venue: null, detail: '' }
    case 'createFund':
      return { label: 'Fund opened', venue: null, detail: '' }
    case 'revoke':
      return { label: 'Signers revoked', venue: null, detail: '' }
    case 'withdrawRequest':
      return { label: 'Withdrawal requested', venue: null, detail: '' }
    case 'escrow':
      return { label: 'Escrowed', venue: null, detail: `${readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.amount)} committed` }
    case 'fulfil':
      return { label: 'Escrow released', venue: null, detail: readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.amount) }
    case 'refund':
      return { label: 'Escrow refunded', venue: null, detail: readableTokenAmountLabel(getTokenDescription(a.chainId, a.token), a.amount) }
    case 'deposit':
      return { label: 'Deposit', venue: null, detail: 'into the personal balance' }
    case 'selfWithdraw':
      return { label: 'Withdrawal', venue: null, detail: 'from the personal balance' }
    case 'swap':
      return { label: 'Deposit across', venue: null, detail: `to ${chainName(Number(a.destinationChainId))}` }
    case 'withdraw':
      return { label: 'Withdraw', venue: null, detail: 'to the wallet' }
    case 'operate': {
      const actions = operationSummary(a.chainId, a.steps).actions
      const venue = actions.map(x => x.venue).find(name => VENUES.some(v => v.name === name)) ?? null
      return { label: venue ?? 'Trade', venue, detail: actions.map(x => x.label).join(', ') }
    }
    case 'fundSwap':
      return { label: 'Account swap', venue: null, detail: Number(a.destinationChainId) === a.chainId ? '' : `to ${chainName(Number(a.destinationChainId))}` }
    case 'allocate': {
      const raised = a.backers > 0 ? `, ${a.backers} backer${a.backers === 1 ? '' : 's'} joined` : ''
      const slice =
        a.fee === null
          ? ''
          : a.credit !== null && a.credit.chainId !== HUB_CHAIN_ID
            ? `; ${readableTokenAmountLabel(getTokenDescription(a.credit.chainId, a.credit.token), a.billed)} of the fee is billed on ${chainName(a.credit.chainId)} when the escrow releases`
            : `; trader paid ${readableTokenAmountLabel(bond, a.masterSlice)} of the fee`
      return { label: 'Allocate', venue: null, detail: `credited ${readableTokenAmountLabel(bond, a.credited)}${raised}${slice}` }
    }
    case 'allocation':
      return { label: 'Backed', venue: null, detail: `a round of ${readableAddress(a.master)}` }
    case 'sell':
      return { label: 'Sold units', venue: null, detail: `of ${readableAddress(a.master)}` }
    case 'sellFee':
      return { label: 'Performance fee', venue: null, detail: `backer ${readableAddress(a.puppet)} sold` }
    case 'redeem':
      return { label: 'Redeem', venue: null, detail: `paid ${readableTokenAmountLabel(bond, a.payout)} to sellers` }
    case 'claim':
      return { label: 'Claim', venue: null, detail: `from ${readableAddress(a.master)}` }
    case 'claimFee':
      return { label: 'Performance fee', venue: null, detail: `backer ${readableAddress(a.holder)} claimed` }
    case 'mandate':
      return { label: 'Mandate', venue: null, detail: a.masters.map(m => readableAddress(m.master)).join(', ') }
  }
}

export const $TraderPage = ({ master, hideBalances, activityTimeframe, walletRoot, mandatesQuery, draftMandateList }: I$TraderPage) =>
  component(
    (
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [copyShareLink, copyShareLinkTether]: IBehavior<INode, string>,
      [popMandate, popMandateTether]: IBehavior<PointerEvent, Address>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,
      [selectFamily, selectFamilyTether]: IBehavior<IFamily>,
      [clickHistoryFilters, clickHistoryFiltersTether]: IBehavior<PointerEvent>,
      [requestHistoryPage, requestHistoryPageTether]: IBehavior<IPageRequest>
    ) => {
      const family: IStream<IFamily> = state('all' as IFamily, selectFamily)
      const performanceMetric = op(uiStorage.replayWrite(localStoreSchema.global.performanceMetric, changePerformanceMetric), state())
      const viewQuery: IStream<Promise<ITraderView | undefined>> = op(just(traderView(master)), state())
      const valuationQuery: IStream<Promise<IShownValuation | null>> = op(
        viewQuery,
        map(async q => {
          const view = await q
          const last = view?.valuations.at(-1)
          return last === undefined ? null : markOf(last, view!.fundRow)
        }),
        state()
      )
      const sessionQuery = op(
        combine({ root: walletRoot, mandates: mandatesQuery }),
        map(async p => ({ root: p.root, mandates: await p.mandates, registry: await context.getTokenRegistry() })),
        state()
      )
      const historyQuery = op(
        viewQuery,
        map(async q => {
          const view = await q
          if (view === undefined) return []
          const user = view.user
          const subjects = user === null ? [] : [{ account: view.master, user }, { account: predictUserAccount(user), user }]
          const journals = await Promise.all(
            subjects.map(async subject => ({
              account: subject.account,
              entries: new Map(
                await Promise.all(
                  CHAIN_IDS.map(async id => {
                    const chainId = id as ChainId
                    return [
                      chainId,
                      await walkAccount(chainId, subject.account, subject.user, await accountHead(chainId, subject.account))
                    ] as const
                  })
                )
              )
            }))
          )
          return accountHistory(journals)
        }),
        state()
      )
      const pnlQuery = op(
        activityTimeframe,
        map(async tf => {
          const rows = await fetchMasterMetrics(tf, [master])
          const until = getUnixTimestamp()
          return rows.length === 0 ? null : masterMetric(rows, tf, until - tf, until)
        }),
        state()
      )
      const timelineQuery = op(
        combine({ view: viewQuery, tf: activityTimeframe, metric: performanceMetric, pnl: pnlQuery }),
        map(async p => {
          if (p.metric === 'pnl') return (await p.pnl)?.points ?? []
          const view = await p.view
          if (view === undefined) return []
          const until = getUnixTimestamp()
          return traderTimeline(view.valuations, until - p.tf, until)
        }),
        state()
      )
      const positionsQuery = op(
        viewQuery,
        map(async q => {
          const view = await q
          return view === undefined ? [] : traderPositions(view.master)
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
        $defaultAnchor(
          attr({ href: href(routeSchema.traders) }),
          style({ color: palette.foreground, textDecoration: 'underline', textUnderlineOffset: '3px' }),
          effectProp(
            'onclick',
            nowWith(() => (ev: MouseEvent) => {
              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
              ev.preventDefault()
              pushUrl(href(routeSchema.traders))
            })
          )
        )($text('Traders')),
        $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
        $intermediatePromise({
          $loader: $node(style({ color: palette.message }))($text(readableAddress(master))),
          $display: map(async q => {
            const fundRow = (await q)?.fundRow
            return $node(style({ color: palette.message }))($text(fundRow === undefined ? readableAddress(master) : fundSymbolOf(fundRow)))
          }, viewQuery)
        })
      )

      const $unknown = $card(spacing.big)(
        $heading3($text('Unknown trader')),
        $infoLabel($text(`${readableAddress(master)} has not traded yet.`)),
        $row($navPill('All traders', routeSchema.traders, false))
      )

      const $page = (view: ITraderView): I$Node => {
        const fundRow = view.fundRow
        const name = fundRow === undefined ? readableAddress(view.master) : fundSymbolOf(fundRow)
        const backers = view.holdings.filter(h => !isAddressEqual(h.holder, view.master))
        const backing = fundRow === undefined ? null : cashFor(backers.reduce((total, h) => total + h.units, 0n), fundRow.totalUnits, fundRow.value)
        const $dash = $node(style({ color: palette.foreground }))($text('-'))
        const lastMark = view.valuations[view.valuations.length - 1]
        const markAge = lastMark === undefined ? null : ago(lastMark.blockTimestamp)

        const $identity = $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
          $node(style({ width: '56px', height: '56px', borderRadius: '50%', overflow: 'hidden', flexShrink: '0' }))($fundAvatar(fundRow === undefined ? robotCellsOf(view.master) : gridOf(fundRow), 56)),
          $column(style({ minWidth: '0', gap: '2px' }))(
            $node(style({ fontWeight: '600', fontSize: isDesktopScreen ? text.lg : text.base, color: palette.message, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(name)),
            $row(spacing.tiny, style({ alignItems: 'center' }))($accountLabel({ address: view.master, primarySize: 1 }))
          )
        )

        const $liveValue = $intermediatePromise({
          $loader: $inlineSpinner,
          $display: map(async q => {
            const shown = await q
            if (shown === null) return $dash
            return $column(spacing.tiny)(
              $amountDisplay({
                hideBalances,
                usd: map(price => formatUsd(shown.value, price), priceFor(HUB_CHAIN_ID, VALUE_TOKEN)),
                amount: readableTokenAmountLabel(value, shown.value),
                align: 'flex-start'
              }),
              $caption(`after the last round, ${ago(Number(shown.time))}`)
            )
          }, valuationQuery)
        })

        const $vitals = $row(spacing.big, style({ flexWrap: 'wrap', rowGap: '12px' }))(
          $value(
            'Fund value',
            $liveValue,
            'Everything the fund holds across chains and venues after its last round: the attested mark plus what the round brought in or paid out.'
          ),
          $value(
            'Backing',
            backing === null
              ? $dash
              : $amountDisplay({
                  hideBalances,
                  usd: map(price => formatUsd(backing, price), priceFor(HUB_CHAIN_ID, VALUE_TOKEN)),
                  amount: readableTokenAmountLabel(value, backing),
                  align: 'flex-start'
                }),
            `What the backers' shares are worth at the last mark${markAge === null ? '' : `, ${markAge}`}.`
          ),
          $value('Backers', $node(style({ color: palette.message }))($text(`${backers.length}`))),
          $value(
            'Queued',
            $node(style({ color: palette.message }))(
              $text(fundRow === undefined ? '-' : readableTokenAmountLabel(value, view.queue === undefined ? 0n : cashFor(view.queue.units, fundRow.totalUnits, fundRow.value)))
            ),
            'What backers have sold and wait for the trader to redeem, at the last mark.'
          ),
          $value(
            'Fee',
            $node(style({ color: palette.message }))($text(readablePercentage(PROTOCOL.performanceFee))),
            'Performance fee the trader takes on backer gains when their share pays out.'
          ),
          $value(
            'Skin',
            $node(style({ color: palette.message }))($text(fundRow === undefined ? '-' : readablePercentage(fundRow.skin))),
            'The share of the pool the trader must keep; it is the strictest skin among the mandates of current backers.'
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
                $container: active ? $defaultMiniButtonPrimary(style({ borderColor: palette.indeterminate })) : $defaultMiniButtonPrimary,
                disabled: just(false),
                $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Back'), $popoverCaret())
              })({ click: popMandateTether(map(() => view.master)) }),
              $open: map(
                () =>
                  $MandateEditor({
                    master: view.master,
                    existing: mine,
                    draft: map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, view.master)) ?? null, draftMandateList),
                    needsDeposit: root === null || balanceAt(root.balances, HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)) === 0n
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
          $row(spacing.default, style({ alignItems: 'center' }))($identity, $back),
          $row(spacing.small, style({ alignItems: 'center' }))(
            $iconLink(getAccountExplorerUrl(view.master), 'View trading account on explorer', $icon({ $content: $external, width: '13px' })),
            $shareLink
          ),
          $vitals
        )

        const $metricsLead = $row(isDesktopScreen ? spacing.big : spacing.default, style({ alignItems: 'flex-start' }))(
          $metric(
            'PnL',
            $intermediatePromise({
              $loader: $inlineSpinner,
              $display: map(async q => {
                const pnl = (await q)?.pnl ?? null
                return $column(spacing.tiny)(
                  $node(style({ fontWeight: '700', color: pnl === null || pnl === 0n ? palette.message : pnl > 0n ? palette.positive : palette.negative }))(
                    $text(pnl === null ? '-' : `${pnl > 0n ? '+' : ''}${readableTokenAmountLabel(value, pnl)}`)
                  ),
                  $caption(markAge === null ? 'from marks' : `through the mark ${markAge}`)
                )
              }, pnlQuery)
            })
          ),
          $metric(
            'Unit price',
            $column(spacing.tiny)(
              $node(style({ fontWeight: '700', color: palette.message }))($text(lastMark === undefined ? '-' : `$${formatFixed(value.decimals, unitPriceOf(lastMark)).toFixed(4)}`)),
              $caption(markAge === null ? 'no mark yet' : `marked ${markAge}`)
            )
          )
        )

        const $hero = $node(style({ position: 'relative', width: '100%', backgroundColor: palette.middleground, overflow: 'hidden', ...(isDesktopScreen ? { height: '480px' } : {}) }))(
          $node(style({ position: 'relative', width: '100%', maxWidth: '1400px', margin: '0 auto', ...(isDesktopScreen ? { height: '100%' } : {}) }))(
            $ValueTimeline({
              hideBalances,
              timelineQuery,
              unit: '$',
              label: map(metric => (metric === 'pnl' ? 'Profit & Loss' : 'Growth of $1'), performanceMetric),
              tooltip: map(
                metric =>
                  metric === 'pnl'
                    ? 'Realized and open profit of the fund over the timeframe, as of each mark.'
                    : 'What $1 put into this fund when it opened is worth at each mark. Allocations and redemptions buy in and out at this value, so it moves only with trading results and fees.',
                performanceMetric
              ),
              activityTimeframe,
              performanceMetric,
              chartHeight: isDesktopScreen ? '480px' : '300px',
              $lead: $row(style({ flex: 1, pointerEvents: 'all' }))($metricsLead)
            })({ changeActivityTimeframe: changeActivityTimeframeTether(), changePerformanceMetric: changePerformanceMetricTether() }),
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

        const cashOf = (positions: readonly IFund__Position[], total: bigint): bigint => total - positions.reduce((acc, p) => acc + p.valueInUsd, 0n)

        const $balances = $panel(
          'Balances',
          {},
          $intermediatePromise({
            $loader: $inlineSpinner,
            $display: map(async q => {
              const shown = await q
              if (shown === null || shown.assetList.length === 0) return $emptyNote('No balances', 'Cash the fund holds on each chain appears here.')
              return $column(spacing.default)(
                $hoverList(
                  shown.assetList.map(asset => {
                    const chainId = Number(asset.chainId) as ChainId
                    const token = getAddress(asset.token)
                    return $row(spacing.small, style({ alignItems: 'center', flex: 1 }))(
                      $tokenProfile(chainId, token, 28, true),
                      $node(style({ flex: 1 }))(),
                      $amountDisplay({
                        hideBalances,
                        usd: map(price => formatUsd(asset.amount, price), priceFor(chainId, token)),
                        amount: readableTokenAmountLabel(getTokenDescription(chainId, token), asset.amount),
                        align: 'flex-end'
                      })
                    )
                  })
                ),
                $caption(valuedLabel(shown))
              )
            }, valuationQuery)
          }),
          'Cash the fund holds on each chain at the last mark. Funds on a venue are under Open positions.',
          $intermediatePromise({
            $loader: $headerStub('72px'),
            $display: map(async q => {
              const shown = await q
              return shown === null ? empty : $total(cashOf(shown.positionList, shown.value))
            }, valuationQuery)
          })
        )

        const $distribution = $panel(
          'Distribution',
          { flex: 1 },
          fundRow === undefined || view.holdings.length === 0
            ? $emptyNote('No holders yet', 'The trader and backers who join an allocation round appear here with their share.')
            : (() => {
                const ranked = [...view.holdings].sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0))
                return $column(spacing.default)(
                  ...ranked.map(h => {
                    const held = cashFor(h.units, fundRow.totalUnits, fundRow.value)
                    const share = fundRow.totalUnits > 0n ? Number((h.units * 10000n) / fundRow.totalUnits) / 100 : 0
                    const isTrader = isAddressEqual(h.holder, view.master)
                    return $column(spacing.tiny)(
                      $row(spacing.small, style({ alignItems: 'center' }))(
                        $anchor(
                          attr({ href: `https://debank.com/profile/${getAddress(h.holder)}`, target: '_blank', title: 'Portfolio on DeBank' }),
                          style({ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, color: 'inherit', textDecoration: 'none' }),
                          stylePseudo(':hover', { opacity: '0.8' })
                        )(
                        $jazzicon(getAddress(h.holder), 26),
                        $column(spacing.tiny, style({ minWidth: 0 }))(
                          $row(spacing.tiny, style({ alignItems: 'center' }))(
                            $accountLabel({ address: h.holder }),
                            isTrader
                              ? $Tooltip({
                                  $dropContainer: $defaultTooltipDropContainer,
                                  $content: $node($text('The trader. Keeps at least the skin share of the pool; backers hold the rest.')),
                                  $anchor: $icon({ $content: $puppeteer, width: '13px', viewBox: '0 0 32 32', fill: palette.foreground, svgOps: style({ display: 'block', cursor: 'help' }) })
                                })({})
                              : empty
                          ),
                          $caption(`${share}% of the pool${h.allocatedAt > 0n && !isTrader ? `, joined ${ago(Number(h.allocatedAt))}` : ''}`)
                        )
                        ),
                        $node(style({ flex: 1 }))(),
                        $amountDisplay({
                          hideBalances,
                          usd: map(price => formatUsd(held, price), priceFor(HUB_CHAIN_ID, VALUE_TOKEN)),
                          amount: readableTokenAmountLabel(value, held),
                          align: 'flex-end'
                        })
                      ),
                      $node(style({ height: '4px', borderRadius: '4px', backgroundColor: colorShade(palette.foreground, 20) }))(
                        $node(style({ height: '4px', borderRadius: '4px', width: `${share}%`, backgroundColor: isTrader ? palette.indeterminate : palette.primary }))()
                      )
                    )
                  })
                )
              })(),
          `Who owns the pool, valued at the last mark${markAge === null ? '' : `, ${markAge}`}.`
        )

        const $openPositions = $panel(
          'Open positions',
          { flex: 1, minWidth: 0 },
          $OpenPositions({
            master,
            hideBalances,
            positions: positionsQuery,
            valuation: valuationQuery,
            $empty: $emptyNote('No open positions', 'Positions and funds this trader has on a venue or in transit appear here.')
          })({}),
          'Live GMX positions, plus every other venue book and transfer in flight at the last mark.',
          $intermediatePromise({
            $loader: $headerStub('72px'),
            $display: map(async q => {
              const shown = await q
              return shown === null || shown.positionList.length === 0 ? empty : $total(shown.positionList.reduce((acc, p) => acc + p.valueInUsd, 0n))
            }, valuationQuery)
          })
        )

        const $legs = (legs: ILeg[], sign: string, color: string): I$Node =>
          legs.length === 0
            ? $node(style({ color: colorShade(palette.foreground, 60), fontSize: text.sm }))($text('-'))
            : $column(spacing.tiny)(
                ...legs.map(l =>
                  $node(style({ color, fontSize: text.sm, whiteSpace: 'nowrap' }))($text(`${sign}${readableTokenAmountLabel(getTokenDescription(l.chainId, l.token), l.amount)}`))
                )
              )
        const $actionCell = (a: IAccountAction): I$Node => {
          const d = describeAction(a)
          const accent = a.kind === 'allocate' || a.kind === 'redeem' ? palette.primary : palette.message
          return $column(spacing.tiny, style({ minWidth: 0 }))(
            $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }))(
              d.venue === null
                ? $node(style({ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: accent, flexShrink: '0' }))()
                : $venueIcon(d.venue),
              $node(style({ fontWeight: '600', color: accent, fontSize: text.sm, whiteSpace: 'nowrap' }))($text(d.label)),
              $caption(`on ${chainName(Number(a.chainId))}`)
            ),
            ...(d.detail === '' ? [] : [$node(style({ color: palette.foreground, fontSize: text.xs, paddingLeft: '15px' }))($text(d.detail))])
          )
        }
        const $historyFilter = $Popover({
          $open: constant(
            $column(spacing.small, style({ minWidth: '240px' }))(
              $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Show')),
              $FamilyToggle({ family })({ selectFamily: selectFamilyTether() })
            ),
            clickHistoryFilters
          ),
          $target: $ButtonSecondary({
            $container: $defaultMiniButtonSecondary(style({ height: '32px', padding: '0 12px', fontSize: text.sm, fontWeight: '500' })),
            $content: $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
              $node($text(map((f: IFamily) => FAMILY_LABEL[f], family))),
              $popoverCaret()
            )
          })({ click: clickHistoryFiltersTether() })
        })({})
        const $history = $panel(
          'History',
          { flex: 1, minWidth: 0 },
          $intermediatePromise({
            $loader: $inlineSpinner,
            $display: map(async p => {
              const all = await p.query
              const list = p.family === 'all' ? all : all.filter(a => FAMILY[a.kind] === p.family)
              if (list.length === 0) return $emptyNote('Nothing here yet', 'Trades, fund swaps, allocations, deposits, withdrawals and redemptions appear here as they land.')
              const pageOf = (offset: number): Promise<TablePageResponse<IAccountAction>> =>
                Promise.resolve({ page: list.slice(offset, offset + PAGE), offset, pageSize: PAGE })
              return $Table<IAccountAction>({
                dataSource: merge(just(pageOf(0)), map(request => pageOf(request.offset), requestHistoryPage)),
                scrollConfig: {
                  $container: $defaultVScrollContainer(
                    designSheet.customScroll,
                    style({ maxHeight: '560px', overflowY: 'auto', marginRight: '-20px', paddingRight: '20px' })
                  )
                },
                columns: [
                  { $head: $text('Action'), gridTemplate: 'minmax(160px, 1.6fr)', $bodyCallback: map((a: IAccountAction) => $actionCell(a)) },
                  { $head: $text('In'), gridTemplate: 'minmax(90px, 1fr)', $bodyCallback: map((a: IAccountAction) => $legs(legsOf(a).ins, '+', palette.positive)) },
                  { $head: $text('Out'), gridTemplate: 'minmax(90px, 1fr)', $bodyCallback: map((a: IAccountAction) => $legs(legsOf(a).outs, '−', palette.negative)) },
                  {
                    $head: $text('Fee'),
                    gridTemplate: 'minmax(80px, auto)',
                    $bodyCallback: map((a: IAccountAction) =>
                      a.fee === null
                        ? $node(style({ color: colorShade(palette.foreground, 60), fontSize: text.sm }))($text('-'))
                        : $node(style({ fontSize: text.xs, color: colorShade(palette.foreground, 70), whiteSpace: 'nowrap' }))(
                            $text(readableTokenAmountLabel(getTokenDescription(a.chainId, a.fee.token), a.fee.amount))
                          )
                    )
                  },
                  {
                    $head: $node(style({ flex: 1, textAlign: 'right' }))($text('Time')),
                    gridTemplate: 'minmax(100px, auto)',
                    $bodyCallback: map((a: IAccountAction) =>
                      $row(spacing.small, style({ alignItems: 'center', placeContent: 'flex-end', flex: 1 }))(
                        $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(ago(a.time))),
                        $anchor(
                          attr({ href: getTxExplorerUrl(a.txHash, chainFor(a.chainId)), target: '_blank' }),
                          style({ color: colorShade(palette.foreground, 70), display: 'flex', alignItems: 'center' })
                        )($icon({ $content: $external, width: '12px', viewBox: '0 0 24 24', fill: 'currentColor' }))
                      )
                    )
                  }
                ]
              })({ scrollRequest: requestHistoryPageTether() })
            }, combine({ query: historyQuery, family }))
          }),
          'Venue trades, fund swaps, allocations, redemptions, fees and the personal balance across chains, newest first, read from the account log.',
          $historyFilter
        )

        return $column(spacing.default, style({ width: '100%' }))(
          $breadcrumb,
          $hero,
          $responsiveFlex(style({ alignItems: 'flex-start', maxWidth: '1400px', width: '100%', margin: '0 auto', padding: isDesktopScreen ? '0 20px' : '0 12px' }))(
            $column(spacing.default, style({ width: isDesktopScreen ? '440px' : '100%', flexShrink: 0 }))($balances, $distribution),
            $column(spacing.default, style({ flex: 1, minWidth: 0 }))($openPositions, $history)
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
