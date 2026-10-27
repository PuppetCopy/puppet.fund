import { CHAIN_IDS, HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { SESSION_REVOKE_DELAY } from '@puppet/contracts/intents'
import { predictUserAccount } from '@puppet/sdk/account'
import {
  depositArrivalToken,
  fundRecordsOf,
  type IArrival,
  type IDepositDraft,
  type IEditorDraft,
  type IFundSwapDraft,
  type IOperateSwapDraft,
  type IMandateDraft,
  type IRedeemDraft,
  type ISellDraft,
  type IRevokeDraft,
  type ITradeDraft,
  type IViewRead,
  type IWithdrawDraft,
  PROBE_MAX_AGE_MS,
  readTokenAllowance,
  readTokenBalance,
  selectedFundOf,
  venueWithdrawOf
} from '@puppet/sdk/client'
import { formatThrownError, type IValuationOwner } from '@puppet/sdk/compact'
import { type ChainId, type IntervalTime, TOKEN_META, USD_DECIMALS } from '@puppet/sdk/const'
import {
  getTokenDescription,
  getUnixTimestamp,
  readableTokenAmount,
  readableTokenAmountLabel,
  readableUsd
} from '@puppet/sdk/core'
import { type IGetRate, type IPriceSource, USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import type { IDigestClient } from '@puppet/sdk/datastore'
import {
  clientOf,
  exitingSharesOf,
  fromChain,
  type IFundBook,
  markPrice,
  readFundBook,
  readFundState
} from '@puppet/sdk/intent'
import { minFundedAmount } from '@puppet/sdk/mpc'
import { type IRedeemPlan, performanceIndexOf, POOL_SHARE } from '@puppet/sdk/pool'
import { ACCOUNT_VENUE, balanceTable, fundTable, holdingTable, type IFundMetricRow, type IFundRow, type IMandateRow } from '@puppet/sdk/schema'
import { listedTokensOf, pnlEventsAcross, providerToken, walletsOf, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { type ICells, randomSymbol, robotCellsOf } from '@puppet/sdk/ui-components'
import { type IVenue, UNISWAP_DEPLOYMENTS, UNISWAP_POOLS, VENUES } from '@puppet/sdk/venue'
import {
  combine,
  constant,
  delay,
  empty,
  filter,
  filterNull,
  type IStream,
  just,
  map,
  merge,
  never,
  op,
  periodic,
  reduce,
  sampleMap,
  skip,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest,
  switchMap,
  take,
  tap,
  until
} from 'aelea/stream'
import { type IBehavior, multicast, type PromiseState, type PromiseStateDone, PromiseStatus, state } from 'aelea/stream-extended'
import { $node, $text, attr, attrBehavior, component, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, encodeFunctionData, erc20Abi, formatUnits, getAddress, type Hex, isAddressEqual, toHex } from 'viem'
import {
  $alertIcon,
  $alertInfo,
  $alertIntermediateContainer,
  $alertNegativeContainer,
  $amountDisplay,
  $arrowRight,
  $ButtonPrimary,
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $icon,
  $infoTooltip,
  $intermediateFailure,
  $intermediatePromise,
  $popoverCaret,
  maskBalance,
  SEPARATOR_COLOR,
  text,
  intermediateState
} from '@/ui-components'
import { $chainIcon, chainName } from '../common/$chain.js'
import { $walletConnectLogo } from '../common/$icons.js'
import { $venueIcon } from '../common/$operationView.js'
import type { IAgentIdentity, IPortfolioRole } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { $tokenProfile } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2 } from '../common/elements/$common.js'
import { $addressLink } from '../components/$AccountProfile.js'
import { $exitQueueRow, $mandatePosition, mandateTermsOf } from '../components/$MandatePosition.js'
import { $fundHolders, $fundRaisable, raisableGroupsOf } from '../components/$FundHolders.js'
import type { IPerformanceMetric } from '../components/$PerformanceMetric.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $ValueTimeline, type ITimeline } from '../components/participant/$ValueTimeline.js'
import { $AccountMenu } from '../components/$AccountMenu.js'
import { $FundMenu } from '../components/$FundMenu.js'
import type { I$AgentSection, IAgentCommand } from '../components/$AgentLink.js'
import { $stillListed, $WalletLink, linkIssueOf } from '../components/$WalletLink.js'
import { $AccountHistory } from '../components/portfolio/$AccountHistory.js'
import { $AllocationSimulation, type IPooledRound, type IRaise, readRounds } from '../components/portfolio/$AllocationSimulation.js'
import { $DepositEditor, type I$DepositEditor } from '../components/portfolio/$DepositEditor.js'
import { $EscrowedRow } from '../components/portfolio/$EscrowedRow.js'
import { $FundIdentityEditor, type IFundIdentity } from '../components/portfolio/$FundIdentityEditor.js'
import { $FundSwapEditor } from '../components/portfolio/$FundSwapEditor.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import { $RedeemEditor } from '../components/portfolio/$RedeemEditor.js'
import { $SellEditor } from '../components/portfolio/$SellEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import { $VenueDepositEditor } from '../components/portfolio/$VenueDepositEditor.js'
import { $VenueWithdrawEditor } from '../components/portfolio/$VenueWithdrawEditor.js'
import { $editorPopoverContentContainer, $intermediateEditor } from '../components/portfolio/editorUtils.js'
import { $SelfCustodySwapEditor } from '../components/portfolio/$SelfCustodySwapEditor.js'
import { clientDeps } from '../io/clientDeps.js'
import context, { DISPLAY_QUOTE_TTL_MS, getPrice, getRate, localGetRate, localPrice, PRICE_FRESHNESS_MS } from '../io/context.js'
import { escrowSurplus, type IHoldingView, type IMandateWorth, mandatesInForce, mandateWorth } from '../io/datastore/own.js'
import { answerState, client, localFirst, localReader, notLocal } from '../io/datastore/reads.js'
import { CHART_POINTS, type ITimelinePoint } from '../io/datastore/traders.js'
import { flatTimeline, resample } from '../io/datastore/walletTimeline.js'
import { accountHistory, type IAccountAction } from '../io/journal/history.js'
import { journalDeps } from '../io/journal/journal.js'
import type { IJournalEntries, IOwnState } from '@puppet/sdk/client'
import { localViewCall, viewCall } from '../io/onchain/viewRead.js'
import { formatUsd, formatUsdNumber, priceFor, usdOf } from '../io/price.js'
import { fundBalancesOf, type IFundLive, type IOpenPositions, type IStandingAllowance, standingAllowancesOf } from '../io/venue.js'
import { $syncTip, OWNER_SYNC_SCHEDULE_SEC, TICK_SYNC_SCHEDULE_SEC } from './$OpenPositions.js'
import type { IWalletControl, IWalletIntent } from '../wallet/connect.js'
import { balanceAt, type IConnectedWallet, type IFund, type IRootState, type ISettledTx, type IWalletKeys, type IWalletPair, publicClientMap } from '../wallet/index.js'
import { disconnectDapp, type IWalletLinkSession, venueOfUrl, walletLinkSessions } from '../wallet/walletLink.js'
import { $positionList, $standingAllowance, $venueRow } from './$OpenPositions.js'
import { $caption, $emptySection, $section, $sectionHeader, $sectionList, $sectionTip, ago, shortDuration } from './common.js'
import type { IPageFilterParams } from './types.js'

const FUND_TIP =
  'Everything your fund holds, on every chain and venue, in USD at the live ETH price.'

const REVOKE_GAS_LIMIT = 100_000n

interface I$Portfolio extends IPageFilterParams {
  role: IPortfolioRole
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  shownPair: IStream<IWalletPair>
  journalQuery: IStream<
    Promise<{ own: IJournalEntries; bodyList: IJournalEntries[]; state: IOwnState; fund: IRootState['fund']; live: Promise<IFundLive> | null; metrics: Promise<IFundMetricRow[]> | null } | null>
  >
  ownStateQuery: IStream<Promise<IOwnState | null>>
  holdingsQuery: IStream<Promise<IHoldingView[]>>
  accountValueQuery: IStream<Promise<number | null>>
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  draftMandateList: IStream<IMandateDraft[]>
  draftTradeList: IStream<ITradeDraft[]>
  agent: I$AgentSection
  walletControl: IWalletControl
}

const NO_ACTIVITY = 'No activity yet. Deposit to your account, then allocate it to a fund.'

export const $Portfolio = ({
  role,
  hideBalances,
  activityTimeframe,
  performanceMetric,
  walletPair,
  shownPair,
  journalQuery: heldJournal,
  ownStateQuery,
  holdingsQuery,
  accountValueQuery,
  draftDepositList,
  draftWithdrawList,
  draftMandateList,
  draftTradeList,
  agent,
  walletControl
}: I$Portfolio) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changePerformanceMetric, changePerformanceMetricTether]: IBehavior<IPerformanceMetric>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [popMandate, popMandateTether]: IBehavior<PointerEvent, Address>,
      [changeTradeDraft, changeTradeDraftTether]: IBehavior<ITradeDraft>,
      [releaseTradeDraft, releaseTradeDraftTether]: IBehavior<string>,
      [rowDraft, rowDraftTether]: IBehavior<PointerEvent, ITradeDraft>,
      [disconnectVenue, disconnectVenueTether]: IBehavior<PointerEvent, IVenue>,
      [popTrade, popTradeTether]: IBehavior<PointerEvent, string>,
      [popDeposit, popDepositTether]: IBehavior<PointerEvent>,
      [popAllocate, popAllocateTether]: IBehavior<PointerEvent>,
      [popRaise, popRaiseTether]: IBehavior<PointerEvent, Address>,
      [moveToHub, moveToHubTether]: IBehavior<{ chainId: ChainId; token: Address; amount: bigint }>,
      [popRedeem, popRedeemTether]: IBehavior<PointerEvent>,
      [fundAllocate, fundAllocateTether]: IBehavior<IDepositDraft>,
      [fundRound, fundRoundTether]: IBehavior<IDepositDraft>,
      [arrival, arrivalTether]: IBehavior<IArrival>,
      [allocateRaise, allocateRaiseTether]: IBehavior<IRaise | null>,
      [roundPuppets, roundPuppetsTether]: IBehavior<bigint | null>,
      [refreshRounds, refreshRoundsTether]: IBehavior<MouseEvent>,
      [enableSession, enableSessionTether]: IBehavior<unknown>,
      [popConnect, popConnectTether]: IBehavior<PointerEvent>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,
      [agentCommand, agentCommandTether]: IBehavior<IAgentCommand>,
      [addAgent, addAgentTether]: IBehavior<IAgentIdentity>,
      [changeAgentIdentities, changeAgentIdentitiesTether]: IBehavior<readonly IAgentIdentity[]>,
      [changeRevokeDraft, changeRevokeDraftTether]: IBehavior<IRevokeDraft>,
      [revokeAgain, revokeAgainTether]: IBehavior<PointerEvent, IRevokeDraft>,
      [changeSymbol, changeSymbolTether]: IBehavior<string>,
      [changeCells, changeCellsTether]: IBehavior<ICells>,
      [fundCreate, fundCreateTether]: IBehavior<IDepositDraft>,
      [walletIntent, walletIntentTether]: IBehavior<IWalletIntent>,
      [pickFund, pickFundTether]: IBehavior<IFund>,
      [startFund, startFundTether]: IBehavior<unknown>,
      [openAvatar, openAvatarTether]: IBehavior<I$Node>,
      [closeIdentity, closeIdentityTether]: IBehavior<unknown>
    ) => {
      const heldRoot: IStream<IRootState | null> = op(
        shownPair,
        map(pair => pair.root),
        intermediateState,
        filter((root): root is PromiseStateDone<IRootState | null> => root.status === PromiseStatus.DONE),
        map(root => root.value),
        state()
      )
      const contractWalletQuery: IStream<Promise<boolean>> = op(
        combine({ pair: walletPair, chainId: walletControl.chainId }),
        map(p => (p.pair.wallet === null ? null : { address: p.pair.wallet.address, chainId: p.chainId })),
        skipRepeatsWith((a, b) => (a === null || b === null ? a === b : isAddressEqual(a.address, b.address) && a.chainId === b.chainId)),
        map(at =>
          at === null
            ? Promise.resolve(false)
            : (publicClientMap[at.chainId ?? HUB_CHAIN_ID] ?? publicClientMap[HUB_CHAIN_ID])
                .getCode({ address: at.address })
                .then(code => code !== undefined && code !== '0x' && !code.startsWith('0xef0100'))
        ),
        state()
      )
      const $contractWarning = switchLatest(
        map(
          s =>
            s.status === PromiseStatus.DONE && s.value
              ? $alertNegativeContainer(style({ borderRadius: '12px', alignSelf: 'center', flexWrap: 'wrap', justifyContent: 'center' }))(
                  $icon({ $content: $alertIcon, viewBox: '0 0 24 24', width: '18px', svgOps: style({ minWidth: '18px' }) }),
                  $node(style({ fontSize: text.sm, color: palette.message }))($text('This wallet signs through contract code. Puppet needs a wallet that signs with its own key.')),
                  $infoTooltip(
                    "Your fund's trading key comes from your wallet's own signature, so multisig, passkey and other smart wallets cannot act here. Connect a wallet that holds its own key.",
                    palette.foreground
                  )
                )
              : empty,
          intermediateState(contractWalletQuery)
        )
      )
      const creatingFund: IStream<boolean> = op(
        merge(
          constant(true, startFund),
          constant(false, pickFund),
          op(
            heldRoot,
            map(root => (root === null || root.fund === null || 'unknown' in root.fund ? null : root.fund.account)),
            skipRepeats,
            constant(false)
          )
        ),
        start(false),
        skipRepeats,
        state()
      )
      const revokeDelay = Number(SESSION_REVOKE_DELAY)
      const exitWindows = op(
        ownStateQuery,
        intermediateState,
        filter((own): own is PromiseStateDone<IOwnState | null> => own.status === PromiseStatus.DONE),
        map(own => {
          const held = own.value
          return held === null ? [] : held.accounts.filter(row => row.revokedAt > 0 && isAddressEqual(row.account, held.account))
        }),
        skipRepeatsWith((a, b) => a.length === b.length && a.every((row, i) => row.chainId === b[i]!.chainId && row.revokedAt === b[i]!.revokedAt)),
        switchMap(rows => {
          const at = (now: number) => ({
            now,
            windows: new Map(
              rows.map(row => {
                const opens = row.revokedAt + revokeDelay
                const closes = opens + revokeDelay
                const phase = now < opens ? ('waiting' as const) : now < closes ? ('open' as const) : ('closed' as const)
                return [Number(row.chainId) as ChainId, { phase, until: phase === 'waiting' ? opens : closes }] as const
              })
            )
          })
          return rows.every(row => getUnixTimestamp() >= row.revokedAt + 2 * revokeDelay)
            ? just(at(getUnixTimestamp()))
            : op(periodic(1000), map(() => at(getUnixTimestamp())), start(at(getUnixTimestamp())))
        }),
        state()
      )
      const walletRoot: IStream<IRootState | null> = op(
        combine({ root: heldRoot, pristine: creatingFund }),
        map(p => (p.root === null || !p.pristine ? p.root : { ...p.root, fund: null })),
        state()
      )
      const journalQuery: I$Portfolio['journalQuery'] = op(
        combine({ held: heldJournal, pristine: creatingFund }),
        map(p => (p.pristine ? Promise.resolve(null) : p.held)),
        answerState
      )

      interface ISectionParams {
        root: IRootState | null
        wallet: IConnectedWallet | null
        fund: IRootState['fund']
        keys: IWalletKeys | null
      }
      type ISectionState = { kind: 'params'; params: ISectionParams } | { kind: 'error'; error: unknown } | { kind: 'pending' }
      const heldKey = (root: IRootState | null): string =>
        root ? root.balances.filter(b => b.balance > 0n).map(b => `${b.chainId}:${b.token}`).sort().join(',') : ''
      const suggestedIdentity: IFundIdentity = { symbol: randomSymbol(), cells: robotCellsOf(toHex(crypto.getRandomValues(new Uint8Array(20)))) }
      const freshIdentity: IStream<IFundIdentity> = op(
        startFund,
        map(() => ({ symbol: randomSymbol(), cells: robotCellsOf(toHex(crypto.getRandomValues(new Uint8Array(20)))) })),
        multicast
      )
      const seededIdentity: IStream<IFundIdentity> = merge(
        op(draftDepositList, take(1), map(list => list.find(d => d.id === 'deposit')?.identity ?? null), filterNull),
        sampleMap((list: IDepositDraft[], fresh: IFundIdentity) => list.find(d => d.id === 'deposit')?.identity ?? fresh, draftDepositList, freshIdentity)
      )
      const typedSymbol: IStream<string> = state(suggestedIdentity.symbol, merge(changeSymbol, map(seed => seed.symbol, seededIdentity)))
      const chosenCells: IStream<ICells> = state(suggestedIdentity.cells, merge(changeCells, map(seed => seed.cells, seededIdentity)))
      const fundSymbol: IStream<string> = map(typed => (typed === '' ? suggestedIdentity.symbol : typed), typedSymbol)
      const openingRound: IStream<IDepositDraft> = merge(
        sampleMap((identity: IFundIdentity, draft: IDepositDraft) => ({ ...draft, identity }), combine({ symbol: fundSymbol, cells: chosenCells }), fundCreate),
        op(
          sampleMap(
            (list: IDepositDraft[], identity: IFundIdentity) => {
              const saved = list.find(d => d.id === 'deposit')
              return saved === undefined || saved.identity === undefined ? null : { ...saved, identity }
            },
            draftDepositList,
            merge(
              sampleMap((cells: ICells, typed: string) => ({ symbol: typed === '' ? suggestedIdentity.symbol : typed, cells }), chosenCells, changeSymbol),
              sampleMap((symbol: string, cells: ICells) => ({ symbol, cells }), fundSymbol, changeCells)
            )
          ),
          filterNull
        )
      )

      interface IAllocationSection {
        masters: Address[]
        mandates: IMandateRow[]
        holdings: IHoldingView[]
        fundRows: IFundRow[]
        worth: ReadonlyMap<Address, IMandateWorth | null>
      }
      const allocationQuery: IStream<Promise<IAllocationSection>> = op(
        combine({ holdings: holdingsQuery, journal: journalQuery, own: ownStateQuery, tf: activityTimeframe }),
        map(q => {
          const allocationAt = async (reader: IDigestClient): Promise<IAllocationSection> => {
            const [holdings, journal, own] = await Promise.all([q.holdings, q.journal, q.own])
            const masters = [...new Set([...(own === null ? [] : own.mandates).map(m => getAddress(m.master)), ...holdings.map(h => getAddress(h.master))])]
            const current = holdings.flatMap(h => (h.standing.kind === 'current' ? [h.standing.fundRow] : []))
            const missing = masters.filter(master => !current.some(row => isAddressEqual(row.master, master)))
            const fundRows = missing.length === 0 ? current : [...current, ...(await reader.select(fundTable, { where: { master: { in: missing } } }))]
            const nowSec = getUnixTimestamp()
            const metrics = holdings.flatMap(h => (h.standing.kind === 'current' ? h.standing.metrics : []))
            const worth: ReadonlyMap<Address, IMandateWorth | null> = new Map(
              journal === null || own === null
                ? []
                : fundRows.map(
                    row =>
                      [
                        getAddress(row.master),
                        mandateWorth(journal.own, own.valuations, row, { rows: metrics.filter(m => isAddressEqual(m.master, row.master)), interval: q.tf }, nowSec)
                      ] as const
                  )
            )
            return { masters, mandates: own === null ? [] : mandatesInForce(own), holdings, fundRows, worth }
          }
          return localFirst(() => allocationAt(localReader), () => allocationAt(client))
        }),
        switchLatest,
        answerState
      )
      const pointsQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ journal: journalQuery, allocation: allocationQuery, tf: activityTimeframe }),
        map(p => {
          const pointsAt = async (price: (chainId: ChainId, token: Address) => Promise<IPriceSource>): Promise<ITimelinePoint[]> => {
            const until = getUnixTimestamp()
            const since = until - p.tf
            const [held, allocation] = await Promise.all([p.journal, p.allocation])
            if (held === null) return flatTimeline(since, until)
            const tokens = [...held.own.entries].flatMap(([chainId, calls]) => {
              const listed = listedTokensOf(chainId)
              return calls.flatMap(call =>
                call.balanceList.flatMap(b =>
                  listed.some(token => isAddressEqual(token, b.token)) ? [{ time: call.blockTimestamp, key: `${chainId}:${getAddress(b.token)}`, chainId, token: getAddress(b.token), amount: b.amount }] : []
                )
              )
            })
            const assets = new Map(tokens.map(each => [each.key, each] as const))
            const [eth, prices] = await Promise.all([
              price(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH),
              Promise.all([...assets].map(async ([key, each]) => [key, (await price(each.chainId, each.token)).price] as const))
            ])
            const priceOf = new Map(prices)
            const usdOf = (amount: bigint, price: bigint): number => Number(formatUnits(amount * price, USD_PRICE_DECIMALS))
            const steps = [
              ...tokens.map(each => ({ time: each.time, key: each.key, usd: usdOf(each.amount, priceOf.get(each.key)!) })),
              ...[...allocation.worth].flatMap(([master, perf]) =>
                perf === null ? [] : perf.points.map(point => ({ time: point.time, key: master, usd: usdOf(point.worth - point.paid, eth.price) }))
              )
            ].sort((a, b) => a.time - b.time)
            const current = new Map<string, number>()
            const points: ITimelinePoint[] = []
            for (const step of steps) {
              current.set(step.key, step.usd)
              const value = [...current.values()].reduce((total, usd) => total + usd, 0)
              const last = points[points.length - 1]
              if (last !== undefined && last.time === step.time) last.value = value
              else points.push({ time: step.time, value })
            }
            return resample(points, since, until, CHART_POINTS)
          }
          return localFirst(() => pointsAt(localPrice), () => pointsAt(getPrice))
        }),
        switchLatest,
        answerState
      )
      const puppetTimeline: IStream<Promise<ITimeline>> = op(
        combine({ points: pointsQuery, live: accountValueQuery }),
        map(async p => {
          const [points, live] = await Promise.all([p.points, p.live])
          return { marks: live === null ? points : [...points.slice(0, -1), { time: points[points.length - 1]!.time, value: live }], tip: null }
        }),
        answerState
      )
      const puppetRoiTimeline: IStream<Promise<ITimeline>> = op(
        combine({ allocation: allocationQuery, tf: activityTimeframe }),
        map(async (p): Promise<ITimeline> => {
          const until = getUnixTimestamp()
          const since = until - p.tf
          const perfs = [...(await p.allocation).worth.values()].filter((perf): perf is IMandateWorth => perf !== null)
          const invested = perfs.reduce((total, perf) => total + perf.invested, 0n)
          if (invested === 0n) return { marks: [], tip: null }
          const roiAt = (time: number | null): number =>
            (Number(
              perfs.reduce((total, perf) => {
                const opening = perf.points.findLast(point => point.time <= since)
                const at = time === null ? perf : perf.points.findLast(point => point.time <= time)
                return total + (at === undefined ? 0n : at.worth - at.allocated) - (opening === undefined ? 0n : opening.worth - opening.allocated)
              }, 0n)
            ) /
              Number(invested)) *
            100
          const times = [...new Set(perfs.flatMap(perf => perf.points.map(point => point.time)))].filter(time => time > since && time < until).sort((a, b) => a - b)
          const marks = resample([{ time: since, value: 0 }, ...times.map(time => ({ time, value: roiAt(time) }))], since, until, CHART_POINTS)
          return { marks: [...marks.slice(0, -1), { time: marks[marks.length - 1]!.time, value: roiAt(null) }], tip: null }
        }),
        answerState
      )
      const masterView = op(
        combine({ journal: heldJournal, tf: activityTimeframe, pristine: creatingFund }),
        map(p => {
          const viewAt = async (ethQuote: Promise<IPriceSource>) => {
            const until = getUnixTimestamp()
            const since = until - p.tf
            const held = p.pristine ? null : await p.journal
            if (held !== null && held.fund !== null && 'unknown' in held.fund) throw new Error(held.fund.unknown)
            const body = held === null ? undefined : held.bodyList[0]
            if (held === null || body === undefined) return { timeline: { marks: flatTimeline(since, until), tip: null }, roiTimeline: { marks: [], tip: null }, worth: null, allocations: [] }
            const own = held.state
            if (held.live === null || held.metrics === null) throw new Error(`the chronicle reads of the fund ${body.account} were never requested`)
            const [live, eth, rows] = await Promise.all([held.live, ethQuote, held.metrics])
            const usd = (wei: bigint): number => Number(formatUnits(wei * eth.price, USD_PRICE_DECIMALS))
            const rounds = own.valuations.filter(row => isAddressEqual(row.master, body.account)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
            const lastRound = rounds[rounds.length - 1]
            const launch = rounds[rounds.slice(0, -1).findLastIndex(round => round.sharesAfter === 0n) + 1]
            const metric = rows.find(row => row.interval === p.tf)
            const slots = pnlEventsAcross(rows, p.tf)
            const points: ITimelinePoint[] = []
            let latest: bigint | null = null
            const mark = (time: number, wei: bigint): void => {
              latest = wei
              const last = points[points.length - 1]
              if (last !== undefined && last.time === time) last.value = usd(wei)
              else points.push({ time, value: usd(wei) })
            }
            const anchor = metric !== undefined && (lastRound === undefined || metric.lastUpdatedTimestamp >= lastRound.blockTimestamp) ? metric : null
            if (anchor !== null) {
              const start = launch !== undefined && launch.blockTimestamp > since ? launch.blockTimestamp : since
              const events = [...rounds.map(round => ({ time: round.blockTimestamp, delta: round.after - round.value })), ...slots]
                .filter(event => event.time > start)
                .sort((a, b) => a.time - b.time)
              let value = events.reduce((rest, event) => rest - event.delta, anchor.valuation)
              if (start > since) mark(since, 0n)
              mark(start, value)
              for (const event of events) {
                value += event.delta
                mark(event.time, value)
              }
            } else {
              for (const round of rounds) mark(round.blockTimestamp, round.after)
            }
            const worth = live === null ? null : live.worth
            const basisTime = anchor !== null ? anchor.lastUpdatedTimestamp : lastRound === undefined ? null : lastRound.blockTimestamp
            const tip = worth !== null && worth.value !== undefined && worth.time !== undefined && worth.time >= since && (basisTime === null || worth.time > basisTime) ? { time: worth.time, wei: worth.value } : null
            const fundRow = own.fundRows.find(row => isAddressEqual(row.master, body.account))
            let roiTimeline: ITimeline = { marks: [], tip: null }
            if (metric !== undefined && fundRow !== undefined) {
              if (launch === undefined) throw new Error(`the fund ${body.account} has a fund row but no round`)
              const levels = [...slots].sort((a, b) => a.time - b.time)
              const step = Math.max(1, Math.ceil(p.tf / CHART_POINTS))
              const indexMarks: { time: number; index: bigint }[] = []
              let next = 0
              let level = metric.openingIndex
              for (let time = since; time < until; time += step) {
                while (next < levels.length && levels[next]!.time <= time) level = levels[next++]!.index
                indexMarks.push({ time, index: time < launch.blockTimestamp ? POOL_SHARE : level })
              }
              while (next < levels.length) level = levels[next++]!.index
              indexMarks.push({ time: until, index: level })
              const opening = Number(indexMarks[0]!.index)
              roiTimeline = {
                marks: indexMarks.map(each => ({ time: each.time, value: (Number(each.index) / opening - 1) * 100 })),
                tip:
                  worth === null || worth.value === undefined || worth.time === undefined || worth.time < since || worth.time <= metric.lastUpdatedTimestamp || fundRow.totalShares === 0n
                    ? null
                    : { time: worth.time, value: (Number(performanceIndexOf(worth.value, fundRow)) / opening - 1) * 100 }
              }
            }
            return {
              timeline: { marks: resample(points, since, until, CHART_POINTS), tip: tip === null ? null : { time: tip.time, value: usd(tip.wei) } },
              roiTimeline,
              worth: tip === null ? (latest === null ? null : { wei: latest, price: eth.price }) : { wei: tip.wei, price: eth.price },
              allocations: rounds.flatMap(round =>
                round.sharesAfter > round.totalShares ? [{ time: round.blockTimestamp, label: `Allocated ${formatUsd(round.after - round.value, eth.price)}` }] : []
              )
            }
          }
          return localFirst(
            () => viewAt(localPrice(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH)),
            () => viewAt(getPrice(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH))
          )
        }),
        switchLatest,
        answerState
      )
      const masterNote: IStream<Promise<string | null>> = op(
        journalQuery,
        map(async query => {
          if (role !== 'master') return null
          const held = await query
          if (held === null || held.live === null) return null
          const live = await held.live
          if (live.worth.value === undefined) return live.worth.note
          const failure = live.open.failed.find(f => f.venue === ACCOUNT_VENUE)
          return failure === undefined ? null : `The live value could not refresh: ${failure.reason}. The value shown is from ${ago(live.worth.time)}.`
        }),
        answerState
      )
      const distributionWorth: IStream<Promise<{ wei: bigint; price: bigint } | null>> = map(
        p => p.note.then(note => (note !== null ? null : p.view.then(view => view.worth))),
        combine({ view: masterView, note: masterNote })
      )
      const timelineQuery: IStream<Promise<ITimeline>> = op(
        performanceMetric,
        map(metric =>
          role === 'puppet'
            ? metric === 'pnl'
              ? puppetTimeline
              : puppetRoiTimeline
            : map(view => view.then(each => (metric === 'pnl' ? each.timeline : each.roiTimeline)), masterView)
        ),
        switchLatest
      )
      const roundSaved = op(
        sampleMap((puppets, d: IDepositDraft) => ({ puppets, d }), roundPuppets, fundRound),
        filter((p): p is { puppets: bigint; d: IDepositDraft } => p.puppets !== null),
        multicast
      )


      const sectionQuery: IStream<Promise<ISectionParams>> = op(
        combine({ pair: shownPair, syncedPair: walletPair, pristine: creatingFund }),
        map(async p => {
          const shown = await p.pair.root
          const held =
            shown !== null && shown.fund !== null && 'unknown' in shown.fund
              ? await p.syncedPair.root.then(synced => (synced !== null && isAddressEqual(synced.user, shown.user) ? synced : notLocal))
              : shown
          const root = held === null || !p.pristine ? held : { ...held, fund: null }
          return { wallet: p.pair.wallet, root, fund: root === null ? null : root.fund, keys: p.pair.keys }
        }),
        answerState
      )

      const $historyHeader = (role: IPortfolioRole) => (failure: IStream<{ error: unknown } | null>, $trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3(switchLatest(map(failed => (failed === null ? $text('History') : $intermediateFailure(failed.error, $text('History'), true)), failure))),
          role === 'puppet'
            ? 'Everything your account did on chain: deposits, withdrawals, swaps, mandates, allocations, sells and payouts.'
            : 'Everything your fund did on chain: escrow, rounds, exits, swaps and trades.',
          $trailing
        )
      const FUND_ACTION_KINDS: ReadonlySet<IAccountAction['kind']> = new Set<IAccountAction['kind']>(['escrow', 'returnEscrow', 'contribute'])
      const historyQuery: IStream<Promise<IAccountAction[]>> = op(
        journalQuery,
        map(async q => {
          const held = await q
          if (held === null) return []
          if (role === 'puppet') return (await accountHistory([held.own])).filter(action => !FUND_ACTION_KINDS.has(action.kind))
          return (await accountHistory([held.own, ...held.bodyList])).filter(
            action => !isAddressEqual(action.account, held.own.account) || FUND_ACTION_KINDS.has(action.kind)
          )
        }),
        answerState
      )
      const pristine: IStream<boolean> =
        role === 'puppet'
          ? op(
              combine({ history: historyQuery, value: accountValueQuery }),
              map(p => Promise.all([p.history, p.value])),
              intermediateState,
              filter(s => s.status !== PromiseStatus.PENDING),
              map(s => s.status === PromiseStatus.DONE && s.value[0].length === 0 && (s.value[1] === null || s.value[1] === 0)),
              skipRepeats,
              state()
            )
          : just(false)
      const $allocationHeader = (account: Address | null, failure: IStream<{ error: unknown } | null>, $trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3(switchLatest(map(failed => (failed === null ? $text('Allocations') : $intermediateFailure(failed.error, $text('Allocations'), true)), failure))),
          $column(spacing.small)(
            $text(
              "Your account. What you hold on the hub joins the rounds of the funds you mandate, within your mandate's limits."
            ),
            ...(account === null
              ? []
              : [$row(spacing.small, style({ alignItems: 'center' }))($node(style({ color: palette.foreground }))($text('Account')), $addressLink(account))])
          ),
          $trailing
        )
      const $emptyHistory = (role: IPortfolioRole): I$Node =>
        $emptySection(role === 'puppet' ? 'Every settled action of your account lands here.' : 'Every settled action of your fund lands here.')
      const draftedCredits: IStream<{ chainId: ChainId; token: Hex; amount: bigint }[]> = op(
        draftDepositList,
        map(list =>
          list
            .filter(d => d.expectedOutput > 0n && !d.toEscrow)
            .map(d => ({ chainId: Number(d.deposit.destinationChainId) as ChainId, token: depositArrivalToken(d), amount: d.expectedOutput }))
        ),
        skipRepeatsWith((a, b) => a.map(r => `${r.chainId}:${r.token}:${r.amount}`).join() === b.map(r => `${r.chainId}:${r.token}:${r.amount}`).join())
      )
      const $draftedCreditRow = (row: { chainId: ChainId; token: Hex; amount: bigint }): I$Node => {
        const description = getTokenDescription(row.chainId, row.token)
        return $row(
          spacing.default,
          style({ alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` })
        )(
          $tokenProfile(row.chainId, row.token, 28, row.chainId !== HUB_CHAIN_ID),
          $node(style({ flex: 1 }))(),
          $amountDisplay({
            hideBalances,
            usd: map(price => usdOf(0n, price), priceFor(row.chainId, row.token)),
            amount: readableTokenAmountLabel(description, 0n),
            change: map(price => ({ usd: usdOf(row.amount, price), amount: readableTokenAmountLabel(description, row.amount) }), priceFor(row.chainId, row.token)),
            color: just(palette.positive),
            align: 'flex-end'
          })
        )
      }
      const $identityHint = $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground, minWidth: '0' }))(
        $node(style({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: '0' }))($text("How it's shared publicly")),
        $infoTooltip(
          "Your fund's name and avatar on the leaderboard, its page and share cards. They are written on chain with your first allocation and stay fixed after that."
        )
      )
      const $createFund = (root: IRootState, wallet: IConnectedWallet): I$Node => {
        const savedRound: IStream<IDepositDraft | null> = map(list => list.find(d => d.id === 'deposit') ?? null, draftDepositList)
        return $column(spacing.default, style({ width: '100%', paddingTop: '8px' }))(
          $Popover({
            $container: $node(style({ display: 'flex', justifyContent: 'center', width: '100%' })),
            $contentContainer: $editorPopoverContentContainer,
            $target: $row(spacing.default, style({ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }))(
              $FundIdentityEditor(typedSymbol, chosenCells, suggestedIdentity.symbol, $identityHint, closeIdentity)({
                changeSymbol: changeSymbolTether(),
                changeCells: changeCellsTether(),
                openAvatar: openAvatarTether()
              }),
              $ButtonPrimary({
                $container: $defaultMiniButtonPrimary(style({ flexShrink: '0' })),
                $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Create fund'), $popoverCaret())
              })({ click: popAllocateTether() })
            ),
            $open: merge(
              openAvatar,
              map(
                () =>
                  root.unreachable.has(HUB_CHAIN_ID as ChainId)
                    ? $emptySection(`${chainFor(HUB_CHAIN_ID).name} could not be probed for your account; retry once it answers.`)
                    : $DepositEditor({
                        walletChainId: walletControl.chainId,
                        label: 'Allocate',
                        hideBalances,
                        walletAccount: wallet,
                        destination: { inKind: true },
                        stakeFloor: minFundedAmount,
                        existingDraft: savedRound,
                        preset: null
                      })({ changeDraft: fundCreateTether() }),
                popAllocate
              )
            ),
            dismiss: merge(changeCells, fundCreate)
          })({ dismiss: closeIdentityTether() }),
          switchMap(d => {
            if (d === null) return empty
            const chainId = Number(d.deposit.destinationChainId) as ChainId
            const token = depositArrivalToken(d)
            const description = getTokenDescription(chainId, token)
            const before = balanceAt(root.balances, chainId, token)
            const price = priceFor(chainId, token)
            return $row(spacing.default, style({ alignItems: 'center', width: '100%' }))(
              $tokenProfile(chainId, token, 28, chainId !== HUB_CHAIN_ID),
              $node(style({ flex: 1 }))(),
              $amountDisplay({
                hideBalances,
                usd: map(v => usdOf(before, v), price),
                amount: readableTokenAmountLabel(description, before),
                change: map(v => ({ usd: usdOf(before + d.expectedOutput, v), amount: readableTokenAmountLabel(description, before + d.expectedOutput) }), price),
                color: just(palette.positive),
                align: 'flex-end'
              })
            )
          }, savedRound)
        )
      }
      const $headerPopoverContainer = $node(style({ display: 'flex', flexDirection: 'column' }))
      const $browseTraders = $emptySection(
        'Allocate your deposit to a fund.',
        $Link({
          route: routeSchema.traders,
          $anchor: $defaultAnchor(style({ fontSize: text.sm })),
          $content: $text('Browse funds')
        })({})
      )
      const $onboardingShell = (role: IPortfolioRole, account: Address | null, caption: string, $depositAction: I$Node): I$Node =>
        $column(style({ gap: isDesktopScreen ? '40px' : '28px', padding: '0 0 4px' }))(
          $sectionList(
            role === 'master'
              ? $section(
                  $sectionHeader($heading3($text('Fund')), 'Name your fund, then make its first allocation to open it.'),
                  account === null ? $stillListed(walletControl.releases) : empty,
                  $node(style({ position: 'relative', display: 'flex', justifyContent: 'center', width: '100%', paddingTop: '8px' }))(
                    $row(spacing.default, attr({ inert: '' }), style({ alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', opacity: '0.35' }))(
                      $FundIdentityEditor(typedSymbol, chosenCells, suggestedIdentity.symbol, $identityHint, never)({}),
                      $ButtonPrimary({
                        $container: $defaultMiniButtonPrimary(style({ flexShrink: '0' })),
                        disabled: just(true),
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Create fund'), $popoverCaret())
                      })({})
                    ),
                    $node(style({ position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }))(
                      $column(
                        spacing.small,
                        style({ alignItems: 'center', padding: '26px 64px', background: `radial-gradient(closest-side, ${palette.background} 60%, transparent)` })
                      )(
                        $node(style({ display: 'flex', borderRadius: '999px', boxShadow: `0 0 14px 3px ${palette.background}, 0 3px 10px #00000066` }))($depositAction),
                        $node(style({ fontSize: text.xs, color: palette.foreground, textAlign: 'center', whiteSpace: 'nowrap' }))($text(caption))
                      )
                    )
                  )
                )
              : $section(
              $allocationHeader(account, just(null)),
              account === null ? $stillListed(walletControl.releases) : empty,
              $column(spacing.default)(
                switchLatest(
                  map(
                    rows =>
                      rows.length === 0
                        ? empty
                        : $column(spacing.default)(...rows.map($draftedCreditRow)),
                    draftedCredits
                  )
                ),
                $emptySection(account === null ? 'Connect a wallet, then deposit to your account and allocate it to a fund.' : NO_ACTIVITY, $depositAction)
              )
            ),
            $section($historyHeader(role)(just(null)), $emptyHistory(role))
          )
        )

      interface IFundLeg {
        chainId: ChainId
        token: Address
        fundBalance: bigint
      }
      interface IFundSection {
        master: Address
        fundRow: IFundRow | undefined
        shares: bigint
        legs: IFundLeg[]
        standing: (IStandingAllowance & { live: bigint })[]
        surplus: ReturnType<typeof escrowSurplus>
      }
      const fundAccount: IStream<Address | null> = op(
        combine({ pair: walletPair, root: walletRoot }),
        map(p => {
          if (p.root !== null) return p.root.fund === null || 'unknown' in p.root.fund ? null : p.root.fund.account
          if (p.pair.wallet === null) return null
          return selectedFundOf(journalDeps.storage, p.pair.wallet.address) ?? fundRecordsOf(journalDeps.storage, p.pair.wallet.address)[0]?.account ?? null
        }),
        skipRepeats,
        state()
      )
      const linkedVenues: IStream<readonly IVenue[]> = op(
        walletLinkSessions,
        map(sessions =>
          VENUES.filter(venue => sessions.some(session => session.verifiedOrigin !== null && venueOfUrl(session.verifiedOrigin) === venue))
        ),
        skipRepeatsWith((a, b) => a.length === b.length && a.every((venue, i) => venue === b[i]))
      )
      const fundQuery: IStream<Promise<IFundSection | null>> = op(
        combine({ own: ownStateQuery, journal: journalQuery, master: fundAccount, linked: linkedVenues }),
        map(q => {
          const sectionAt = async (view: IViewRead): Promise<IFundSection | null> => {
            const master = q.master
            if (master === null) return null
            const [own, held] = await Promise.all([q.own, q.journal])
            if (own === null || held === null) return null
            const standing = await standingAllowancesOf(
              view,
              own.allowances.filter(row => isAddressEqual(row.account, master))
            ).then(grants => Promise.all(grants.map(async grant => ({ ...grant, live: await readTokenAllowance(view, master, grant.chainId, grant.token, grant.spender, 0) }))))
            const listed = (chainId: ChainId, token: Address): boolean => listedTokensOf(chainId).some(r => isAddressEqual(r, token))
            const fundRow = own.fundRows.find(row => isAddressEqual(row.master, master))
            const body = held.bodyList.find(j => isAddressEqual(j.account, master))
            const recordedAfter = (chainId: ChainId, token: Address, deadline: number): boolean =>
              body !== undefined && (body.entries.get(chainId) ?? []).some(call => call.blockTimestamp > deadline && call.balanceList.some(b => isAddressEqual(b.token, token)))
            const arrivals = [
              ...new Map([
                ...own.transits
                  .filter(row => isAddressEqual(row.account, master))
                  .flatMap(row => {
                    const chainId = Number(row.destinationChainId) as ChainId
                    const output = getAddress(row.outputToken)
                    const wrapped = wrappedNativeAddressOf(chainId)
                    const family = isAddressEqual(output, PROTOCOL.nativeToken) || isAddressEqual(output, wrapped) ? [getAddress(PROTOCOL.nativeToken), wrapped] : [output]
                    return family
                      .filter(token => listed(chainId, token) && !recordedAfter(chainId, token, row.fillDeadline))
                      .map(token => [`${chainId}:${token}`, { chainId, token }] as const)
                  }),
                ...q.linked.flatMap(venue => {
                  if (venue.withdraw === undefined || !listed(venue.withdraw.chainId, venue.withdraw.token)) return []
                  const token = getAddress(venue.withdraw.token)
                  return [[`${venue.withdraw.chainId}:${token}`, { chainId: venue.withdraw.chainId, token }] as const]
                })
              ]).values()
            ]
            const live = await Promise.all(arrivals.map(async arrival => ({ ...arrival, amount: await readTokenBalance(view, master, arrival.chainId, arrival.token, PROBE_MAX_AGE_MS) })))
            const stored = own.balances
              .filter(row => isAddressEqual(row.account, master) && listed(Number(row.chainId) as ChainId, row.token))
              .map(row => ({ chainId: Number(row.chainId) as ChainId, token: getAddress(row.token), amount: row.amount }))
            const balances =
              held.live === null || body === undefined
                ? stored
                : fundBalancesOf(body.entries, stored, (await held.live).open.holdings).filter(row => listed(row.chainId, row.token))
            const recorded = [
              ...balances.filter(row => row.amount > 0n && !live.some(l => l.chainId === row.chainId && isAddressEqual(l.token, row.token))),
              ...live.filter(l => l.amount > 0n)
            ]
            const legs: IFundLeg[] = recorded
              .sort((a, b) =>
                a.chainId === b.chainId
                  ? listedTokensOf(a.chainId).findIndex(token => isAddressEqual(token, a.token)) - listedTokensOf(b.chainId).findIndex(token => isAddressEqual(token, b.token))
                  : a.chainId === HUB_CHAIN_ID
                    ? -1
                    : b.chainId === HUB_CHAIN_ID
                      ? 1
                      : a.chainId - b.chainId
              )
              .map(row => ({ chainId: row.chainId, token: row.token, fundBalance: row.amount }))
            const holding = own.holdings.find(row => isAddressEqual(row.master, master) && isAddressEqual(row.holder, master))
            return {
              master,
              fundRow,
              shares: holding === undefined ? 0n : holding.shares,
              legs,
              standing,
              surplus: escrowSurplus(own, held.own)
            }
          }
          return localFirst(() => sectionAt(req => localViewCall(req).then(hit => (hit === null ? notLocal : hit))), () => sectionAt(viewCall))
        }),
        switchLatest,
        answerState
      )
      type IFundBookView = { own: IOwnState; book: IFundBook; fundRow: IFundRow | undefined }
      const fundBook = op(
        combine({
          master: fundAccount,
          refresh: start(
            null,
            merge(
              refreshRounds,
              op(
                walletRoot,
                map(root => (root === null ? null : root.settled)),
                skipRepeats,
                skip(1),
                filterNull
              )
            )
          )
        }),
        map(q => {
          if (q.master === null) return null
          const local = q.refresh === null ? readFundBook({ chronicle: localReader }, q.master) : null
          const fresh = readFundBook({ chronicle: client }, q.master)
          return { master: q.master, local: local === null ? fresh : local, fresh }
        }),
        state()
      )
      const fundBookQuery: IStream<Promise<IFundBookView | null>> = op(
        combine({ own: ownStateQuery, book: fundBook }),
        switchMap((q): IStream<Promise<IFundBookView | null>> => {
          const book = q.book
          if (book === null) return just(Promise.resolve(null))
          const viewOf = (read: Promise<IFundBook>): Promise<IFundBookView | null> =>
            Promise.all([q.own, read]).then(([own, held]) => (own === null ? null : { own, book: held, fundRow: own.fundRows.find(row => isAddressEqual(row.master, book.master)) }))
          return localFirst(() => viewOf(book.local), () => viewOf(book.fresh))
        }),
        answerState
      )
      const hubTokens = Object.values(HUB_CANONICAL_TOKEN).map(token => getAddress(token))
      const holdersAt = async (master: Address, user: Address, read: Promise<IFundBook>, reader: IDigestClient, rate: IGetRate) => {
        const held = await read
        const holdings = held.holdings.filter(h => h.shares > 0n || exitingSharesOf(held, h.holder) > 0n)
        const mandating = held.mandates.map(row => getAddress(row.puppet)).filter(puppet => !isAddressEqual(puppet, master))
        const [puppets, balances, prices, [fundRow]] = await Promise.all([
          walletsOf(reader, [...holdings.flatMap(h => (isAddressEqual(h.holder, master) ? [] : [h.holder])), ...mandating]),
          mandating.length === 0 ? [] : reader.select(balanceTable, { where: { account: { in: mandating } } }),
          Promise.all(
            hubTokens.map(async token => ({
              token,
              price: await markPrice(rate, HUB_CHAIN_ID as ChainId, token, 10n ** BigInt(getTokenDescription(HUB_CHAIN_ID as ChainId, token).decimals), PRICE_FRESHNESS_MS)
            }))
          ),
          reader.select(fundTable, { where: { master } })
        ])
        return {
          holdings,
          book: held,
          fundRow,
          balances: balances.flatMap(row =>
            Number(row.chainId) === HUB_CHAIN_ID && row.amount > 0n && hubTokens.some(token => isAddressEqual(token, row.token))
              ? [{ puppet: getAddress(row.account), token: getAddress(row.token), amount: row.amount }]
              : []
          ),
          prices,
          wallets: new Map([...puppets, [getAddress(master), user]])
        }
      }
      type IFundHolders = Awaited<ReturnType<typeof holdersAt>> & { fundRow: IFundRow }
      const fundHolders = op(
        combine({
          book: fundBook,
          user: op(
            walletRoot,
            map(root => (root === null ? null : root.user)),
            skipRepeats
          )
        }),
        map(q => {
          const book = q.book
          const user = q.user
          if (book === null || user === null) return null
          return {
            master: book.master,
            local: holdersAt(book.master, user, book.local, localReader, localGetRate),
            fresh: holdersAt(book.master, user, book.fresh, client, getRate)
          }
        }),
        state()
      )
      const fundHoldersQuery = op(
        fundHolders,
        switchMap((holders): IStream<Promise<IFundHolders | null>> => {
          if (holders === null) return just(Promise.resolve(null))
          const shownOf = (read: Promise<Awaited<ReturnType<typeof holdersAt>>>): Promise<IFundHolders | null> =>
            read.then(held => (held.fundRow === undefined ? null : { ...held, fundRow: held.fundRow }))
          return localFirst(() => shownOf(holders.local), () => shownOf(holders.fresh))
        }),
        answerState
      )
      const relayCostQuery = op(
        fundBook,
        map(() =>
          Promise.all([
            Promise.all(hubTokens.map(token => context.getRelayFeeQuote(HUB_CHAIN_ID as ChainId, token, DISPLAY_QUOTE_TTL_MS).then(quote => quote('sell', false, 0n, 0n, 0n)))),
            context.getRelayFeeQuote(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH, DISPLAY_QUOTE_TTL_MS).then(quote => quote('allocate', true, PROTOCOL.maxCohortSize, 0n, 0n))
          ]).then(([reserves, feeCeiling]) => ({ reserves, feeCeiling }))
        ),
        answerState
      )
      const rounds: IStream<Promise<readonly IPooledRound[] | null>> = op(
        fundBookQuery,
        map(async q => {
          const held = await q
          const fundRow = held === null ? undefined : held.own.fundRows.find(row => isAddressEqual(row.master, held.book.master))
          return held === null || fundRow === undefined
            ? null
            : readRounds(fundRow, Promise.resolve(held.book), Object.values(HUB_CANONICAL_TOKEN).map(token => getAddress(token)))
        }),
        answerState
      )
      const raiseSaved: IStream<IRaise | null> = state(null, sampleMap(raise => raise, allocateRaise, merge(roundSaved, fundAllocate)))
      const raiseAfter: IStream<IRaise | null> = op(
        combine({
          saved: raiseSaved,
          drafted: op(
            draftTradeList,
            map(list => list.some(d => d.kind === 'allocate')),
            skipRepeats
          )
        }),
        map(p => (p.drafted ? p.saved : null)),
        state()
      )
      const redeemPlan: IStream<IRedeemPlan | null> = op(
        draftTradeList,
        map(list => {
          const drafted = list.find((d): d is IRedeemDraft => d.kind === 'redeem')
          return drafted === undefined ? null : drafted.plan
        }),
        skipRepeats,
        state()
      )
      const positionsQuery = op(
        journalQuery,
        map(async q => {
          const held = await q
          return held === null || held.live === null ? null : (await held.live).open
        }),
        answerState
      )
      type IHoldingsView = { s: IFundSection | null; venues: { open: IOpenPositions } | { error: unknown }; linked: readonly IVenue[] }
      const holdingsState: IStream<PromiseState<IHoldingsView>> = op(
        combine({ fund: fundQuery, positions: positionsQuery, linked: linkedVenues }),
        map(async (q): Promise<IHoldingsView> => {
          const [s, open] = await Promise.all([
            q.fund,
            q.positions.then(
              value => ({ value }),
              (error: unknown) => ({ error })
            )
          ])
          return { s, venues: 'error' in open ? open : { open: open.value === null ? { failed: [], holdings: { syncedAt: null, rows: [] }, selfCustody: [], venues: [] } : open.value }, linked: q.linked }
        }),
        intermediateState,
        state()
      )
      const holdingsFailure: IStream<{ error: unknown } | null> = op(
        holdingsState,
        filter(st => st.status !== PromiseStatus.PENDING),
        map(st => (st.status === PromiseStatus.ERROR ? { error: st.error } : null)),
        start(null),
        state()
      )
      const shownHoldings: IStream<IHoldingsView> = op(
        holdingsState,
        map(st => (st.status === PromiseStatus.DONE ? st.value : null)),
        filterNull,
        state()
      )
      const fundLegs: IStream<readonly IFundLeg[]> = op(
        shownHoldings,
        map(view => (view.s === null ? [] : view.s.legs)),
        state()
      )
      const usedVenuesOf = (view: IHoldingsView): IVenue[] => {
        const s = view.s
        if (s === null || 'error' in view.venues) return []
        const open = view.venues.open
        return VENUES.filter(venue => {
          if (view.linked.includes(venue) || s.standing.some(grant => grant.venueId === venue.venueId)) return true
          const entry = open.venues.find(e => e.venue === venue)
          return entry !== undefined && (entry.syncedAt === null || open.failed.some(f => f.venue === venue.venueId) || entry.positions.some(row => row.size !== 0n))
        })
      }
      const holdingsShapeOf = (view: IHoldingsView): string =>
        view.s === null
          ? 'none'
          : JSON.stringify(
              {
                master: view.s.master,
                opened: view.s.fundRow !== undefined,
                legs: view.s.legs.map(leg => `${leg.chainId}:${leg.token}`),
                surplus: view.s.surplus,
                venues: 'error' in view.venues ? null : usedVenuesOf(view).map(venue => `${venue.venueId}:${view.linked.includes(venue)}`)
              },
              (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
            )
      const $fundGrid = $node(style({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', columnGap: '40px', rowGap: '28px', alignItems: 'start' }))
      const $sectionShell = (failure: { error: unknown } | null) =>
        $sectionList(
          role === 'puppet'
            ? $section($allocationHeader(null, just(failure)))
            : $fundGrid(
                $section(failure === null ? empty : $intermediateFailure(failure.error, $text('-'), false)),
                $section($sectionHeader($heading3(failure === null ? $text('Distribution') : $intermediateFailure(failure.error, $text('Distribution'), true)), null))
              ),
          $section($historyHeader(role)(just(failure)))
        )

      const sectionView = state()(
        start(
          { pending: true, fund: null, $body: $sectionShell(null) },
          map(
            (s: ISectionState): { pending: boolean; fund: IFund | null; $body: I$Node } => {
              if (s.kind === 'pending') return { pending: true, fund: null, $body: $sectionShell(null) }
              if (s.kind === 'error') return { pending: false, fund: null, $body: $sectionShell({ error: s.error }) }
              const p = s.params
              if (!p.wallet) {
                return {
                  pending: false,
                  fund: null,
                  $body: $onboardingShell(
                    role,
                    null,
                    'Connect a wallet to name and open your fund',
                    $Popover({
                      $container: $headerPopoverContainer,
                      $target: $ButtonPrimary({ $container: $defaultMiniButtonPrimary, $content: $text('Connect') })({ click: popConnectTether() }),
                      $open: map(() => $WalletConnect({ control: walletControl })({ walletIntent: walletIntentTether() }), popConnect)
                    })({})
                  )
                }
              }
              const wallet = p.wallet
              const keys = p.keys
              const recorded = p.fund === null || 'unknown' in p.fund ? null : p.fund
              const viewOnly = fundViewOnly
              const valuationOwner: IValuationOwner = {
                user: wallet.address,
                approve: async digest => {
                  const session = keys === null ? null : await keys.carriedSessionOf(wallet.address, HUB_CHAIN_ID)
                  if (session === null) throw new Error('sign a session on this device to act on your account')
                  return session.approve(digest)
                }
              }
              const root = p.root
              if (root === null) {
                return {
                  pending: false,
                  fund: null,
                  $body: $onboardingShell(
                    role,
                    predictUserAccount(wallet.address),
                    'Deposit to set up your account, then open your fund',
                    $Popover({
                      $contentContainer: $editorPopoverContentContainer,
                      $target: $ButtonPrimary({
                        $container: $defaultMiniButtonPrimary,
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                      })({ click: popDepositTether() }),
                      $open: map(
                        () =>
                          $DepositEditor({
                            walletChainId: walletControl.chainId,
                            label: 'Deposit',
                            hideBalances,
                            walletAccount: wallet,
                            destination: {
                              choose: listedTokensOf(HUB_CHAIN_ID)
                                .filter(token => !isAddressEqual(token, PROTOCOL.nativeToken))
                                .map(token => ({ chainId: HUB_CHAIN_ID as ChainId, token: token as Hex })),
                              scope: 'deposit'
                            },
                            preset: null,
                            existingDraft: map(
                              list => list.find(d => Number(d.deposit.destinationChainId) === d.deposit.chainId) ?? null,
                              draftDepositList
                            )
                          })({ changeDraft: changeDraftTether() }),
                        popDeposit
                      ),
                      dismiss: changeDraft
                    })({})
                  )
                }
              }
              const puppetAddress = root.account
              const puppetAccount: IStream<IRootState> = start(
                root,
                filter((live): live is IRootState => live !== null && isAddressEqual(live.user, wallet.address), walletRoot)
              )
              const draftFor = (dep: IDepositDraft[], wd: IWithdrawDraft[], chainId: ChainId, token: Hex): IEditorDraft | null =>
                dep.find(
                  x =>
                    (Number(x.deposit.destinationChainId) === chainId && isAddressEqual(depositArrivalToken(x), token)) ||
                    (x.deposit.chainId === chainId && isAddressEqual(x.deposit.inputToken, token))
                ) ?? (wd.find(x => x.chainId === chainId && isAddressEqual(x.inputAmount.token, token)) ?? null)
              const accountDepositList = map(list => list.filter(d => !d.toEscrow), draftDepositList)
              const draftDelta = (d: IEditorDraft, chainId: ChainId, token: Hex): bigint => {
                if (d.kind === 'withdraw') {
                  return d.chainId === chainId && isAddressEqual(d.inputAmount.token, token) ? -d.inputAmount.amount : 0n
                }
                return Number(d.deposit.destinationChainId) === chainId && isAddressEqual(depositArrivalToken(d), token)
                  ? d.expectedOutput
                  : 0n
              }
              const $balanceEditor = (chainId: ChainId, token: Hex): I$Node =>
                $TokenBalanceEditor({
                  hideBalances,
                  viewOnly,
                  accountState: puppetAccount,
                  chainId,
                  token,
                  walletAccount: wallet,
                  draft: map(d => draftFor(d.dep, d.wd, chainId, token), combine({ dep: accountDepositList, wd: draftWithdrawList })),
                  exit: map(q => q.windows.get(chainId)?.phase ?? null, exitWindows)
                })({ changeDraft: changeDraftTether(), walletWithdraw: changeTradeDraftTether() })
              const heldRows: IStream<{ chainId: ChainId; token: Hex }[]> = op(
                combine({ account: puppetAccount, dep: accountDepositList, wd: draftWithdrawList }),
                map(q =>
                  [HUB_CHAIN_ID, ...([...CHAIN_IDS] as ChainId[]).filter(c => c !== HUB_CHAIN_ID)].flatMap(chainId =>
                    listedTokensOf(chainId)
                      .filter(token => {
                        if (balanceAt(q.account.balances, chainId, token) > 0n) return true
                        const drafted = draftFor(q.dep, q.wd, chainId, token)
                        return drafted !== null && draftDelta(drafted, chainId, token) !== 0n
                      })
                      .map(token => ({ chainId, token }))
                  )
                ),
                skipRepeatsWith((a, b) => a.map(x => `${x.chainId}:${x.token}`).join() === b.map(x => `${x.chainId}:${x.token}`).join())
              )
              const $depositPopover = $Popover({
                $contentContainer: $editorPopoverContentContainer,
                $target: $ButtonPrimary({
                  $container: $defaultMiniButtonPrimary,
                  disabled: viewOnly,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                })({ click: popDepositTether() }),
                $open: map(
                  () =>
                    $DepositEditor({
                          walletChainId: walletControl.chainId,
                          label: 'Deposit',
                      hideBalances,
                      walletAccount: wallet,
                      destination: {
                            choose: listedTokensOf(HUB_CHAIN_ID)
                              .filter(token => !isAddressEqual(token, PROTOCOL.nativeToken))
                              .map(token => ({ chainId: HUB_CHAIN_ID as ChainId, token: token as Hex })),
                            scope: 'deposit'
                          },
                      preset: null,
                      existingDraft: map(
                        list =>
                          list.find(d => Number(d.deposit.destinationChainId) === d.deposit.chainId) ?? null,
                        draftDepositList
                      )
                    })({ changeDraft: changeDraftTether() }),
                  popDeposit
                ),
                dismiss: changeDraft
              })({})
              const $allocateOver = (fund: IFund, $header: I$Node, open: IStream<unknown>, preset: I$DepositEditor['preset']): I$Node => $Popover({
                $container: $headerPopoverContainer,
                $contentContainer: $editorPopoverContentContainer,
                $target: $header,
                $open: map(
                  (owned: Promise<IOwnState | null>) => {
                    if (root.unreachable.has(HUB_CHAIN_ID as ChainId)) {
                      return $emptySection(`${chainFor(HUB_CHAIN_ID).name} could not be probed for your account; retry once it answers.`)
                    }
                    return $intermediatePromise({
                      $loader: $intermediateEditor,
                      $display: just(
                        owned.then(own => {
                          const fundRow = own === null ? undefined : own.fundRows.find(row => isAddressEqual(row.master, fund.account))
                          return $DepositEditor({
                            walletChainId: walletControl.chainId,
                            label: 'Allocate',
                            $note:
                              own === null || fundRow === undefined
                                ? empty
                                : $AllocationSimulation({
                                    fundRow,
                                    owner: valuationOwner,
                                    signed: keys !== null && keys.grantedChains(wallet.address).length > 0,
                                    hideBalances,
                                    rounds,
                                    arrival,
                                    boundChains: new Set(
                                      own.accounts.filter(row => isAddressEqual(row.account, fund.account)).map(row => Number(row.chainId) as ChainId)
                                    )
                                  })({
                                    puppets: roundPuppetsTether(),
                                    raise: allocateRaiseTether(),
                                    refreshRounds: refreshRoundsTether(),
                                    enableSession: enableSessionTether()
                                  }),
                            ...(fundRow !== undefined
                              ? {
                                  gate: start(false, map(puppets => puppets !== null, roundPuppets)),
                                  raisesAtZero: start(false, map(puppets => puppets !== null && puppets > 0n, roundPuppets))
                                }
                              : { stakeFloor: minFundedAmount }),
                            hideBalances,
                            walletAccount: wallet,
                            destination: { inKind: true },
                            existingDraft: map(list => list.find(d => d.id === 'deposit') ?? null, draftDepositList),
                            preset
                          })({ changeDraft: fundRow !== undefined ? fundRoundTether() : fundAllocateTether(), arrival: arrivalTether() })
                        })
                      )
                    })
                  },
                  sampleMap((owned: Promise<IOwnState | null>) => owned, ownStateQuery, open)
                ),
                dismiss: merge(roundSaved, fundAllocate, enableSession)
              })({})
              const $depositList = switchLatest(
                map(rows => {
                  if (rows.length === 0) return empty
                  return $column(style({ gap: '0' }))(
                    ...rows.map((r, i) =>
                      $node(style(i === rows.length - 1 ? {} : { borderBottom: `1px solid ${SEPARATOR_COLOR}` }))(
                        $balanceEditor(r.chainId, r.token)
                      )
                    )
                  )
                }, heldRows)
              )
              const $exitStrip = switchLatest(
                op(
                  combine({ exit: exitWindows, account: puppetAccount, session: agent.session }),
                  map(p =>
                    [...p.exit.windows]
                      .filter(([chainId, window]) => (window.phase !== 'closed' || !p.session) && p.account.balances.some(row => row.chainId === chainId && row.balance > 0n))
                      .map(([chainId, window]) => ({ chainId, phase: window.phase }))
                  ),
                  skipRepeatsWith((a, b) => a.length === b.length && a.every((line, i) => line.chainId === b[i]!.chainId && line.phase === b[i]!.phase)),
                  map(lines =>
                    lines.length === 0
                      ? empty
                      : $column(spacing.small)(
                          ...lines.map(({ chainId, phase }) =>
                            $alertIntermediateContainer(style({ alignSelf: 'flex-start', flexWrap: 'wrap' }))(
                              $chainIcon(chainId, 18),
                              $node(style({ fontSize: text.sm, color: palette.message }))(
                                $text(
                                  op(
                                    exitWindows,
                                    map(q => {
                                      const window = q.windows.get(chainId)
                                      if (window === undefined) return null
                                      if (window.phase === 'waiting') return `Withdraw on ${chainName(chainId)} opens in ${shortDuration(window.until - q.now)}`
                                      if (window.phase === 'open') return `Withdraw on ${chainName(chainId)} · ${shortDuration(window.until - q.now)} left`
                                      return `Withdraw window on ${chainName(chainId)} closed`
                                    }),
                                    filterNull,
                                    skipRepeats
                                  )
                                )
                              ),
                              $infoTooltip(
                                phase === 'waiting'
                                  ? `You revoked every session on ${chainName(chainId)}. In ${revokeDelay / 60} minutes your wallet can withdraw each token there for ${revokeDelay / 60} minutes. Puppet relays nothing for your account until that window closes.`
                                  : phase === 'open'
                                    ? `Withdraw each token on ${chainName(chainId)} to your wallet before the window closes. Puppet relays nothing for your account until then.`
                                    : `Revoke again to reopen the window ${revokeDelay / 60} minutes later, or sign a session to use Puppet as before.`,
                                palette.foreground
                              ),
                              phase === 'closed'
                                ? $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Revoke again') })({
                                    click: revokeAgainTether(constant<IRevokeDraft>({ kind: 'revoke', id: `revoke:${chainId}`, chainId }))
                                  })
                                : empty
                            )
                          )
                        )
                  )
                )
              )
              const $mandateRow = (b: IAllocationSection, master: Address): I$Node => {
                const nowSec = getUnixTimestamp()
                const mandate = b.mandates.find(m => isAddressEqual(m.master, master))
                const active = mandate !== undefined && mandateTermsOf(mandate).until > BigInt(nowSec)
                const holding = b.holdings.find(h => isAddressEqual(h.master, master))
                const fundRow = b.fundRows.find(row => isAddressEqual(row.master, master))
                const backable = mandate !== undefined || fundRow !== undefined
                const draft = op(
                  draftMandateList,
                  map(list => list.find(d => isAddressEqual(d.mandate.master, master)) ?? null)
                )
                const sellKey = `sell:${master}`
                const standing = holding === undefined ? null : holding.standing
                const perf = b.worth.get(getAddress(master))
                const exit = perf === undefined || perf === null ? null : perf.exit
                return $column(style({ padding: '10px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` }))(
                  $Popover({
                    $contentContainer: $editorPopoverContentContainer,
                    $target: $mandatePosition(
                      hideBalances,
                      master,
                      mandate,
                      holding,
                      fundRow,
                      perf,
                      !backable
                        ? []
                        : [
                            $ButtonSecondary({
                              $container: $defaultMiniButtonSecondary,
                              disabled: viewOnly,
                              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text(active ? 'Manage' : 'Mandate'), $popoverCaret())
                            })({ click: popMandateTether(map(() => master)) })
                          ],
                      standing !== null && standing.kind === 'current' && holding !== undefined && holding.shares > 0n
                        ? [
                            $ButtonSecondary({
                              $container: $defaultMiniButtonSecondary,
                              disabled: viewOnly,
                              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Sell'), $popoverCaret())
                            })({ click: popTradeTether(map(() => sellKey)) })
                          ]
                        : []
                    ),
                    $open: merge(
                      op(
                        popMandate,
                        filter(key => isAddressEqual(key, master)),
                        map(() =>
                          $MandateEditor({
                            master,
                            existing: mandate,
                            draft
                          })({
                            changeMandateDraft: changeMandateDraftTether()
                          })
                        )
                      ),
                      ...(standing !== null && standing.kind === 'current' && holding !== undefined && holding.shares > 0n
                        ? [
                            op(
                              popTrade,
                              filter(key => key === sellKey),
                              map(() =>
                                $SellEditor({
                                  master,
                                  hideBalances,
                                  held: holding.shares,
                                  fundRow: standing.fundRow,
                                  draft: map(list => list.find((d): d is ISellDraft => d.kind === 'sell' && isAddressEqual(d.master, master)) ?? null, draftTradeList)
                                })({ changeTradeDraft: changeTradeDraftTether() })
                              )
                            )
                          ]
                        : [])
                    ),
                    dismiss: merge(changeMandateDraft, changeTradeDraft)
                  })({}),
                  ...(exit === null || fundRow === undefined ? [] : [$exitQueueRow(hideBalances, fundRow, exit)])
                )
              }
              const allocationShown = op(
                allocationQuery,
                map(async (query: Promise<IAllocationSection>) => {
                  const b = await query
                  const masters = b.masters.filter(master => !isAddressEqual(master, puppetAddress))
                  if (masters.length === 0) {
                    return $browseTraders
                  }
                  return $column(spacing.tiny)(...masters.map(m => $mandateRow(b, m)))
                }),
                intermediateState,
                reduce(
                  (last: { st: PromiseState<I$Node>; known: boolean }, st: PromiseState<I$Node>) => ({ st, known: last.known || st.status === PromiseStatus.DONE }),
                  { st: { status: PromiseStatus.PENDING }, known: false }
                ),
                state()
              )
              const allocationFailure = op(
                allocationShown,
                map(a => (a.st.status === PromiseStatus.ERROR && a.known ? { error: a.st.error } : null))
              )
              const $allocationList = switchLatest(
                start(
                  empty,
                  op(
                    allocationShown,
                    map(a =>
                      a.st.status === PromiseStatus.DONE
                        ? a.st.value
                        : a.st.status === PromiseStatus.ERROR && !a.known
                          ? $intermediateFailure(a.st.error, $text('-'), false)
                          : null
                    ),
                    filterNull
                  )
                )
              )
              const fundDraftDelta = (list: ITradeDraft[], chainId: ChainId, token: Address): bigint =>
                list.reduce((sum, d) => {
                  if (d.kind === 'allocate') return d.escrowChainId === chainId && isAddressEqual(providerToken(d.escrowToken, d.escrowChainId), token) ? sum + d.contribution : sum
                  if (d.kind === 'venueWithdraw') {
                    const withdraw = venueWithdrawOf(d.venueId).withdraw
                    return withdraw.chainId === chainId && isAddressEqual(withdraw.token, token) ? sum + d.amount - withdraw.feeOf(d.amount) : sum
                  }
                  if (d.kind === 'operateSwap') {
                    return (
                      sum +
                      (d.chainId === chainId && isAddressEqual(d.inputToken, token) ? -d.inputAmount : 0n) +
                      (d.chainId === chainId && isAddressEqual(d.outputToken, token) ? d.outputAmount - d.relayFee - (d.bridge === null ? 0n : d.bridge.inputAmount) : 0n) +
                      (d.bridge !== null && d.bridge.destinationChainId === chainId && isAddressEqual(d.bridge.outputToken, token) ? d.bridge.outputAmount : 0n)
                    )
                  }
                  if (d.kind === 'redeem') {
                    if (d.leg === null) return sum
                    const arrivalToken = !isAddressEqual(d.token, HUB_CANONICAL_TOKEN.WETH) || d.leg.chainId === HUB_CHAIN_ID ? d.token : PROTOCOL.nativeToken
                    return (
                      sum +
                      (d.leg.chainId === chainId && isAddressEqual(d.leg.inputToken, token) ? -d.leg.inputAmount : 0n) +
                      (chainId === HUB_CHAIN_ID && isAddressEqual(token, arrivalToken) ? d.leg.outputAmount : 0n)
                    )
                  }
                  if (d.kind !== 'fundSwap') return sum
                  return (
                    sum +
                    (d.chainId === chainId && isAddressEqual(d.inputToken, token) ? -d.inputAmount : 0n) +
                    (d.destinationChainId === chainId && isAddressEqual(d.outputToken, token) ? d.expectedOutput : 0n)
                  )
                }, 0n)
              const puppetInflow = (raise: IRaise | null, chainId: ChainId, token: Address): bigint =>
                raise === null || chainId !== HUB_CHAIN_ID || !isAddressEqual(raise.token, token)
                  ? 0n
                  : raise.joinList.reduce((total, j) => (isAddressEqual(j.holder, raise.fundRow.master) ? total : total + j.amount), 0n)
              const payoutDelta = (list: ITradeDraft[], legs: readonly IFundLeg[], chainId: ChainId, token: Address): bigint =>
                chainId !== HUB_CHAIN_ID
                  ? 0n
                  : list.reduce((sum, d) => {
                      if (d.kind !== 'redeem' || d.plan === null) return sum
                      const cash = d.plan.redemption.potLeft + d.plan.redemption.masterPay
                      const wrappable = isAddressEqual(d.token, HUB_CANONICAL_TOKEN.WETH)
                      const arrival = d.leg !== null && (!wrappable || d.leg.chainId === HUB_CHAIN_ID) ? d.leg.outputAmount : 0n
                      const tokenHeld = (legs.find(leg => leg.chainId === HUB_CHAIN_ID && isAddressEqual(leg.token, d.token))?.fundBalance ?? 0n) + arrival
                      const held = wrappable && tokenHeld < cash ? tokenHeld : cash
                      return sum + (isAddressEqual(token, d.token) ? -held : 0n) + (isAddressEqual(token, PROTOCOL.nativeToken) ? held - cash : 0n)
                    }, 0n)
              const deltaOf = (p: { list: ITradeDraft[]; raise: IRaise | null; legs: readonly IFundLeg[] }, chainId: ChainId, token: Address): bigint =>
                fundDraftDelta(p.list, chainId, token) + puppetInflow(p.raise, chainId, token) + payoutDelta(p.list, p.legs, chainId, token)
              const $fundBalanceAmount = (chainId: ChainId, token: Address, fundBalance: IStream<bigint>): I$Node => {
                const description = getTokenDescription(chainId, token)
                const shown = op(
                  combine({ balance: fundBalance, price: priceFor(chainId, token), list: draftTradeList, raise: raiseAfter, legs: fundLegs, failure: holdingsFailure }),
                  map(p => ({ balance: p.balance, price: p.price, delta: deltaOf(p, chainId, token), failure: p.failure })),
                  state()
                )
                return $amountDisplay({
                  hideBalances,
                  usd: map(p => (p.failure === null ? usdOf(p.balance, p.price) : Promise.reject(p.failure.error)), shown),
                  amount: map((p): Promise<string> | string => (p.failure === null ? readableTokenAmountLabel(description, p.balance) : Promise.reject(p.failure.error)), shown),
                  change: map(p => (p.delta === 0n ? null : { usd: usdOf(p.balance + p.delta, p.price), amount: readableTokenAmountLabel(description, p.balance + p.delta) }), shown),
                  color: map(p => (p.delta > 0n ? palette.positive : palette.negative), shown),
                  align: 'flex-end'
                })
              }
              const $venueLegs = (master: Address, used: readonly IVenue[], linked: readonly IVenue[]): I$Node => {
                const $disconnects = switchLatest(
                  map(
                    (topics: string[]) => {
                      for (const topic of topics) void disconnectDapp(topic)
                      return empty
                    },
                    sampleMap(
                      (sessions: IWalletLinkSession[], venue: IVenue): string[] =>
                        sessions.filter(session => session.verifiedOrigin !== null && venueOfUrl(session.verifiedOrigin) === venue).map(session => session.topic),
                      walletLinkSessions,
                      disconnectVenue
                    )
                  )
                )
                const $venueBlock = (venue: IVenue): I$Node => {
                  const entry = op(
                    shownHoldings,
                    map(view => ('error' in view.venues ? undefined : view.venues.open.venues.find(e => e.venue === venue))),
                    skipRepeats,
                    state()
                  )
                  const failure = op(
                    shownHoldings,
                    map(view => ('error' in view.venues ? null : (view.venues.open.failed.find(f => f.venue === venue.venueId)?.reason ?? null))),
                    skipRepeats
                  )
                  const grants = op(
                    shownHoldings,
                    map(view => (view.s === null ? [] : view.s.standing.filter(grant => grant.venueId === venue.venueId))),
                    skipRepeatsWith(
                      (a, b) =>
                        a.length === b.length &&
                        a.every((grant, i) => grant.chainId === b[i]!.chainId && isAddressEqual(grant.token, b[i]!.token) && isAddressEqual(grant.spender, b[i]!.spender) && grant.live === b[i]!.live)
                    )
                  )
                  const isLinked = linked.includes(venue)
                  const deposit = venue.deposit
                  const withdraw = venue.withdraw
                  const venueKey = `venue:${venue.venueId}`
                  const withdrawKey = `venue:${venue.venueId}:withdraw`
                  return $node(style({ padding: '8px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` }))(
                    $Popover({
                      $contentContainer: $editorPopoverContentContainer,
                      $target: $venueRow(
                        hideBalances,
                        venue.venueId,
                        entry,
                        failure,
                        isLinked
                          ? $ButtonSecondary({
                              $container: $defaultMiniButtonSecondary,
                              $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                                $icon({ $content: $walletConnectLogo, viewBox: '0 0 32 32', width: '14px', fill: palette.positive, svgOps: style({ display: 'block' }) }),
                                $text('Disconnect')
                              )
                            })({ click: disconnectVenueTether(map(() => venue)) })
                          : null,
                        isLinked
                          ? op(
                              walletLinkSessions,
                              map(sessions => {
                                const issues = sessions
                                  .filter(session => session.verifiedOrigin !== null && venueOfUrl(session.verifiedOrigin) === venue)
                                  .flatMap(session => {
                                    const issue = linkIssueOf(session)
                                    return issue === null ? [] : [issue]
                                  })
                                return issues.find(issue => issue.color === palette.negative) ?? issues[0] ?? null
                              }),
                              skipRepeatsWith((a, b) => a?.text === b?.text)
                            )
                          : just(null),
                        [
                          ...(deposit === undefined && withdraw === undefined
                            ? [$node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(venue.name))]
                            : [
                                $row(spacing.small, style({ alignItems: 'center' }))(
                                  ...(deposit === undefined
                                    ? []
                                    : [
                                        $ButtonSecondary({
                                          $container: $defaultMiniButtonSecondary,
                                          disabled: viewOnly,
                                          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                                        })({ click: popTradeTether(map(() => venueKey)) })
                                      ]),
                                  ...(withdraw === undefined
                                    ? []
                                    : [
                                        $ButtonSecondary({
                                          $container: $defaultMiniButtonSecondary,
                                          disabled: viewOnly,
                                          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Withdraw'), $popoverCaret())
                                        })({ click: popTradeTether(map(() => withdrawKey)) })
                                      ])
                                )
                              ])
                        ]
                      ),
                      $open: merge(
                        deposit === undefined
                          ? empty
                          : sampleMap(
                              (view: IHoldingsView) =>
                                $VenueDepositEditor({ hideBalances, account: master, venue, deposit, sources: view.s === null ? [] : view.s.legs })({
                                  changeTradeDraft: changeTradeDraftTether(),
                                  releaseDraft: releaseTradeDraftTether()
                                }),
                              shownHoldings,
                              op(
                                popTrade,
                                filter(key => key === venueKey)
                              )
                            ),
                        withdraw === undefined
                          ? empty
                          : op(
                              popTrade,
                              filter(key => key === withdrawKey),
                              map(() =>
                                $VenueWithdrawEditor({ venue, withdraw, withdrawable: map(current => (current === undefined ? null : current.withdrawable), entry) })({
                                  changeTradeDraft: changeTradeDraftTether()
                                })
                              )
                            )
                      ),
                      dismiss: op(changeTradeDraft, delay(0))
                    })({}),
                    switchLatest(map(current => $node(style({ display: 'contents' }))(...(current === undefined ? [] : $positionList(hideBalances, current.positions))), entry)),
                    switchLatest(
                      map(
                        list =>
                          $node(style({ display: 'contents' }))(
                            ...list.map(grant =>
                              $standingAllowance(
                                venue,
                                grant,
                                grant.live,
                                grant.live > 0n
                                  ? $ButtonSecondary({
                                      $container: $defaultMiniButtonSecondary,
                                      disabled: viewOnly,
                                      $content: $text('Revoke')
                                    })({
                                      click: rowDraftTether(
                                        map((): ITradeDraft => ({
                                          kind: 'operate',
                                          id: `revoke:${grant.chainId}:${grant.token}:${grant.spender}`,
                                          chainId: grant.chainId,
                                          feeToken: 'any',
                                          callList: [
                                            {
                                              target: grant.token,
                                              value: 0n,
                                              gasLimit: REVOKE_GAS_LIMIT,
                                              callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [grant.spender, 0n] })
                                            }
                                          ],
                                          sweepInto: null,
                                          acceptedFee: null
                                        }))
                                      )
                                    })
                                  : null
                              )
                            )
                          ),
                        grants
                      )
                    )
                  )
                }
                return $column(style({ marginTop: '16px', gap: '16px' }))(
                  $disconnects,
                  switchLatest(
                    map(view => {
                      if ('error' in view.venues) return empty
                      const open = view.venues.open
                      return $node(style({ display: 'contents' }))(
                        ...open.failed
                          .filter(f => !open.venues.some(e => e.venue.venueId === f.venue))
                          .map(f => $node(style({ fontSize: text.xs, color: palette.negative }))($text(`${f.venue === ACCOUNT_VENUE ? 'Fund holdings' : f.venue} not refreshed: ${f.reason}`)))
                      )
                    }, shownHoldings)
                  ),
                  ...used.map($venueBlock),
                  ...(used.length === 0
                    ? [
                        $column(style({ alignItems: 'center', gap: '12px', padding: '20px 0 8px' }))(
                          $row(style({ alignItems: 'center' }))(
                            ...VENUES.filter(venue => venue.dapp !== undefined).map((venue, i) =>
                              $node(
                                attr({ title: venue.name }),
                                style({
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '40px',
                                  height: '40px',
                                  marginLeft: i === 0 ? '0' : '-12px',
                                  borderRadius: '50%',
                                  border: `4px solid ${palette.background}`,
                                  backgroundColor: palette.horizon
                                })
                              )($venueIcon(venue.venueId, 18))
                            )
                          ),
                          $node(style({ fontSize: text.sm, color: palette.foreground }))($text('No venue linked yet')),
                          $Link({
                            route: routeSchema.quickstart,
                            $anchor: $defaultAnchor(style({ fontSize: text.sm })),
                            $content: $text('Learn how to open positions →')
                          })({})
                        )
                      ]
                    : [])
                )
              }
              const $custodyLeg = (account: Address, row: IOpenPositions['selfCustody'][number]): I$Node => {
                const chainId = Number(row.chainId) as ChainId
                const token = getAddress(row.contract)
                const swapKey = `operateSwap:${chainId}:${token}`
                const profile = { symbol: row.unit, decimals: row.decimals }
                const swappable = row.size > 0n && UNISWAP_DEPLOYMENTS[chainId] !== undefined && UNISWAP_POOLS[chainId] !== undefined
                return $Popover({
                  $container: $node(style({ padding: '8px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` })),
                  $contentContainer: $editorPopoverContentContainer,
                  $target: $row(spacing.default, style({ alignItems: 'center' }))(
                    $tokenProfile(chainId, token, 28, true, null, profile),
                    $ButtonSecondary({
                      $container: $defaultMiniButtonSecondary,
                      $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
                      disabled: swappable ? viewOnly : just(true)
                    })({ click: popTradeTether(map(() => swapKey)) }),
                    $node(style({ flex: 1 }))(),
                    $amountDisplay({
                      hideBalances,
                      usd: just(row.value === undefined ? '-' : formatUsdNumber(Number(formatUnits(row.value, USD_DECIMALS)))),
                      amount: readableTokenAmountLabel(profile, row.size),
                      change: map(list => {
                        const left = row.size + fundDraftDelta(list, chainId, token)
                        if (left === row.size) return null
                        return {
                          usd: row.value === undefined || row.size === 0n ? '-' : formatUsdNumber(Number(formatUnits((row.value * left) / row.size, USD_DECIMALS))),
                          amount: readableTokenAmountLabel(profile, left)
                        }
                      }, draftTradeList),
                      color: just(palette.negative),
                      align: 'flex-end'
                    })
                  ),
                  $open: op(
                    popTrade,
                    filter(key => key === swapKey),
                    map(() =>
                      $SelfCustodySwapEditor({
                        chainId,
                        account,
                        token,
                        profile,
                        balance: row.size,
                        draft: map(list => list.find((d): d is IOperateSwapDraft => d.kind === 'operateSwap' && d.id === swapKey) ?? null, draftTradeList)
                      })({ changeTradeDraft: changeTradeDraftTether() })
                    )
                  ),
                  dismiss: changeTradeDraft
                })({})
              }
              const $fundLeg = (master: Address, chainId: ChainId, token: Address): I$Node => {
                const swapKey = `fundSwap:${chainId}:${token}`
                const fundBalance: IStream<bigint> = op(
                  shownHoldings,
                  map(view => view.s?.legs.find(leg => leg.chainId === chainId && isAddressEqual(leg.token, token))?.fundBalance ?? null),
                  filterNull,
                  skipRepeats,
                  state()
                )
                return $Popover({
                  $container: $node(style({ padding: '8px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` })),
                  $contentContainer: $editorPopoverContentContainer,
                  $target: $row(spacing.default, style({ alignItems: 'center' }))(
                    $tokenProfile(chainId, token),
                    $ButtonSecondary({
                      $container: $defaultMiniButtonSecondary,
                      $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
                      disabled: map(p => p.view || p.balance === 0n, combine({ view: viewOnly, balance: fundBalance }))
                    })({ click: popTradeTether(map(() => swapKey)) }),
                    $node(style({ flex: 1 }))(),
                    $fundBalanceAmount(chainId, token, fundBalance)
                  ),
                  $open: sampleMap(
                    (balance, preset) =>
                      $FundSwapEditor({
                        account: master,
                        chainId,
                        token,
                        fundBalance: balance,
                        draft: map(
                          list => list.find((d): d is IFundSwapDraft => d.kind === 'fundSwap' && d.id === swapKey) ?? null,
                          draftTradeList
                        ),
                        preset
                      })({ changeTradeDraft: changeTradeDraftTether() }),
                    fundBalance,
                    merge(
                      op(
                        popTrade,
                        filter(key => key === swapKey),
                        map(() => null)
                      ),
                      op(
                        moveToHub,
                        filter(move => move.chainId === chainId && isAddressEqual(move.token, token)),
                        delay(0),
                        map(move => ({ destinationChainId: HUB_CHAIN_ID as ChainId, outputToken: HUB_CANONICAL_TOKEN.WETH, amount: move.amount, locked: false }))
                      )
                    )
                  ),
                  dismiss: changeTradeDraft
                })({})
              }
              const $guidedExit: I$Node = $column(spacing.default, style({ maxWidth: '360px' }))(
                $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.5' }))(
                  $text('Your fund holds no tokens to pay out from. Its value sits in venues: withdraw it to the fund first.')
                ),
                switchLatest(
                  map(view => {
                    if ('error' in view.venues) return $intermediateFailure(view.venues.error, $caption('Venue balances'), false)
                    const held = view.venues.open.venues.filter(entry => entry.value === null || entry.value > 0n)
                    const custody = view.venues.open.selfCustody.filter(row => row.size > 0n)
                    const $custodyNote = $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
                      $text(custody.length === 1 ? 'Its Valuable ERC-20 token pays nothing out until swapped: use Swap on it.' : `Its ${custody.length} Valuable ERC-20 tokens pay nothing out until swapped: use Swap on each.`)
                    )
                    if (held.length === 0) {
                      return custody.length === 0
                        ? $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($text('No venue holds anything either, so there is nothing to redeem yet.'))
                        : $custodyNote
                    }
                    return $column(spacing.small)(
                      ...(custody.length === 0 ? [] : [$custodyNote]),
                      ...held.map(entry =>
                        $row(spacing.small, style({ alignItems: 'center' }))(
                          $venueIcon(entry.venue.venueId, 20),
                          $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text(entry.venue.name)),
                          $node(style({ flex: 1 }))(),
                          $node(style({ fontSize: text.sm, fontFamily: 'var(--font-numbers)', color: palette.message }))(
                            $text(maskBalance(entry.value === null ? '-' : `$${readableUsd(entry.value)}`, hideBalances))
                          ),
                          entry.venue.withdraw === undefined
                            ? $node(style({ fontSize: text.xs, color: palette.foreground }))($text('Withdraw on the venue'))
                            : $ButtonSecondary({
                                $container: $defaultMiniButtonSecondary,
                                disabled: viewOnly,
                                $content: $text('Withdraw')
                              })({ click: popTradeTether(map(() => `venue:${entry.venue.venueId}:withdraw`)) })
                        )
                      )
                    )
                  }, shownHoldings)
                ),
                $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
                  $text(`A withdrawal lands in the fund on the venue's chain. Redeem then offers to move it to ${chainName(HUB_CHAIN_ID)}, where the payout is made.`)
                )
              )
              const $redeemOver = $Popover({
                $container: $headerPopoverContainer,
                $contentContainer: $editorPopoverContentContainer,
                $target: $ButtonSecondary({
                  $container: $defaultMiniButtonSecondary,
                  disabled: viewOnly,
                  $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Redeem'), $popoverCaret())
                })({ click: popRedeemTether() }),
                $open: map(
                  (section: Promise<IFundSection | null>) =>
                    $intermediatePromise({
                      $loader: $intermediateEditor,
                      $display: just(
                        section.then(s => {
                          if (s === null) return $emptySection('Connect your wallet to redeem.')
                          const fundRow = s.fundRow
                          if (fundRow === undefined) return $emptySection('Allocate your first round to open your fund.')
                          if (s.legs.length === 0) return $guidedExit
                          const known = localReader.select(holdingTable, { where: { master: s.master }, orderBy: { col: 'shares', dir: 'desc' } })
                          const fresh = client.select(holdingTable, { where: { master: s.master }, orderBy: { col: 'shares', dir: 'desc' } })
                          return $RedeemEditor({
                            master: s.master,
                            owner: valuationOwner,
                            signed: keys !== null && keys.grantedChains(wallet.address).length > 0,
                            hideBalances,
                            fundRow,
                            holdings: s.legs,
                            holders: localFirst(() => known, () => fresh),
                            fundState: fromChain('the latest block', HUB_CHAIN_ID, clientOf(clientDeps, HUB_CHAIN_ID).getBlockNumber()).then(async block => {
                              const [fund, holdings] = await Promise.all([readFundState(clientDeps, fundRow, block), fresh])
                              return { fund, holdings }
                            }),
                            drafts: draftTradeList
                          })({ changeTradeDraft: changeTradeDraftTether(), moveToHub: moveToHubTether(), enableSession: enableSessionTether() })
                        })
                      )
                    }),
                  sampleMap((section: Promise<IFundSection | null>) => section, fundQuery, popRedeem)
                ),
                dismiss: merge(op(changeTradeDraft, delay(0)), op(moveToHub, delay(0)), popTrade, enableSession)
              })({})
              const $tradingView = (view: IHoldingsView): I$Node => {
                const s = view.s
                if (s === null) return $emptySection('Link a dApp and trade what your fund holds.')
                const escrowed =
                  s.surplus.length === 0
                    ? []
                    : [
                        $column(spacing.tiny)(...s.surplus.map(row => $EscrowedRow({ hideBalances, viewOnly, ...row })({ fundRound: changeTradeDraftTether(), escrowReturn: changeTradeDraftTether() })))
                      ]
                if (s.fundRow === undefined) {
                  return escrowed.length === 0 ? $emptySection('Allocate your first round to open your fund.') : $column(spacing.tiny)(...escrowed)
                }
                const $venues =
                  'error' in view.venues
                    ? switchLatest(map(current => ('error' in current.venues ? $intermediateFailure(current.venues.error, $caption('Venue positions'), false) : empty), shownHoldings))
                    : $venueLegs(s.master, usedVenuesOf(view), view.linked)
                const custody = 'error' in view.venues ? [] : view.venues.open.selfCustody
                const $custody = custody.length === 0 ? [] : [$caption('Valuable ERC-20'), ...custody.map(row => $custodyLeg(s.master, row))]
                const $arriving = switchLatest(
                  map(p => {
                    const drafted = p.list.flatMap(d =>
                      d.kind === 'fundSwap'
                        ? [{ chainId: d.destinationChainId, token: d.outputToken }]
                        : d.kind === 'operateSwap'
                          ? d.bridge === null
                            ? [{ chainId: d.chainId, token: d.outputToken }]
                            : [{ chainId: d.bridge.destinationChainId, token: d.bridge.outputToken }]
                        : d.kind === 'allocate'
                          ? [{ chainId: d.escrowChainId, token: providerToken(d.escrowToken, d.escrowChainId) }]
                          : d.kind === 'venueWithdraw'
                            ? [{ chainId: venueWithdrawOf(d.venueId).withdraw.chainId, token: venueWithdrawOf(d.venueId).withdraw.token }]
                            : d.kind === 'redeem' && d.leg !== null
                              ? [{ chainId: HUB_CHAIN_ID as ChainId, token: !isAddressEqual(d.token, HUB_CANONICAL_TOKEN.WETH) || d.leg.chainId === HUB_CHAIN_ID ? d.token : PROTOCOL.nativeToken }]
                              : []
                    )
                    const staked = p.raise !== null && puppetInflow(p.raise, HUB_CHAIN_ID as ChainId, p.raise.token) > 0n ? [{ chainId: HUB_CHAIN_ID as ChainId, token: p.raise.token }] : []
                    const targets = [...drafted, ...staked].filter(
                      (target, i, all) =>
                        !s.legs.some(leg => leg.chainId === target.chainId && isAddressEqual(leg.token, target.token)) &&
                        all.findIndex(other => other.chainId === target.chainId && isAddressEqual(other.token, target.token)) === i &&
                        deltaOf({ ...p, legs: s.legs }, target.chainId, target.token) > 0n
                    )
                    return $column(spacing.tiny)(
                      ...targets.map(t =>
                        $row(spacing.default, style({ alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${SEPARATOR_COLOR}` }))(
                          $node(style({ flex: 1, minWidth: '160px' }))($tokenProfile(t.chainId, t.token)),
                          $fundBalanceAmount(t.chainId, t.token, just(0n))
                        )
                      )
                    )
                  }, combine({ list: draftTradeList, raise: raiseAfter }))
                )
                if (s.legs.length === 0)
                  return $column(spacing.tiny)(
                    ...(escrowed.length + custody.length === 0 ? [$emptySection('Fund balances on every chain appear here.')] : [...escrowed, ...$custody]),
                    $arriving,
                    $venues
                  )
                return $column(spacing.tiny)(...s.legs.map(leg => $fundLeg(s.master, leg.chainId, leg.token)), $arriving, ...$custody, ...escrowed, $venues)
              }
              const $holdings = $column(spacing.tiny)(
                switchLatest(
                  start(
                    empty,
                    merge(
                      op(
                        shownHoldings,
                        skipRepeatsWith((a, b) => holdingsShapeOf(a) === holdingsShapeOf(b)),
                        map(view => $tradingView(view))
                      ),
                      op(
                        holdingsState,
                        until(shownHoldings),
                        map(st => (st.status === PromiseStatus.ERROR ? $intermediateFailure(st.error, $text('-'), false) : null)),
                        filterNull
                      )
                    )
                  )
                ),
              )
              const holdersShown = op(
                combine({ holders: op(fundHoldersQuery, intermediateState), worth: op(distributionWorth, intermediateState) }),
                map(q => {
                  if (q.holders.status === PromiseStatus.ERROR) return { error: q.holders.error }
                  if (q.worth.status === PromiseStatus.ERROR) return { error: q.worth.error }
                  if (q.holders.status === PromiseStatus.PENDING || q.worth.status === PromiseStatus.PENDING) return null
                  return { shown: q.holders.value, worth: q.worth.value }
                }),
                filterNull,
                skipRepeatsWith(
                  (a, b) =>
                    JSON.stringify('error' in a ? formatThrownError(a.error) : [a.shown === null ? null : [a.shown.holdings, a.shown.balances, a.shown.prices, [...a.shown.wallets], a.shown.fundRow], a.worth], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)) ===
                    JSON.stringify('error' in b ? formatThrownError(b.error) : [b.shown === null ? null : [b.shown.holdings, b.shown.balances, b.shown.prices, [...b.shown.wallets], b.shown.fundRow], b.worth], (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
                ),
                state()
              )
              const raisableShown = op(
                combine({ holders: op(fundHoldersQuery, intermediateState), cost: op(relayCostQuery, intermediateState) }),
                map(q => {
                  if (q.cost.status === PromiseStatus.ERROR) return { error: q.cost.error }
                  if (q.holders.status !== PromiseStatus.DONE || q.cost.status === PromiseStatus.PENDING) return null
                  const shown = q.holders.value
                  if (shown === null) return { raisable: null }
                  const costs = q.cost.value
                  try {
                    return { raisable: raisableGroupsOf(shown.fundRow, shown.book, shown.wallets, shown.balances, shown.prices.map((quote, i) => ({ ...quote, reserve: costs.reserves[i]! })), costs.feeCeiling) }
                  } catch (error) {
                    return { error }
                  }
                }),
                filterNull,
                skipRepeatsWith(
                  (a, b) =>
                    JSON.stringify('error' in a ? formatThrownError(a.error) : a.raisable === null ? null : [a.raisable.redeeming, a.raisable.groups, a.raisable.ended], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)) ===
                    JSON.stringify('error' in b ? formatThrownError(b.error) : b.raisable === null ? null : [b.raisable.redeeming, b.raisable.groups, b.raisable.ended], (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
                ),
                state()
              )
              const $holderList = $column(style({ gap: '32px' }))(
                switchLatest(
                  start(
                    empty,
                    merge(
                      op(
                        holdersShown,
                        map(v => ('error' in v ? null : v)),
                        filterNull,
                        skipRepeatsWith(
                          (a, b) =>
                            JSON.stringify([a.shown === null ? null : [a.shown.holdings, a.shown.balances, [...a.shown.wallets], a.shown.fundRow, a.shown.book], a.worth === null], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)) ===
                            JSON.stringify([b.shown === null ? null : [b.shown.holdings, b.shown.balances, [...b.shown.wallets], b.shown.fundRow, b.shown.book], b.worth === null], (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
                        ),
                        map(v => {
                          if (v.shown === null) return $emptySection('You and the puppets who join a round appear here with your shares.')
                          const shown = v.shown
                          return $fundHolders(
                            hideBalances,
                            shown.fundRow.master,
                            shown.wallets,
                            shown.fundRow,
                            shown.holdings,
                            shown.book,
                            shown.balances,
                            op(
                              holdersShown,
                              map(next => ('error' in next || next.shown === null ? null : next.shown.prices)),
                              filterNull
                            ),
                            v.worth === null
                              ? null
                              : {
                                  wei: op(
                                    holdersShown,
                                    map(next => ('error' in next || next.worth === null ? null : next.worth.wei)),
                                    filterNull
                                  ),
                                  price: op(
                                    holdersShown,
                                    map(next => ('error' in next ? Promise.reject(next.error) : next.worth === null ? null : Promise.resolve(next.worth.price))),
                                    filterNull
                                  )
                                },
                            redeemPlan,
                            raiseAfter
                          )
                        })
                      ),
                      op(
                        holdersShown,
                        until(op(holdersShown, filter(v => !('error' in v)))),
                        map(v => ('error' in v ? $intermediateFailure(v.error, $text('-'), false) : null)),
                        filterNull
                      )
                    )
                  )
                ),
                switchLatest(
                  start(
                    empty,
                    merge(
                      op(
                        raisableShown,
                        until(op(raisableShown, filter(v => !('error' in v)))),
                        map(v => ('error' in v ? $intermediateFailure(v.error, $text('-'), false) : null)),
                        filterNull
                      ),
                      op(
                        raisableShown,
                        map(v => ('error' in v ? null : v)),
                        filterNull,
                        map(v => {
                          if (v.raisable === null) return empty
                          return $fundRaisable(hideBalances, v.raisable, op(raisableShown, map(next => ('error' in next ? { error: next.error } : null))), (token, amount, $rowOf) => {
                            const fund = p.fund
                            return fund === null || 'unknown' in fund
                              ? $rowOf(empty)
                              : $allocateOver(
                                  fund,
                                  $rowOf(
                                    $ButtonSecondary({
                                      $container: $defaultMiniButtonSecondary,
                                      disabled: viewOnly,
                                      $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Allocate'), $popoverCaret())
                                    })({ click: popRaiseTether(map(() => token)) })
                                  ),
                                  op(
                                    popRaise,
                                    filter(picked => isAddressEqual(picked, token))
                                  ),
                                  { chainId: HUB_CHAIN_ID as ChainId, token, amount }
                                )
                          })
                        })
                      )
                    )
                  )
                )
              )
              return {
                pending: false,
                fund: recorded,
                $body: $column(style({ gap: isDesktopScreen ? '40px' : '28px', padding: '0 0 4px' }))(
                  $contractWarning,
                  role === 'puppet' || p.fund === null
                    ? empty
                    : switchLatest(
                    map(
                      p =>
                        p.view
                          ? $alertIntermediateContainer(style({ borderRadius: '12px', alignSelf: 'center', flexWrap: 'wrap', justifyContent: 'center' }))(
                          $icon({ $content: $alertIcon, viewBox: '0 0 24 24', width: '18px', svgOps: style({ minWidth: '18px' }) }),
                          $node(style({ fontSize: text.sm, color: palette.message }))($text('View only, sign to proceed')),
                          $infoTooltip("Your fund's key is not on this device. Sign with your wallet to restore it.", palette.foreground),
                          $ButtonPrimary({
                            $container: $defaultMiniButtonPrimary,
                            $content: $text('Sign session')
                          })({ click: enableSessionTether() })
                        )
                          : p.live
                            ? empty
                            : $alertInfo(
                                $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                                  $node(style({ fontSize: text.sm, color: palette.message }))($text('No session on this device')),
                                  $infoTooltip(
                                    'Your wallet signs one session that lets this device act for your account for 7 days. Until then nothing here can be submitted, and live values such as venue positions are not refreshed.',
                                    palette.foreground
                                  ),
                                  $ButtonSecondary({
                                    $container: $defaultMiniButtonSecondary,
                                    $content: $text('Sign session')
                                  })({ click: enableSessionTether() })
                                )
                              ),
                      combine({ view: viewOnly, live: agent.session })
                    )
                  ),
                  $sectionList(
                    role === 'puppet'
                      ? $section(
                          $allocationHeader(root.account, allocationFailure, switchLatest(map(blank => (blank ? empty : $depositPopover), pristine))),
                          $column(spacing.default)($exitStrip, $depositList, switchLatest(map(blank => (blank ? $emptySection(NO_ACTIVITY, $depositPopover) : $allocationList), pristine)))
                        )
                      : p.fund === null
                      ? $section($sectionHeader($heading3($text('Fund')), 'Name your fund, then make its first allocation to open it.'), $createFund(root, wallet))
                      : 'unknown' in p.fund
                      ? $section($sectionHeader($heading3($text('Fund')), null), $emptySection(p.fund.unknown))
                      : $fundGrid(
                          $section($holdings),
                          $section(
                            $sectionHeader(
                              $heading3($text('Distribution')),
                              "Who holds your fund's shares, at the fund's value after its last round or redeem.",
                              $row(spacing.small, style({ alignItems: 'center' }))(
                                $allocateOver(
                                  p.fund,
                                  $ButtonPrimary({
                                    $container: $defaultMiniButtonPrimary,
                                    disabled: viewOnly,
                                    $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Allocate'), $popoverCaret())
                                  })({ click: popAllocateTether() }),
                                  popAllocate,
                                  null
                                ),
                                $redeemOver
                              )
                            ),
                            $holderList
                          )
                        ),
                    $AccountHistory(historyQuery, $historyHeader(role), $emptyHistory(role))({})
                  )
                )
              }
            },
            skipRepeatsWith(
              (x: ISectionState, y: ISectionState) => {
                if (y.kind === 'pending') return x.kind !== 'error'
                if (x.kind !== 'params' || y.kind !== 'params') return false
                const a = x.params
                const b = y.params
                return (
                  a.wallet?.address === b.wallet?.address &&
                  a.root?.account === b.root?.account &&
                  (a.fund === b.fund || (a.fund !== null && b.fund !== null && 'account' in a.fund && 'account' in b.fund && a.fund.account === b.fund.account)) &&
                  (a.root?.deployed.size ?? 0) === (b.root?.deployed.size ?? 0) &&
                  heldKey(a.root) === heldKey(b.root)
                )
              },
              op(
                sectionQuery,
                intermediateState,
                map((s): ISectionState => {
                  if (s.status === PromiseStatus.PENDING) return { kind: 'pending' }
                  return s.status === PromiseStatus.ERROR ? { kind: 'error', error: s.error } : { kind: 'params', params: s.value }
                })
              )
            )
          )
        )
      )
      const fundViewOnly: IStream<boolean> = op(
        combine({ view: sectionView, pair: walletPair, root: walletRoot }),
        map(p => {
          const wallet = p.pair.wallet
          const keys = p.pair.keys
          return role === 'master' && p.view.fund !== null && (wallet === null || keys === null || keys.fundSignerOf(wallet.address, p.view.fund.account) === null)
        }),
        skipRepeats,
        state()
      )
      const shownFund = op(
        sectionView,
        map(view => view.fund),
        skipRepeats
      )
      const $actionSlot = ($control: I$Node): I$Node =>
        $node(
          style({ display: 'contents' }),
          attrBehavior(map(blocked => ({ inert: blocked ? '' : null }), fundViewOnly))
        )($control)

      const $timeline = $card2(
        style({
          padding: 0,
          height: '200px',
          position: 'relative',
          overflow: 'hidden',
          margin: isDesktopScreen ? '-28px -28px 0' : '-12px -12px 0',
          boxShadow: 'none'
        })
      )($ValueTimeline({
        hideBalances,
        timelineQuery,
        events: role === 'puppet' ? undefined : map(view => view.then(each => each.allocations), masterView),
        axis: 'hover',
        $note: switchLatest(
          op(
            combine({ note: op(masterNote, intermediateState), pair: walletPair }),
            map(p => {
              if (p.note.status === PromiseStatus.PENDING) return null
              if (p.note.status === PromiseStatus.ERROR) return empty
              const note = p.note.value
              if (note === null) return empty
              const signed = p.pair.wallet !== null && p.pair.keys !== null && p.pair.keys.sessionOf(p.pair.wallet.address, HUB_CHAIN_ID) !== null
              return $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
                $text(signed ? 'Live value unavailable' : 'Holdings not read yet'),
                $infoTooltip(note, palette.foreground),
                ...(signed
                  ? []
                  : [
                      $ButtonSecondary({
                        $container: $defaultMiniButtonSecondary,
                        $content: $text('Enable session')
                      })({ click: enableSessionTether() })
                    ])
              )
            }),
            filterNull
          )
        ),
        format: map(metric => (metric === 'pnl' ? 'usd' : 'percent'), performanceMetric),
        label: switchLatest(
          map(
            metric =>
              metric !== 'pnl'
                ? just('ROI')
                : role === 'puppet'
                  ? just('Account value')
                  : op(
                      masterView,
                      switchMap(async view => {
                        const { worth } = await view
                        return worth === null ? '-' : `${readableTokenAmount(TOKEN_META.WETH.decimals, worth.wei)} ETH`
                      }),
                      map(amount => maskBalance(amount, hideBalances)),
                      switchLatest
                    ),
            performanceMetric
          )
        ),
        $tip: switchLatest(
          map(
            metric =>
              metric !== 'pnl'
                ? $infoTooltip(
                    role === 'puppet'
                      ? 'What your allocations gained over the timeframe, as a percent of what you put in.'
                      : "How the fund's Performance Index moved over the timeframe. The index is fund value per 1.00 invested, in ETH after the master's fee, and new money joins at 1.00.",
                    palette.foreground
                  )
                : role === 'puppet'
                  ? $infoTooltip('Your balances plus your allocations over time. The last point is live.', palette.foreground)
                  : $intermediatePromise({
                      $loader: $sectionTip(FUND_TIP, colorShade(palette.foreground, 60)),
                      $display: map(
                        p =>
                          p.positions.then(
                            open =>
                              open === null
                                ? $sectionTip(FUND_TIP, colorShade(palette.foreground, 60))
                                : $syncTip(
                                    FUND_TIP,
                                    open,
                                    p.pair.wallet !== null && p.pair.keys !== null && p.pair.keys.sessionOf(p.pair.wallet.address, HUB_CHAIN_ID) !== null ? OWNER_SYNC_SCHEDULE_SEC : TICK_SYNC_SCHEDULE_SEC
                                  ),
                            () => $sectionTip(FUND_TIP, colorShade(palette.foreground, 60))
                          ),
                        combine({ positions: positionsQuery, pair: walletPair })
                      )
                    }),
            performanceMetric
          )
        ),
        activityTimeframe,
        under: palette.background,
        metric: { value: performanceMetric, labels: { pnl: 'Value', performance: 'ROI' } },
        ...(role === 'master'
          ? {
              $lead: $row(style({ flex: 1, alignItems: 'center' }))(
                $AccountMenu({ hideBalances, walletPair, fund: shownFund })({ changeHideBalances: changeHideBalancesTether(), walletIntent: walletIntentTether() })
              ),
              $footer: $node(style({ display: 'grid', gridTemplateColumns: '1fr auto auto 1fr', alignItems: 'center', columnGap: '8px' }))(
                switchLatest(
                  map(
                    p =>
                      p.view.pending || p.funds === null
                        ? empty
                        : $node(style({ gridColumn: '2', gridRow: '1', position: 'relative', zIndex: 1, display: 'flex' }))(
                            $FundMenu({
                              identity: p.view.fund === null ? combine({ symbol: typedSymbol, cells: chosenCells }) : just({ symbol: p.view.fund.symbol, cells: p.view.fund.cells }),
                              activeAccount: p.view.fund === null ? null : p.view.fund.account,
                              funds: p.funds
                            })({ pick: pickFundTether(), create: startFundTether() })
                          ),
                    combine({
                      view: sectionView,
                      funds: op(
                        walletRoot,
                        map(root => (root === null ? null : root.funds)),
                        skipRepeats
                      )
                    })
                  )
                ),
                switchLatest(
                  map(
                    pending =>
                      pending
                        ? empty
                        : $actionSlot(
                            $WalletLink({
                              walletPair,
                              shownPair,
                              walletControl,
                              agent,
                              account: op(
                                sectionView,
                                map(view => (view.fund === null ? null : view.fund.account)),
                                skipRepeats
                              ),
                              $control: $node(
                                style({ gridColumn: '3', gridRow: '1', position: 'relative', zIndex: 1, display: 'flex' }),
                                styleBehavior(map(blocked => (blocked ? { opacity: '0.4' } : null), fundViewOnly))
                              ),
                              $anchorArea: $node(style({ gridColumn: '2 / 4', gridRow: '1', alignSelf: 'stretch', display: 'flex' }))
                            })({
                              command: agentCommandTether(),
                              enableSession: enableSessionTether(),
                              addIdentity: addAgentTether(),
                              changeIdentities: changeAgentIdentitiesTether(),
                              revoke: changeRevokeDraftTether(),
                              walletIntent: walletIntentTether()
                            })
                          ),
                    op(
                      sectionView,
                      map(view => view.pending),
                      skipRepeats
                    )
                  )
                )
              )
            }
          : {})
      })({ changeActivityTimeframe: changeActivityTimeframeTether(), changePerformanceMetric: changePerformanceMetricTether() }))

      return [
        $column(spacing.default)(
          ...(role === 'puppet'
            ? [
                $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
                  $Link({ route: routeSchema.traders, $anchor: $defaultAnchor(style({ color: palette.foreground })), $content: $text('Funds') })({}),
                  $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
                  $node(style({ color: palette.message }))($text('Account')),
                  $node(style({ flex: 1 }))(),
                  $AccountMenu({ hideBalances, walletPair, fund: shownFund })({ changeHideBalances: changeHideBalancesTether(), walletIntent: walletIntentTether() })
                )
              ]
            : []),
          $card(style({ flex: 1, width: '100%', gap: role === 'puppet' ? '0' : isDesktopScreen ? '40px' : '28px', ...(role === 'master' ? (isDesktopScreen ? { boxShadow: 'none', border: `1px solid ${colorShade(palette.foreground, 15)}`, borderRadius: '16px', overflow: 'hidden' } : { boxShadow: 'none', borderRadius: '0' }) : {}) }))(
            $timeline,
            switchLatest(map(view => view.$body, sectionView))
          )
        ),
        {
          changeActivityTimeframe,
          changePerformanceMetric,
          changeHideBalances,
          agentCommand,
          addAgent,
          changeAgentIdentities,
          changeRevokeDraft: merge(changeRevokeDraft, revokeAgain),
          enableSession,
          changeDraft: merge(changeDraft, fundAllocate, openingRound, map(p => p.d, roundSaved)),
          changeMandateDraft,
          releaseDraft: releaseTradeDraft,
          settled: op(
            sampleMap((pair: IWalletPair, fund: IFund) => ({ pair, fund }), walletPair, pickFund),
            tap(p => {
              if (p.pair.wallet === null || p.pair.keys === null) throw new Error('a fund was picked with no wallet or key store connected')
              p.pair.keys.selectFund(p.pair.wallet.address, p.fund.account)
            }),
            constant([] as readonly ISettledTx[])
          ),
          changeTradeDraft: merge(
            changeTradeDraft,
            rowDraft,
            map((d): ITradeDraft => ({ kind: 'allocate', id: 'allocate', escrowChainId: Number(d.deposit.destinationChainId) as ChainId, escrowToken: d.deposit.outputToken, contribution: d.expectedOutput, puppets: 0n, identity: null }), fundAllocate),
            map((p): ITradeDraft => ({ kind: 'allocate', id: 'allocate', escrowChainId: Number(p.d.deposit.destinationChainId) as ChainId, escrowToken: p.d.deposit.outputToken, contribution: p.d.expectedOutput, puppets: p.puppets, identity: null }), roundSaved),
            map((d): ITradeDraft => ({ kind: 'allocate', id: 'allocate', escrowChainId: Number(d.deposit.destinationChainId) as ChainId, escrowToken: d.deposit.outputToken, contribution: d.expectedOutput, puppets: 0n, identity: d.identity ?? null }), openingRound)
          ),
          walletIntent
        }
      ]
    }
  )
