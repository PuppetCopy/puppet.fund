import { CHAIN_IDS, HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { fundSymbolOf, gridOf, type IStoredAccountCall } from '@puppet/sdk/account'
import { type IMandateDraft, type IOwnState, storedCalls, syncCalls } from '@puppet/sdk/client'
import { type ChainId, type IntervalTime, PRECISION, TOKEN_META } from '@puppet/sdk/const'
import { formatFixed, getAccountExplorerUrl, getTokenDescription, getUnixTimestamp, readableAddress, readablePercentage, readableTokenAmount } from '@puppet/sdk/core'
import { type IGetRate, USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { fundCostsOf, fundValuationsOf } from '@puppet/sdk/fold'
import { cashFor, performanceIndexOf, POOL_SHARE } from '@puppet/sdk/pool'
import { formatThrownError } from '@puppet/sdk/compact'
import { ACCOUNT_VENUE, accountTable, allowanceTable, balanceTable, flowTable, fundMetricTable, fundTable, type IFundRow } from '@puppet/sdk/schema'
import { fundMetric, pnlEventsAcross, tokenMetaByChainToken, tokenMetaKey, walletsOf } from '@puppet/sdk/state'
import { robotCellsOf } from '@puppet/sdk/ui-components'
import type { IDigestClient } from '@puppet/sdk/datastore'
import {
  combine,
  combineMap,
  delay,
  empty,
  filter,
  filterNull,
  fromPromise,
  type IStream,
  just,
  map,
  merge,
  nowWith,
  op,
  reduce,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { type IBehavior, type PromiseState, type PromiseStateDone, type PromiseStateError, PromiseStatus, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, type INode, type IStyleCSS, nodeEvent, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, href, pushUrl } from 'aelea/ui-router'
import { type Address, formatUnits, getAddress, isAddressEqual } from 'viem'
import {
  $alertTooltip,
  $anchor,
  $arrowRight,
  $ButtonSecondary,
  $copy,
  $defaultMiniButtonPrimary,
  $detailLine,
  $errorLabel,
  $externalMark,
  $icon,
  $infoLabel,
  $infoTooltip,
  $intermediateCircle,
  $intermediateFailure,
  $intermediatePill,
  $intermediateProfile,
  $intermediatePromise,
  $intermediateRow,
  $intermediateText,
  $popoverCaret,
  intermediateState,
  maskBalance,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { chainName } from '../common/$chain.js'
import { $tokenProfile, ethPrice } from '../common/$common.js'
import { $fundAvatar } from '../common/$fundAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card, $responsiveFlex } from '../common/elements/$common.js'
import { $accountLabel } from '../components/$AccountProfile.js'
import { $fundHolders } from '../components/$FundHolders.js'
import { mandateTermsOf } from '../components/$MandatePosition.js'
import { type IPerformanceMetric, performanceMetricLabelMap, pnlLabelOf } from '../components/$PerformanceMetric.js'
import { $ValueTimeline } from '../components/participant/$ValueTimeline.js'
import { $AccountHistory } from '../components/portfolio/$AccountHistory.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import { readFundBook } from '@puppet/sdk/intent'
import { $jazzicon, AVATAR_SIZE } from '../common/$avatar.js'
import { getPrice, getRate, localGetRate, localPrice } from '../io/context.js'
import { $avatarStack } from '../components/$avatarStack.js'
import { answerState, client, localFirst, localFirstQuery, localReader, notLocal } from '../io/datastore/reads.js'
import { mandatesInForce } from '../io/datastore/own.js'
import { CHART_POINTS, holdersOf, pnlTipOf } from '../io/datastore/traders.js'
import { accountHistory } from '../io/journal/history.js'
import { journalDeps } from '../io/journal/journal.js'
import type { IJournalEntries } from '@puppet/sdk/client'
import { viewCall } from '../io/onchain/viewRead.js'
import { formatUsd, formatUsdNumber, MINUS, priceFor, usdOf } from '../io/price.js'
import { fundBalancesOf, type IFundLive, type IOpenPositions, openPositionsOf, standingAllowancesOf } from '../io/venue.js'
import { $amountDisplay } from '../ui-components/$hintAdjustment.js'
import type { IRootState } from '../wallet/index.js'
import { $hoverList, $OpenPositions, $syncTip, TICK_SYNC_SCHEDULE_SEC } from './$OpenPositions.js'
import { $navPill } from './$onboarding.js'
import { $caption, $emptyNote, $headerFigure, $vital, ago } from './common.js'
import type { IPageFilterParams } from './types.js'

export interface I$TraderPage extends IPageFilterParams {
  master: Address
  hideBalances: IStream<boolean>
  walletRoot: IStream<Promise<IRootState | null>>
  journalQuery: IStream<Promise<{ bodyList: readonly { account: Address }[]; live: Promise<IFundLive> | null } | null>>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  draftMandateList: IStream<IMandateDraft[]>
}

type IAccountCalls = { calls: ReadonlyMap<ChainId, readonly IStoredAccountCall[]>; failures: ReadonlyMap<ChainId, unknown> }

const $sectionLabel = (label: string): I$Node =>
  $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500', letterSpacing: '0.5px' }))($text(label))

const OPEN_POSITIONS_TIP = 'What the fund holds on each venue it trades, as Puppet last read it: after any change to the fund, and at least hourly.'

const $performanceIndexTip = $column(spacing.tiny)(
  $node(style({ color: palette.foreground }))($text("Fund value per 1.00 invested, in ETH after the master's fee. It starts at 1.00, and new money joins at 1.00.")),
  $node(style({ fontWeight: '600' }))($text('Index = Fund value / Capital invested'))
)

const $panel = (label: string, extraStyle: IStyleCSS, $content: I$Node, header: { $tip: I$Node; $headerEnd?: I$Node }): I$Node => {
  const $title = $row(spacing.small, style({ alignItems: 'center' }))(
    $row(spacing.tiny, style({ alignItems: 'center' }))($sectionLabel(label), header.$tip)
  )
  return $column(spacing.default, style({ backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px', ...extraStyle }))(
    header.$headerEnd === undefined ? $title : $row(style({ alignItems: 'center', justifyContent: 'space-between', gap: '12px' }))($title, header.$headerEnd),
    $content
  )
}

const $notRefreshed = (failures: IStream<Promise<ReadonlyMap<ChainId, unknown>>>): I$Node =>
  switchLatest(
    op(
      intermediateState(failures),
      switchMap(s =>
        s.status !== PromiseStatus.DONE
          ? empty
          : just(
              s.value.size === 0
                ? empty
                : $alertTooltip(
                    $column(spacing.tiny)(...[...s.value].map(([chainId, error]) => $node($text(`${chainName(chainId)}: ${formatThrownError(error)}`)))),
                    $text('Not refreshed')
                  )
            )
      )
    )
  )

export const $TraderPage = ({ master, hideBalances, activityTimeframe, performanceMetric, walletRoot, journalQuery, ownStateQuery, draftMandateList }: I$TraderPage) =>
  component(
    (
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [copyShareLink, copyShareLinkTether]: IBehavior<INode, Promise<void>>,
      [popMandate, popMandateTether]: IBehavior<PointerEvent>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>
    ) => {
      const callsOf = (account: Address): IStream<Promise<IAccountCalls>> =>
        localFirst(
          () =>
            Promise.all(CHAIN_IDS.map(async id => [id as ChainId, await storedCalls(journalDeps.store, id as ChainId, account)] as const)).then(entries =>
              entries.every(([, calls]) => calls.length === 0) ? notLocal : { calls: new Map(entries), failures: new Map<ChainId, unknown>() }
            ),
          () =>
            syncCalls(journalDeps, null, CHAIN_IDS, [account], 'changed').then(async synced => {
              const chains = await Promise.all(
                [...synced.calls.get(getAddress(account))!].map(async ([chainId, result]) =>
                  result.status === 'fulfilled'
                    ? { chainId, calls: result.value, failure: null }
                    : { chainId, calls: await storedCalls(journalDeps.store, chainId, account), failure: { error: result.reason as unknown } }
                )
              )
              return {
                calls: new Map(chains.map(chain => [chain.chainId, chain.calls] as const)),
                failures: new Map(chains.flatMap(chain => (chain.failure === null ? [] : [[chain.chainId, chain.failure.error] as const])))
              }
            })
        )
      const liveQuery: IStream<Promise<IFundLive | null>> = op(
        intermediateState(walletRoot),
        map(s =>
          s.status !== PromiseStatus.DONE ? null : s.value !== null && s.value.fund !== null && 'account' in s.value.fund && isAddressEqual(s.value.fund.account, master)
        ),
        filterNull,
        skipRepeats,
        switchMap(
          (own): IStream<Promise<IFundLive | null>> =>
            own
              ? op(
                  journalQuery,
                  map(q => q.then(held => (held !== null && held.live !== null && held.bodyList.some(body => isAddressEqual(body.account, master)) ? held.live : null)))
                )
              : just(Promise.resolve(null))
        ),
        answerState
      )
      const liveAnswers = op(
        liveQuery,
        switchMap(q => fromPromise(q.then(read => ({ read, failure: null }), (error: unknown) => ({ read: null, failure: { error } })))),
        filter(answer => answer.read !== null || answer.failure !== null)
      )
      const fundReadOf = (reader: IDigestClient, rate: IGetRate) =>
        Promise.all([reader.find(fundTable, { master }), reader.select(fundMetricTable, { where: { master } }), readFundBook({ chronicle: reader }, master)]).then(
          ([fundRow, metricRows, book]) => {
            const held = book.holdings.filter(h => h.shares > 0n)
            return { fundRow, metricRows, book, held, wallets: walletsOf(reader, held.map(h => h.holder)), holders: holdersOf(reader, rate, book) }
          }
        )
      const fundReadQuery = op(
        merge(just(null), liveAnswers),
        switchMap(answer => {
          const fresh = answer === null ? null : fundReadOf(client, getRate)
          return op(
            fresh === null
              ? localFirst(
                  () => fundReadOf(localReader, localGetRate),
                  () => fundReadOf(client, getRate)
                )
              : op(
                  fromPromise(fresh.then(() => null, () => null)),
                  map(() => fresh)
                ),
            map(q => q.then(read => ({ ...read, answer })))
          )
        }),
        answerState
      )
      const fundRowQuery: IStream<Promise<IFundRow | undefined>> = op(fundReadQuery, map(q => q.then(read => read.fundRow)), answerState)
      const balanceRowsQuery = op(localFirstQuery(reader => reader.select(balanceTable, { where: { account: master } })), answerState)
      const ownerQuery: IStream<Promise<Address | null>> = op(
        localFirstQuery(reader => reader.select(accountTable, { where: { account: master } }).then(([row]) => (row === undefined ? null : getAddress(row.owner)))),
        answerState
      )
      const masterCallsQuery = op(
        merge(just(null), liveAnswers),
        switchMap(() => callsOf(master)),
        answerState
      )
      const valuationsQuery = op(
        masterCallsQuery,
        map(q =>
          q.then(read => {
            const hub = read.calls.get(HUB_CHAIN_ID as ChainId)
            if (hub === undefined) throw new Error(`the journal of ${master} holds no hub chain`)
            if (read.failures.has(HUB_CHAIN_ID as ChainId)) throw read.failures.get(HUB_CHAIN_ID as ChainId)
            return fundValuationsOf(master, hub)
          })
        ),
        answerState
      )
      const ownerCallsQuery: IStream<Promise<(IJournalEntries & Pick<IAccountCalls, 'failures'>) | null>> = op(
        ownerQuery,
        intermediateState,
        filter((s): s is PromiseStateDone<Address | null> | PromiseStateError => s.status !== PromiseStatus.PENDING),
        map(s => (s.status === PromiseStatus.DONE ? { owner: s.value } : { error: s.error })),
        skipRepeatsWith((a, b) => 'owner' in a && 'owner' in b && a.owner === b.owner),
        switchMap(found => {
          if ('error' in found) return just(Promise.reject(found.error))
          const owner = found.owner
          if (owner === null) return just(Promise.resolve(null))
          return op(
            callsOf(owner),
            map(q => q.then(read => ({ account: owner, entries: read.calls, failures: read.failures })))
          )
        }),
        answerState
      )
      const historyQuery = op(
        combine({ master: masterCallsQuery, owner: ownerCallsQuery }),
        map(p => Promise.all([p.master, p.owner]).then(([read, owner]) => accountHistory([{ account: master, entries: read.calls }, ...(owner === null ? [] : [owner])]))),
        answerState
      )
      const historyFailures = op(
        combine({ master: masterCallsQuery, owner: ownerCallsQuery }),
        map(p => Promise.all([p.master, p.owner]).then(([read, owner]) => new Map([...read.failures, ...(owner === null ? [] : owner.failures)])))
      )
      const sessionQuery = op(
        combine({ root: walletRoot, own: ownStateQuery }),
        map(p => Promise.all([p.root, p.own]).then(([root, own]) => ({ root, mandates: own === null ? [] : mandatesInForce(own) }))),
        answerState
      )
      const storedVenuesQuery = op(localFirstQuery(reader => openPositionsOf(reader, master, [], null, null)), answerState)
      const venuesQuery: IStream<Promise<IOpenPositions>> = op(
        merge(
          storedVenuesQuery,
          op(
            liveQuery,
            intermediateState,
            filter((s): s is PromiseStateDone<IFundLive | null> | PromiseStateError => s.status !== PromiseStatus.PENDING),
            map(s => (s.status === PromiseStatus.DONE ? { live: s.value } : { error: s.error })),
            sampleMap(
              (stored, read) =>
                'error' in read
                  ? stored.then(open => ({ ...open, failed: [...open.failed, { venue: ACCOUNT_VENUE, reason: formatThrownError(read.error) }] }))
                  : read.live === null
                    ? null
                    : Promise.resolve(read.live.open),
              storedVenuesQuery
            ),
            filterNull
          )
        ),
        answerState
      )
      const standingQuery = op(localFirstQuery(reader => reader.select(allowanceTable, { where: { account: master } }).then(rows => standingAllowancesOf(viewCall, rows))), answerState)
      const balancesQuery = op(
        combine({ read: masterCallsQuery, rows: balanceRowsQuery, venues: venuesQuery }),
        map(p =>
          Promise.all([p.read, p.rows, p.venues]).then(([read, rows, open]) => ({
            failures: read.failures,
            rows: fundBalancesOf(
              read.calls,
              rows.map(row => ({ chainId: Number(row.chainId) as ChainId, token: getAddress(row.token), amount: row.amount })),
              open.holdings
            )
              .filter(row => tokenMetaByChainToken.has(tokenMetaKey(row.chainId, row.token)))
              .map(row => ({ ...row, profile: getTokenDescription(row.chainId, row.token) }))
          }))
        ),
        answerState
      )
      const ethRateQuery = op(
        localFirst(
          () => localPrice(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH),
          () => getPrice(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH)
        ),
        answerState
      )
      const fundMetricQuery = op(
        combine({ q: fundReadQuery, tf: activityTimeframe }),
        map(p =>
          p.q.then(read => {
            const until = getUnixTimestamp()
            const row = read.metricRows.find(each => each.interval === p.tf)
            if (row === undefined) return { fundRow: read.fundRow, metric: null }
            const since = until - p.tf
            const events = pnlEventsAcross(read.metricRows, p.tf)
            const metric = fundMetric(events, p.tf, since, until, CHART_POINTS)
            const worth = read.answer === null || read.answer.read === null ? null : read.answer.read.worth
            return {
              fundRow: read.fundRow,
              metric: {
                ...metric,
                start: since,
                row,
                events,
                updatedAt: row.lastUpdatedTimestamp,
                worth,
                liveFailure: read.answer === null ? null : read.answer.failure,
                tip: pnlTipOf(metric.pnl, row, worth)
              }
            }
          })
        ),
        answerState
      )
      const pnlQuery = op(fundMetricQuery, map(q => q.then(read => read.metric)), answerState)
      const flowsQuery = op(
        merge(just(null), liveAnswers),
        switchMap(answer => {
          if (answer === null) return localFirstQuery(reader => reader.select(flowTable, { where: { account: master } }))
          const fresh = client.select(flowTable, { where: { account: master } })
          return op(
            fromPromise(fresh.then(() => null, () => null)),
            map(() => fresh)
          )
        }),
        answerState
      )
      const costsQuery = op(
        combine({ metric: pnlQuery, calls: masterCallsQuery, flows: flowsQuery }),
        map(p =>
          Promise.all([p.metric, p.calls, p.flows]).then(([metric, read, flows]) => {
            if (metric === null) return null
            const costs = fundCostsOf(read.calls, flows, metric.start, (metric.tip === null ? metric.updatedAt : metric.tip.time) + 1)
            return { ...costs, market: (metric.tip === null ? metric.pnl : metric.tip.pnl) + costs.relayFee + costs.routeCost, failures: read.failures }
          })
        ),
        answerState
      )
      const indexQuery = op(
        combine({ q: fundMetricQuery, valuations: valuationsQuery }),
        map(p =>
          Promise.all([p.q, p.valuations]).then(([{ fundRow, metric }, valuations]) => {
            const lastMark = valuations[valuations.length - 1]
            if (lastMark === undefined || fundRow === undefined) return null
            const worth = metric === null ? null : metric.worth
            const anchor = metric !== null && metric.row.lastUpdatedTimestamp >= lastMark.blockTimestamp ? metric.row : null
            const basis = anchor === null ? { time: lastMark.blockTimestamp, value: lastMark.after } : { time: anchor.lastUpdatedTimestamp, value: anchor.valuation }
            const valued = performanceIndexOf(basis.value, fundRow)
            const tip =
              worth === null || worth.value === undefined || fundRow.totalShares === 0n || worth.time <= basis.time
                ? null
                : { time: worth.time, price: performanceIndexOf(worth.value, fundRow) }
            return { index: formatFixed(TOKEN_META.WETH.decimals, tip === null ? valued : tip.price), basis, valued, tip, worth, liveFailure: metric === null ? null : metric.liveFailure }
          })
        ),
        answerState
      )
      const allocationMarks = op(
        combine({ valuations: valuationsQuery, eth: ethRateQuery }),
        map(p =>
          Promise.all([p.valuations, p.eth]).then(([valuations, eth]) =>
            valuations.flatMap(round =>
              round.sharesAfter > round.totalShares ? [{ time: round.blockTimestamp, label: `Allocated ${formatUsd(round.after - round.value, eth.price)}` }] : []
            )
          )
        ),
        answerState
      )
      const timelineQuery = op(
        combine({ q: fundMetricQuery, valuations: valuationsQuery, tf: activityTimeframe, metric: performanceMetric, eth: ethRateQuery }),
        map(async p => {
          const until = getUnixTimestamp()
          const since = until - p.tf
          const [timeline, usdPerEth] = await Promise.all([
            p.metric === 'pnl'
              ? p.q.then(({ metric }) =>
                  metric === null
                    ? { marks: [], tip: null }
                    : { marks: metric.points, tip: metric.tip === null || metric.tip.time < metric.start ? null : { time: metric.tip.time, value: formatFixed(TOKEN_META.WETH.decimals, metric.tip.pnl) } }
                )
              : Promise.all([p.q, p.valuations]).then(([{ fundRow, metric }, valuations]) => {
                  if (fundRow === undefined || metric === null) return { marks: [], tip: null }
                  const closed = valuations.slice(0, -1).findLastIndex(v => v.sharesAfter === 0n)
                  const launch = valuations[closed + 1]
                  if (launch === undefined) throw new Error(`fund ${master} has a fund row but no round`)
                  const levels = [...metric.events].sort((a, b) => a.time - b.time)
                  const step = Math.max(1, Math.ceil(p.tf / CHART_POINTS))
                  const marks: { time: number; value: number }[] = []
                  let next = 0
                  let level = metric.row.openingIndex
                  for (let time = since; time < until; time += step) {
                    while (next < levels.length && levels[next]!.time <= time) level = levels[next++]!.index
                    marks.push({ time, value: formatFixed(TOKEN_META.WETH.decimals, time < launch.blockTimestamp ? POOL_SHARE : level) })
                  }
                  while (next < levels.length) level = levels[next++]!.index
                  marks.push({ time: until, value: formatFixed(TOKEN_META.WETH.decimals, level) })
                  const worth = metric.worth
                  return {
                    marks,
                    tip:
                      worth === null || worth.value === undefined || fundRow.totalShares === 0n || worth.time <= metric.row.lastUpdatedTimestamp
                        ? null
                        : { time: worth.time, value: formatFixed(TOKEN_META.WETH.decimals, performanceIndexOf(worth.value, fundRow)) }
                  }
                }),
            p.metric === 'pnl' ? p.eth.then(eth => Number(formatUnits(eth.price * 10n ** BigInt(TOKEN_META.WETH.decimals), USD_PRICE_DECIMALS))) : 1
          ])
          return {
            marks: timeline.marks.map(point => ({ time: point.time, value: point.value * usdPerEth })),
            tip: timeline.tip === null ? null : { time: timeline.tip.time, value: timeline.tip.value * usdPerEth }
          }
        }),
        answerState
      )

      const shareLinkLabel = start(
        'Copy share link',
        switchMap(
          copied =>
            op(
              fromPromise(copied.then(() => 'Link copied', (error: unknown) => `Not copied: ${formatThrownError(error)}`)),
              switchMap(label => merge(just(label), delay(1800, just('Copy share link'))))
            ),
          copyShareLink
        )
      )
      const $shareLink = $element('span')(
        spacing.tiny,
        style({ color: palette.foreground, fontSize: text.sm, cursor: 'pointer', display: 'flex', alignItems: 'center' }),
        stylePseudo(':hover', { color: palette.message }),
        copyShareLinkTether(
          nodeEvent('click'),
          map(() => {
            const share = Date.now().toString(36)
            void fetch(`/api/og/masters/${master}?s=${share}`)
            return navigator.clipboard.writeText(`${document.location.origin}/traders/${master}?s=${share}`)
          })
        )
      )($icon({ $content: $copy, viewBox: '0 0 24 24', width: '13px' }), $text(shareLinkLabel))

      const symbolText = op(
        fundRowQuery,
        map(q => q.then(fundRow => (fundRow === undefined ? readableAddress(master) : fundSymbolOf(fundRow)))),
        answerState
      )

      const $breadcrumb = $row(
        spacing.small,
        style({ alignItems: 'center', padding: isDesktopScreen ? '0 20px' : '0 12px', maxWidth: '1400px', width: '100%', margin: '0 auto', fontSize: text.sm, color: palette.foreground })
      )(
        $defaultAnchor(
          attr({ href: href(routeSchema.traders) }),
          style({ color: palette.foreground }),
          effectProp(
            'onclick',
            nowWith(() => (ev: MouseEvent) => {
              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
              ev.preventDefault()
              pushUrl(href(routeSchema.traders))
            })
          )
        )($text('Funds')),
        $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
        $node(style({ color: palette.message }))($intermediateText(symbolText))
      )

      const $unknown = $card(spacing.big)(
        $heading3($text('Unknown fund')),
        $infoLabel($text(`${readableAddress(master)} has no fund yet. A fund opens with its master's first allocation round.`)),
        $row($navPill('All funds', routeSchema.traders, false))
      )

      const nameSize = isDesktopScreen ? text.lg : text.base

      const $identity = $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
        $node(style({ width: '56px', height: '56px', borderRadius: '50%', overflow: 'hidden', flexShrink: '0' }))(
          $intermediatePromise({
            $loader: $intermediateCircle(56),
            $display: map(q => q.then(fundRow => $fundAvatar(fundRow === undefined ? robotCellsOf(master) : gridOf(fundRow), 56)), fundRowQuery)
          })
        ),
        $column(style({ minWidth: '0', gap: '2px' }))(
          $node(style({ fontWeight: '600', fontSize: nameSize, color: palette.message, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($intermediateText(symbolText)),
          $row(spacing.tiny, style({ alignItems: 'center' }))($accountLabel({ address: master, primarySize: 0.85 }))
        )
      )

      const $fundValue = $column(spacing.tiny)(
        $node(style({ fontWeight: '600', color: palette.message }))(
          $intermediateText(maskBalance(map(p => p.q.then(metric => (metric === null ? '-' : usdOf(metric.row.valuation, p.price))), combine({ q: pnlQuery, price: ethPrice() })), hideBalances))
        ),
        $caption(op(intermediateState(pnlQuery), switchMap(s => (s.status === PromiseStatus.DONE ? just(s.value === null ? '' : `valued ${ago(s.value.updatedAt)}`) : empty))))
      )

      const $vitals = $node(style({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: '24px', rowGap: '12px' }))(
        $vital('Fund value', $fundValue, 'What the fund holds, at its last valuation.'),
        $vital(
          'Allocated',
          $node(style({ fontWeight: '600', color: palette.message }))(
            $intermediateText(
              maskBalance(
                map(
                  p =>
                    p.q.then(f => {
                      if (f.fundRow === undefined) return '-'
                      const puppetShares = f.held.filter(h => !isAddressEqual(h.holder, master)).reduce((total, h) => total + h.shares, 0n)
                      return usdOf(cashFor(puppetShares, f.fundRow.totalShares, f.fundRow.value), p.price)
                    }),
                  combine({ q: fundReadQuery, price: ethPrice() })
                ),
                hideBalances
              )
            )
          ),
          $node(
            $text(
              start(
                "What the puppets' shares are worth at the last mark.",
                op(
                  intermediateState(valuationsQuery),
                  switchMap(s => {
                    if (s.status !== PromiseStatus.DONE) return empty
                    const lastMark = s.value[s.value.length - 1]
                    return just(`What the puppets' shares are worth at the last mark${lastMark === undefined ? '' : `, ${ago(lastMark.blockTimestamp)}`}.`)
                  })
                )
              )
            )
          )
        ),
        $vital(
          'Puppets',
          $intermediatePromise({
            $loader: $intermediateCircle(14),
            $display: map(
              q =>
                q.then(f =>
                  f.wallets.then(wallets => {
                    const holding = f.held.filter(h => !isAddressEqual(h.holder, master))
                    const fundRow = f.fundRow
                    return $avatarStack(
                      [...holding].sort((a, b) => (a.shares > b.shares ? -1 : a.shares < b.shares ? 1 : 0)).map(h => $jazzicon(wallets.get(getAddress(h.holder)) ?? getAddress(h.holder), 14)),
                      fundRow === undefined
                        ? null
                        : $intermediatePromise({
                            $loader: $column(spacing.default)($intermediateRow($intermediateProfile(AVATAR_SIZE)), $intermediateRow($intermediateProfile(AVATAR_SIZE))),
                            $display: just(
                              f.holders.then(holders =>
                                $fundHolders(hideBalances, null, wallets, fundRow, holding, f.book, holders.balances, just(holders.quotes), { wei: just(fundRow.value), price: ethPrice() }, just(null), just(null))
                              )
                            )
                          })
                    )
                  })
                ),
              fundReadQuery
            )
          })
        ),
        $vital(
          'Queued',
          $node(style({ color: palette.message }))(
            $intermediateText(
              map(
                p =>
                  p.q.then(f =>
                    f.fundRow === undefined ? '-' : usdOf(cashFor(f.book.redemption === undefined ? 0n : f.book.redemption.queued, f.fundRow.totalShares, f.fundRow.value), p.price)
                  ),
                combine({ q: fundReadQuery, price: ethPrice() })
              )
            )
          ),
          'Shares queued to exit, at the last valuation. The next redemption pays them.'
        ),
        $vital(
          'Fee',
          $node(style({ color: palette.message }))(
            $intermediateText(map(q => q.then(fundRow => (fundRow === undefined ? '-' : readablePercentage(fundRow.performanceFee).replace(/\.0+%$/, '%'))), fundRowQuery))
          ),
          `Each puppet pays it from its payout at exit, on its own gain since it allocated. The master keeps ${readablePercentage(PRECISION.basisPoints - PROTOCOL.protocolFeeShare).replace(/\.0+%$/, '%')} of it, the protocol the rest.`
        )
      )

      const backQuery = op(
        combine({ session: sessionQuery, fundRow: fundRowQuery }),
        map(p =>
          Promise.all([p.session, p.fundRow]).then(([s, fundRow]) => {
            const root = s.root
            if (root !== null && root.fund !== null && 'account' in root.fund && isAddressEqual(root.fund.account, master)) return { kind: 'self' as const }
            if (fundRow === undefined) return { kind: 'none' as const }
            const mine = root === null ? undefined : s.mandates.find(m => isAddressEqual(m.master, master) && isAddressEqual(m.puppet, root.account))
            return { kind: 'mandate' as const, mine, active: mine !== undefined && mandateTermsOf(mine).until > BigInt(getUnixTimestamp()) }
          })
        ),
        answerState
      )
      const backSettled = op(
        intermediateState(backQuery),
        map(s => (s.status === PromiseStatus.DONE ? s.value : null)),
        filterNull,
        state()
      )
      const $mandate = $Popover({
        $contentContainer: $editorPopoverContentContainer,
        $target: $ButtonSecondary({
          $container: $defaultMiniButtonPrimary(styleBehavior(map(back => (back.kind === 'mandate' && back.active ? { borderColor: palette.indeterminate } : null), backSettled))),
          disabled: just(false),
          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Mandate'), $popoverCaret())
        })({ click: popMandateTether() }),
        $open: op(
          popMandate,
          sampleMap(
            back =>
              $MandateEditor({
                master,
                existing: back.kind === 'mandate' ? back.mine : undefined,
                draft: map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, master)) ?? null, draftMandateList)
              })({ changeMandateDraft: changeMandateDraftTether() }),
            backSettled
          )
        ),
        dismiss: changeMandateDraft
      })({})
      const $back = switchLatest(
        op(
          intermediateState(backQuery),
          reduce(
            (shown: 'self' | 'none' | 'mandate' | { error: unknown } | null, s: PromiseState<{ kind: 'self' | 'none' | 'mandate' }>) =>
              s.status === PromiseStatus.DONE ? s.value.kind : s.status === PromiseStatus.ERROR && (shown === null || typeof shown !== 'string') ? { error: s.error } : shown,
            null
          ),
          filterNull,
          skipRepeats,
          map(shape =>
            shape === 'mandate'
              ? $mandate
              : typeof shape === 'string'
                ? $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(shape === 'self' ? 'This is your fund' : 'No fund to allocate to yet'))
                : $errorLabel(shape.error)
          ),
          start($intermediatePill('52px', '30px'))
        )
      )

      const $iconLink = (href: string, label: string, $glyph: I$Node): I$Node =>
        $anchor(
          attr({ href, target: '_blank', 'aria-label': label, title: label }),
          style({ color: palette.foreground, display: 'inline-flex', alignItems: 'center', padding: '4px' }),
          stylePseudo(':hover', { color: palette.message })
        )($glyph)

      const $profileOverview = $column(spacing.default)(
        $row(spacing.default, style({ alignItems: 'center' }))($identity, $back),
        $row(spacing.small, style({ alignItems: 'center' }))(
          $iconLink(getAccountExplorerUrl(master), 'View trading account on explorer', $externalMark()),
          $shareLink
        ),
        $vitals
      )

      const $liveFailureNote = (failure: { error: unknown } | null): I$Node[] => (failure === null ? [] : [$node($text(`Live value failed: ${formatThrownError(failure.error)}`))])

      type ICostsRead = NonNullable<typeof costsQuery extends IStream<Promise<infer C>> ? C : never>
      const $pnlBreakdown = switchLatest(
        op(
          intermediateState(costsQuery),
          map(s => (s.status === PromiseStatus.DONE ? s.value : undefined)),
          skipRepeats,
          map(read => {
            if (read === null) return empty
            const $line = (label: string, amountOf: (costs: ICostsRead) => bigint) => {
              const amount = read === undefined || read.pending > 0 ? null : amountOf(read)
              return $detailLine(
                label,
                maskBalance(
                  map(
                    p => Promise.all([p.costs, p.price]).then(([costs, price]) => (costs === null || costs.pending > 0 ? '-' : formatUsd(amountOf(costs), price))),
                    combine({ costs: costsQuery, price: ethPrice() })
                  ),
                  hideBalances
                ),
                amount === null || amount === 0n ? palette.message : amount > 0n ? palette.positive : palette.negative
              )
            }
            const actions = (count: number) => `${count} ${count === 1 ? 'action' : 'actions'}`
            return $column(spacing.tiny)(
              $line('Market', costs => costs.market),
              $line('Relay fees', costs => -costs.relayFee),
              $line('Route costs', costs => -costs.routeCost),
              ...(read !== undefined && read.pending > 0 ? [$detailLine('Not priced yet', actions(read.pending), palette.foreground)] : []),
              ...(read !== undefined && read.unvalued > 0 ? [$detailLine('Not valued', actions(read.unvalued), palette.foreground)] : []),
              ...(read !== undefined && read.failures.size > 0
                ? [$node(style({ color: palette.foreground }))($text(`Not refreshed on ${[...read.failures.keys()].map(chainName).join(', ')}`))]
                : [])
            )
          })
        )
      )

      const $pnlTip = switchLatest(
        op(
          intermediateState(pnlQuery),
          switchMap(s => {
            if (s.status !== PromiseStatus.DONE) return empty
            const metric = s.value
            if (metric === null) return just($node($text('No activity yet')))
            return just(
              $column(spacing.small)(
                $column(spacing.tiny)(
                  $node($text(metric.tip === null ? `Valued ${ago(metric.updatedAt)}` : `Evaluated ${ago(metric.tip.time)}`)),
                  ...(metric.tip !== null
                    ? [
                        $node($text(`Valued ${ago(metric.updatedAt)}: `), $intermediateText(maskBalance(pnlLabelOf(metric.pnl), hideBalances))),
                        $node($text('Live change since: '), $intermediateText(maskBalance(pnlLabelOf(metric.tip.pnl - metric.pnl), hideBalances)))
                      ]
                    : metric.worth !== null && metric.worth.value === undefined
                      ? [$node($text(`Not evaluated: ${metric.worth.note}`))]
                      : []),
                  ...$liveFailureNote(metric.liveFailure)
                ),
                $pnlBreakdown
              )
            )
          })
        )
      )

      const $indexTip = switchLatest(
        op(
          intermediateState(indexQuery),
          switchMap(s => {
            if (s.status !== PromiseStatus.DONE) return empty
            const figure = s.value
            if (figure === null) return just($node($text('No mark yet')))
            return just(
              $column(spacing.small)(
                $column(spacing.tiny)(
                  $node($text(figure.tip === null ? `Valued ${ago(figure.basis.time)}` : `Evaluated ${ago(figure.tip.time)}`)),
                  ...(figure.tip !== null
                    ? [$node($text(`Valued ${ago(figure.basis.time)}: ${formatFixed(TOKEN_META.WETH.decimals, figure.valued).toFixed(4)}`))]
                    : figure.worth !== null && figure.worth.value === undefined
                      ? [$node($text(`Not evaluated: ${figure.worth.note}`))]
                      : []),
                  ...$liveFailureNote(figure.liveFailure)
                ),
                $performanceIndexTip
              )
            )
          })
        )
      )

      type IPnlRead = typeof pnlQuery extends IStream<Promise<infer M>> ? M : never
      type IIndexRead = typeof indexQuery extends IStream<Promise<infer R>> ? R : never
      const $metricsLead = $row(spacing.big, style({ flex: 1, alignItems: 'flex-start', pointerEvents: 'all' }))(
        $vital(
          'PnL',
          $node(
            styleBehavior(
              op(
                pnlQuery,
                intermediateState,
                filter((settled): settled is PromiseStateDone<IPnlRead> => settled.status === PromiseStatus.DONE),
                map(settled => {
                  const metric = settled.value
                  if (metric === null) return { color: palette.message }
                  const pnl = metric.tip === null ? metric.pnl : metric.tip.pnl
                  return { color: pnl === 0n ? palette.message : pnl > 0n ? palette.positive : palette.negative }
                })
              )
            )
          )(
            $intermediateText(
              maskBalance(
                map(p => p.q.then(metric => (metric === null ? '-' : usdOf(metric.tip === null ? metric.pnl : metric.tip.pnl, p.price))), combine({ q: pnlQuery, price: ethPrice() })),
                hideBalances
              )
            )
          )
        ),
        $vital(
          'Performance Index',
          $row(spacing.tiny, style({ alignItems: 'baseline' }))(
            $node(style({ color: palette.message }))($intermediateText(map(q => q.then(read => (read === null ? '-' : read.index.toFixed(4))), indexQuery))),
            $node(
              style({ fontSize: text.sm }),
              styleBehavior(
                op(
                  indexQuery,
                  intermediateState,
                  filter((settled): settled is PromiseStateDone<IIndexRead> => settled.status === PromiseStatus.DONE),
                  map(settled => {
                    const change = settled.value === null ? 0 : settled.value.index - 1
                    return { color: change > 0 ? palette.positive : change < 0 ? palette.negative : palette.foreground }
                  })
                )
              )
            )(
              $intermediateText(
                map(
                  q =>
                    q.then(read => {
                      if (read === null) return ''
                      const change = read.index - 1
                      return `${change < 0 ? MINUS : ''}${(Math.abs(change) * 100).toFixed(2)}%`
                    }),
                  indexQuery
                )
              )
            )
          )
        )
      )

      const $hero = $node(style({ position: 'relative', width: '100%', backgroundColor: palette.middleground, overflow: 'hidden', ...(isDesktopScreen ? { height: '480px' } : {}) }))(
        $node(style({ position: 'relative', width: '100%', maxWidth: '1400px', margin: '0 auto', padding: isDesktopScreen ? '0 20px' : '0 12px', ...(isDesktopScreen ? { height: '100%' } : {}) }))(
          $ValueTimeline({
            hideBalances,
            timelineQuery,
            axis: 'always',
            format: map(metric => (metric === 'pnl' ? 'pnl' : 'index'), performanceMetric),
            label: map(metric => (metric === 'pnl' ? 'Profit & Loss' : 'Performance Index'), performanceMetric),
            $tip: switchLatest(
              map(
                metric =>
                  $infoTooltip(
                    metric === 'pnl'
                      ? $column(spacing.small)($node($text("The fund's profit over the timeframe, in USD at the live ETH price.")), $pnlTip)
                      : $indexTip,
                    palette.foreground
                  ),
                performanceMetric
              )
            ),
            activityTimeframe,
            under: null,
            metric: { value: performanceMetric, labels: performanceMetricLabelMap },
            chartHeight: isDesktopScreen ? '480px' : '300px',
            events: allocationMarks,
            ...(isDesktopScreen ? { $lead: $metricsLead } : {})
          })({ changeActivityTimeframe: changeActivityTimeframeTether(), changePerformanceMetric: changePerformanceMetricTether() }),
          isDesktopScreen
            ? $node(style({ position: 'absolute', inset: '0', zIndex: 10, pointerEvents: 'none', background: `linear-gradient(to right, ${palette.middleground} 0%, ${palette.middleground} 22%, transparent 52%)` }))()
            : empty,
          $card(
            style({
              padding: '24px',
              zIndex: 20,
              border: `1px solid ${colorShade(palette.foreground, 15)}`,
              ...(isDesktopScreen ? { position: 'absolute', bottom: '36px', left: '20px', width: '440px', maxWidth: 'calc(100% - 40px)' } : { margin: '12px 0' })
            })
          )($profileOverview)
        )
      )

      type IBalances = typeof balancesQuery extends IStream<Promise<infer B>> ? B : never
      const balanceState = op(intermediateState(balancesQuery), state())
      const balanceShape = op(
        balanceState,
        reduce(
          (shown: IBalances['rows'] | { error: unknown } | null, s: PromiseState<IBalances>) =>
            s.status === PromiseStatus.DONE ? s.value.rows : s.status === PromiseStatus.ERROR && (shown === null || 'error' in shown) ? { error: s.error } : shown,
          null
        ),
        filterNull,
        skipRepeatsWith(
          (a, b) =>
            a === b ||
            (!('error' in a) && !('error' in b) && a.length === b.length && a.every((row, i) => row.chainId === b[i]!.chainId && isAddressEqual(row.token, b[i]!.token)))
        ),
        state()
      )

      const $balances = $panel(
        'Balances',
        {},
        switchLatest(
          op(
            balanceShape,
            map(shape => {
              if ('error' in shape) return $errorLabel(shape.error)
              if (shape.length === 0) return $emptyNote('No balances', 'Cash the fund holds on each chain appears here.')
              return $hoverList(
                shape.map(row => {
                  const held = op(
                    balancesQuery,
                    map(q => q.then(balances => balances.rows.find(each => each.chainId === row.chainId && isAddressEqual(each.token, row.token)) ?? null))
                  )
                  const price = priceFor(row.chainId, row.token)
                  return $row(spacing.small, style({ alignItems: 'center', flex: 1 }))(
                    $tokenProfile(row.chainId, row.token, 28, true, null, row.profile),
                    $node(style({ flex: 1 }))(),
                    $amountDisplay({
                      hideBalances,
                      usd: map(p => p.q.then(found => (found === null ? '-' : usdOf(found.amount, p.price))), combine({ q: held, price })),
                      amount: map(q => q.then(found => (found === null ? '-' : readableTokenAmount(row.profile, found.amount))), held),
                      align: 'flex-end'
                    })
                  )
                })
              )
            }),
            start($intermediateRow($intermediateProfile(28)))
          )
        ),
        {
          $tip: $row(spacing.tiny, style({ alignItems: 'center' }))(
            $infoTooltip('Tokens the fund holds on each chain, which redemptions pay from. Open positions count once closed.', palette.foreground),
            $notRefreshed(op(balancesQuery, map(q => q.then(balances => balances.failures))))
          ),
          $headerEnd: $headerFigure(
            op(
              balanceShape,
              switchMap((shape): IStream<Promise<string> | string> => {
                if ('error' in shape) return just(Promise.reject(shape.error))
                if (shape.length === 0) return just('')
                return combineMap(
                  (q: Promise<IBalances>, ...prices: Promise<bigint | null>[]) =>
                    Promise.all([q, Promise.all(prices)]).then(([balances, known]) => {
                      const priceOf = new Map(shape.map((row, i) => [`${row.chainId}:${row.token}`, known[i]!]))
                      const priced = balances.rows.flatMap(row => {
                        const at = priceOf.get(`${row.chainId}:${row.token}`)
                        return at === undefined || at === null ? [] : [Number(formatUnits(row.amount * at, USD_PRICE_DECIMALS))]
                      })
                      return priced.length < balances.rows.length ? '-' : formatUsdNumber(priced.reduce((sum, usd) => sum + usd, 0))
                    }),
                  balancesQuery,
                  ...shape.map(row => priceFor(row.chainId, row.token))
                )
              })
            )
          )
        }
      )

      const $distribution = $panel(
        'Distribution',
        { flex: 1 },
        $intermediatePromise({
          $loader: $intermediateRow($intermediateProfile(AVATAR_SIZE)),
          $display: map(
            q =>
              q.then(f => {
                const fundRow = f.fundRow
                if (fundRow === undefined || f.held.length === 0) {
                  return $emptyNote('No holders yet', 'The master and puppets who join an allocation round appear here with their share.')
                }
                return Promise.all([f.wallets, f.holders]).then(([wallets, holders]) =>
                  $fundHolders(hideBalances, null, wallets, fundRow, f.held, f.book, holders.balances, just(holders.quotes), { wei: just(fundRow.value), price: ethPrice() }, just(null), just(null))
                )
              }),
            fundReadQuery
          )
        }),
        {
          $tip: $infoTooltip(
            "Each holder's share of the fund, at its value after the last round or redeem.",
            palette.foreground
          )
        }
      )

      const $openPositions = $panel(
        'Open positions',
        { flex: 1, minWidth: 0 },
        $OpenPositions({
          hideBalances,
          positions: venuesQuery,
          standing: standingQuery,
          $empty: $emptyNote('No open positions', 'Positions and balances this fund holds on a venue or in transit appear here.')
        }),
        {
          $tip: $intermediatePromise({
            $loader: $infoTooltip(OPEN_POSITIONS_TIP, palette.foreground),
            $display: map(q => q.then(open => $syncTip(OPEN_POSITIONS_TIP, open, TICK_SYNC_SCHEDULE_SEC), () => $infoTooltip(OPEN_POSITIONS_TIP, palette.foreground)), venuesQuery)
          })
        }
      )

      const $history = $column(spacing.default, style({ backgroundColor: palette.middleground, borderRadius: '8px', padding: '20px', flex: 1, minWidth: 0 }))(
        $AccountHistory(
          historyQuery,
          (failure, $trailing) =>
            $row(style({ alignItems: 'center', justifyContent: 'space-between', gap: '12px' }))(
              $row(spacing.tiny, style({ alignItems: 'center' }))(
                switchLatest(map(failed => (failed === null ? $sectionLabel('History') : $intermediateFailure(failed.error, $sectionLabel('History'), true)), failure)),
                $infoTooltip("Everything the fund and its master did, across chains, newest first.", palette.foreground),
                $notRefreshed(historyFailures)
              ),
              $trailing
            ),
          $emptyNote('Nothing here yet', 'Trades, fund swaps, allocations, deposits, withdrawals and redemptions appear here as they land.')
        )({})
      )

      const $page = $column(spacing.default, style({ width: '100%' }))(
        $breadcrumb,
        $hero,
        $responsiveFlex(style({ alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: '1400px', width: '100%', margin: '0 auto', padding: isDesktopScreen ? '0 20px' : '0 12px' }))(
          $column(spacing.default, style(isDesktopScreen ? { flex: '1 1 440px', minWidth: 0 } : { width: '100%' }))($balances, $distribution),
          $column(spacing.default, style(isDesktopScreen ? { flex: '999 1 0', minWidth: 'min(100%, 520px)' } : { flex: 1, minWidth: 0, width: '100%' }))($openPositions, $history)
        )
      )

      return [
        switchLatest(
          map(
            known => (known ? $page : $unknown),
            op(
              fundRowQuery,
              intermediateState,
              filter(s => s.status !== PromiseStatus.PENDING),
              map(s => s.status !== PromiseStatus.DONE || s.value !== undefined),
              start(true),
              skipRepeats
            )
          )
        ),
        { changeMandateDraft, changeActivityTimeframe, changePerformanceMetric }
      ]
    }
  )
