import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { fundSymbolOf, gridOf, predictUserAccount } from '@puppet/sdk/account'
import type { ChainId, IntervalTime } from '@puppet/sdk/const'
import {
  getDuration,
  getTokenDescription,
  getUnixTimestamp,
  readableDate,
  readablePercentage,
  readableTokenAmountLabel
} from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { minFundedAmount } from '@puppet/sdk/mpc'
import { cashFor } from '@puppet/sdk/pool'
import type { IFundRow, IMandateRow, IQueueRow, IValuationRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey, type ITokenRegistryMap, registeredTokenAddresses } from '@puppet/sdk/state'
import { robotCellsOf } from '@puppet/sdk/ui-components'
import { GMX_TOKEN_SPENDER, GMX_V2_CHAIN_ID, type IGmxPositionRow } from '@puppet/sdk/venue'
import {
  combine,
  empty,
  filter,
  filterNull,
  type IStream,
  just,
  map,
  merge,
  op,
  reduce,
  sampleMap,
  skipRepeats,
  skipRepeatsWith,
  start,
  switchLatest
} from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, encodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $arrowRight,
  $ButtonPrimary,
  $ButtonSecondary,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $errorCard,
  $icon,
  $infoTooltip,
  $intermediatePromise,
  $popoverCaret,
  $sectionLoader,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { $tokenProfile } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2 } from '../common/elements/$common.js'
import { $AccountMenu } from '../components/$AccountMenu.js'
import { $addressLink, $fundProfile } from '../components/$AccountProfile.js'
import { $performanceCell } from '../components/$PerformanceMetric.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $ValueTimeline } from '../components/participant/$ValueTimeline.js'
import { $AccountHistory } from '../components/portfolio/$AccountHistory.js'
import { $AllocationSimulation } from '../components/portfolio/$AllocationSimulation.js'
import { $DepositEditor } from '../components/portfolio/$DepositEditor.js'
import { $EscrowedRow } from '../components/portfolio/$EscrowedRow.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import { $FundSwapEditor, $RedeemEditor, $SellEditor } from '../components/portfolio/$TradeEditors.js'
import {
  depositArrivalToken,
  type IArrival,
  type IDepositDraft,
  type IEditorDraft,
  type IFundSwapDraft,
  type IMandateDraft,
  type IRedeemDraft,
  type ISellDraft,
  type ITradeDraft,
  type IWithdrawDraft
} from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import context from '../io/context.js'
import { escrowSurplus, type IHoldingView } from '../io/datastore/own.js'
import { type ITimelinePoint, type ITraderPerformance, traderPerformance, traderPositions } from '../io/datastore/traders.js'
import { flatTimeline, walletTimeline } from '../io/datastore/walletTimeline.js'
import type { IAccountAction } from '../io/journal/history.js'
import type { IOwnState } from '../io/journal/localFold.js'
import { readTokenAllowance, readTokenBalance } from '../io/onchain/account.js'
import { formatUsd, priceFor } from '../io/price.js'
import { balanceAt, type IConnectedWallet, type IFund, type IRootState, type IWalletKeys, type IWalletPair } from '../wallet/index.js'
import { $OpenPositions, type IShownValuation, markOf } from './$OpenPositions.js'
import { $headerFigure, $headerStub } from './common.js'
import type { IPageFilterParams } from './types.js'

const $section = $column(spacing.small)
const $sectionList = $column(style({ gap: isDesktopScreen ? '48px' : '34px' }))
const value = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))
const bond = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))
const UNBOUNDED_ALLOWANCE = 2n ** 128n - 1n
const REVOKE_GAS_LIMIT = 100_000n

const $sectionTip = (tooltip: string | I$Node): I$Node =>
  $infoTooltip(
    $node(style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm }))(typeof tooltip === 'string' ? $text(tooltip) : tooltip),
    colorShade(palette.foreground, 60))

const $emptySection = (detail: string, $cta?: I$Node): I$Node =>
  $row(spacing.small, style({ alignItems: 'baseline', flexWrap: 'wrap', padding: '4px 0', color: palette.foreground, fontSize: text.sm }))(
    $node($text(detail)),
    ...($cta ? [$cta] : [])
  )

const $sectionHeader = ($title: I$Node, tooltip: string | I$Node | null, $trailing?: I$Node): I$Node =>
  $row(
    spacing.small,
    style({
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '44px',
      flexShrink: 0,
      borderBottom: `1px solid ${colorShade(palette.foreground, 15)}`
    })
  )(
    tooltip === null ? $title : $row(spacing.small, style({ alignItems: 'center' }))($title, $sectionTip(tooltip)),
    $trailing ?? empty
  )

interface I$Portfolio extends IPageFilterParams {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  walletRoot: IStream<IRootState | null>
  historyQuery: IStream<Promise<IAccountAction[]>>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  holdingsQuery: IStream<Promise<IHoldingView[]>>
  walletValueQuery: IStream<Promise<number | null>>
  mandatesQuery: IStream<Promise<IMandateRow[]>>
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  draftMandateList: IStream<IMandateDraft[]>
  draftTradeList: IStream<ITradeDraft[]>
}

export const $Portfolio = ({
  hideBalances,
  walletPair,
  walletRoot,
  historyQuery,
  ownStateQuery,
  holdingsQuery,
  walletValueQuery,
  mandatesQuery,
  draftDepositList,
  draftWithdrawList,
  draftMandateList,
  draftTradeList
}: I$Portfolio) =>
  component(
    (
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<IntervalTime>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMandateDraft, changeMandateDraftTether]: IBehavior<IMandateDraft>,
      [toggleMandate, toggleMandateTether]: IBehavior<PointerEvent, Address>,
      [changeTradeDraft, changeTradeDraftTether]: IBehavior<ITradeDraft>,
      [revokeAllowance, revokeAllowanceTether]: IBehavior<PointerEvent, ITradeDraft>,
      [popTrade, popTradeTether]: IBehavior<PointerEvent, string>,
      [popDeposit, popDepositTether]: IBehavior<PointerEvent>,
      [popAllocate, popAllocateTether]: IBehavior<PointerEvent>,
      [fundAllocate, fundAllocateTether]: IBehavior<IDepositDraft>,
      [fundRound, fundRoundTether]: IBehavior<IDepositDraft>,
      [arrival, arrivalTether]: IBehavior<IArrival>,
      [roundBackers, roundBackersTether]: IBehavior<bigint | null>
    ) => {

      interface ISectionParams {
        root: IRootState | null
        registry: ITokenRegistryMap
        wallet: IConnectedWallet | null
        fund: IFund | null
        keys: IWalletKeys | null
      }
      type ISectionState = { kind: 'params'; params: ISectionParams } | { kind: 'error'; error: unknown } | { kind: 'pending' }
      const heldKey = (root: IRootState | null): string =>
        root ? root.balances.filter(b => b.balance > 0n).map(b => `${b.chainId}:${b.token}`).sort().join(',') : ''

      const activityTimeframe: IStream<IntervalTime> = op(
        uiStorage.replayWrite(localStoreSchema.global.activityTimeframe, changeActivityTimeframe),
        state()
      )
      const pointsQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ root: walletRoot, tf: activityTimeframe }),
        map(async p => {
          const until = getUnixTimestamp()
          return p.root === null ? flatTimeline(until - p.tf, until) : walletTimeline([p.root.user], until - p.tf, until)
        }),
        state()
      )
      const timelineQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ points: pointsQuery, live: walletValueQuery }),
        map(async p => {
          const [points, live] = await Promise.all([p.points, p.live])
          return live === null ? points : [...points.slice(0, -1), { time: points[points.length - 1]!.time, value: live }]
        }),
        state()
      )
      const $identity = $node(style({ color: palette.message }))($text('Account'))
      const $timeline = $card2(
        style({
          padding: 0,
          height: '200px',
          position: 'relative',
          overflow: 'hidden',
          margin: isDesktopScreen ? '-28px -28px 0' : '-12px -12px 0'
        })
      )($ValueTimeline({
        hideBalances,
        timelineQuery,
        unit: '$',
        label: 'Total value',
        tooltip:
          'Your account and fund over time. Each move counts at its value when it landed; the last point is live at the latest valuation.',
        activityTimeframe
      })({ changeActivityTimeframe: changeActivityTimeframeTether() }))

      const sectionQuery: IStream<Promise<ISectionParams>> = op(
        walletPair,
        map(async pair => {
          const [registry, root] = await Promise.all([context.getTokenRegistry(), pair.root])
          return { wallet: pair.wallet, root, registry, fund: root === null ? null : root.fund, keys: pair.keys }
        }),
        state()
      )

      const $historyHeader = ($trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3($text('History')),
          'Everything your account and fund did on chain: deposits, withdrawals, swaps, mandates, rounds, sells, redemptions and trades.',
          $trailing
        )
      const $backingHeader = (account: Address | null, $trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3($text('Backing')),
          $column(spacing.small)(
            $text(
              `Your account. Deposits stay yours to withdraw. ${bond.symbol} on the hub backs the traders you mandate: each round takes your allowed share and gives you units in their fund. Sell queues units for payout. Other chains back nothing until moved to the hub.`
            ),
            ...(account === null
              ? []
              : [$row(spacing.small, style({ alignItems: 'center' }))($node(style({ color: palette.foreground }))($text('Account')), $addressLink(account))])
          ),
          $trailing
        )
      const $emptyHistory = $emptySection('Every settled action of your account lands here.')
      const draftedCredits: IStream<{ chainId: ChainId; token: Hex; amount: bigint }[]> = op(
        draftDepositList,
        map(list =>
          list
            .filter(d => d.expectedOutput > 0n)
            .map(d => ({ chainId: Number(d.deposit.destinationChainId) as ChainId, token: depositArrivalToken(d), amount: d.expectedOutput }))
        ),
        skipRepeatsWith((a, b) => a.map(r => `${r.chainId}:${r.token}:${r.amount}`).join() === b.map(r => `${r.chainId}:${r.token}:${r.amount}`).join())
      )
      const $draftedCreditRow = (row: { chainId: ChainId; token: Hex; amount: bigint }): I$Node => {
        const description = getTokenDescription(row.chainId, row.token)
        return $row(
          spacing.default,
          style({ alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` })
        )(
          $tokenProfile(row.chainId, row.token, 32, row.chainId !== HUB_CHAIN_ID),
          $node(style({ flex: 1 }))(),
          switchLatest(
            map(
              price =>
                $amountDisplay({
                  hideBalances,
                  usd: just(formatUsd(0n, price)),
                  amount: readableTokenAmountLabel(description, 0n),
                  change: just({ usd: formatUsd(row.amount, price), amount: readableTokenAmountLabel(description, row.amount) }),
                  color: just(palette.positive),
                  align: 'flex-end'
                }),
              priceFor(row.chainId, row.token)
            )
          )
        )
      }
      const $openFundLink: I$Node = $Link({
        route: routeSchema.quickstart,
        $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline', whiteSpace: 'nowrap' })),
        $content: $text('Create your fund')
      })({})
      const $allocateButton = $ButtonPrimary({
        $container: $defaultMiniButtonPrimary,
        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Allocate'), $popoverCaret())
      })({ click: popAllocateTether() })
      const $headerPopoverContainer = $node(style({ display: 'flex', flexDirection: 'column' }))
      const $browseTraders = $emptySection(
        'Back a trader with your deposit.',
        $Link({
          route: routeSchema.traders,
          $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' })),
          $content: $text('Browse traders')
        })({})
      )
      const $onboardingShell = (account: Address | null, $depositAction: I$Node): I$Node =>
        $column(style({ gap: isDesktopScreen ? '40px' : '28px', padding: '0 0 4px' }))(
          $sectionList(
            $section(
              $backingHeader(account, $depositAction),
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
                $browseTraders
              )
            ),
            $section(
              $sectionHeader($heading3($text('Fund')), null, $openFundLink),
              $emptySection(
                'Your fund trades on its own key, separate from this account.',
                $Link({
                  route: routeSchema.quickstart,
                  $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' })),
                  $content: $text('Create your fund')
                })({})
              )
            ),
            $section($historyHeader(), $emptyHistory)
          )
        )

      interface IFundLeg {
        chainId: ChainId
        token: Address
        fundBalance: bigint
        allowance: bigint
      }
      interface IFundSection {
        master: Address
        fundRow: IFundRow | undefined
        queue: IQueueRow | undefined
        units: bigint
        legs: IFundLeg[]
        surplus: ReturnType<typeof escrowSurplus>
      }
      const fundAccount: IStream<Address | null> = op(
        walletRoot,
        map(root => (root === null || root.fund === null ? null : root.fund.account)),
        skipRepeats,
        state()
      )
      const fundQuery: IStream<Promise<IFundSection | null>> = op(
        combine({ own: ownStateQuery, master: fundAccount }),
        map(async (q): Promise<IFundSection | null> => {
          const [own, registry] = await Promise.all([q.own, context.getTokenRegistry()])
          const master = q.master
          if (own === null || master === null) return null
          const fundRow = own.fundRows.find(row => isAddressEqual(row.master, master))
          const legs = await Promise.all(
            ([...CHAIN_IDS] as ChainId[]).flatMap(chainId =>
              registeredTokenAddresses(registry, chainId).map(async (token): Promise<IFundLeg> => {
                const [fundBalance, allowance] = await Promise.all([
                  readTokenBalance(master, chainId, token, 0),
                  chainId === GMX_V2_CHAIN_ID ? readTokenAllowance(master, chainId, token, GMX_TOKEN_SPENDER, 0) : Promise.resolve(0n)
                ])
                return { chainId, token, fundBalance, allowance }
              })
            )
          )
          const holding = own.holdings.find(row => isAddressEqual(row.master, master) && isAddressEqual(row.holder, master))
          return {
            master,
            fundRow,
            queue: own.queues.find(row => isAddressEqual(row.master, master)),
            units: holding === undefined ? 0n : holding.units,
            legs,
            surplus: escrowSurplus(own, master)
          }
        }),
        state()
      )
      const openValuation: IStream<Promise<IShownValuation | null>> = op(
        combine({ own: ownStateQuery, master: fundAccount }),
        map(async q => {
          const own = await q.own
          const master = q.master
          if (own === null || master === null) return null
          const last = own.valuations
            .filter(row => isAddressEqual(row.master, master))
            .reduce<IValuationRow | undefined>((latest, row) => (latest === undefined || row.block > latest.block || (row.block === latest.block && row.logIndex > latest.logIndex) ? row : latest), undefined)
          return last === undefined ? null : markOf(last, own.fundRows.find(row => isAddressEqual(row.master, master)))
        }),
        state()
      )
      const fundPerformanceQuery: IStream<Promise<{ sinceSec: number; performance: ITraderPerformance } | null>> = op(
        combine({ own: ownStateQuery, master: fundAccount, tf: activityTimeframe }),
        map(async q => {
          const own = await q.own
          const master = q.master
          if (own === null || master === null) return null
          const fundRow = own.fundRows.find(row => isAddressEqual(row.master, master))
          if (fundRow === undefined) return null
          const untilSec = getUnixTimestamp()
          const sinceSec = untilSec - q.tf
          return {
            sinceSec,
            performance: traderPerformance(
              fundRow,
              own.valuations.filter(row => isAddressEqual(row.master, master)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex),
              own.metrics.filter(row => row.interval === q.tf && isAddressEqual(row.master, master)),
              q.tf,
              sinceSec,
              untilSec
            )
          }
        }),
        state()
      )
      const openPositions: IStream<Promise<IGmxPositionRow[]>> = op(
        combine({ own: ownStateQuery, master: fundAccount }),
        map(async q => {
          const own = await q.own
          return own === null || q.master === null ? [] : traderPositions(q.master)
        }),
        state()
      )
      const $sectionSkeleton = $sectionList(
        $section($backingHeader(null), $sectionLoader),
        $section($historyHeader(), $sectionLoader)
      )
      interface IBackingSection {
        masters: Address[]
        mandates: IMandateRow[]
        holdings: IHoldingView[]
      }
      const backingQuery: IStream<Promise<IBackingSection>> = op(
        combine({ holdings: holdingsQuery, mandates: mandatesQuery }),
        map(async q => {
          const [holdings, mandates] = await Promise.all([q.holdings, q.mandates])
          const masters = [...new Set([...mandates.map(m => getAddress(m.master)), ...holdings.map(h => getAddress(h.master))])]
          return { masters, mandates, holdings }
        }),
        state()
      )
      const openMandate: IStream<Address | null> = op(
        toggleMandate,
        reduce((open: Address | null, master: Address) => (open !== null && isAddressEqual(open, master) ? null : master), null),
        state(null)
      )

      return [
        $column(spacing.default)(
          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
            $Link({ route: routeSchema.traders, $anchor: $defaultAnchor(style({ color: palette.foreground, textDecoration: 'underline', textUnderlineOffset: '3px' })), $content: $text('Traders') })({}),
            $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
            $identity,
            $node(style({ flex: 1 }))(),
            $AccountMenu({ hideBalances, walletPair })({ changeHideBalances: changeHideBalancesTether() })
          ),
          $card(spacing.big, style({ flex: 1, width: '100%' }))(
            $timeline,
            switchLatest(
              start(
                $sectionSkeleton,
                map(
                  (s: ISectionState) => {
                    if (s.kind === 'pending') return $sectionSkeleton
                    if (s.kind === 'error') return $errorCard(s.error)
                    const p = s.params
                    if (!p.wallet) {
                      return $onboardingShell(null, $WalletConnect()({}))
                    }
                    const wallet = p.wallet
                    const root = p.root
                    if (root === null) {
                      return $onboardingShell(
                        predictUserAccount(wallet.address),
                        $Popover({
                          $contentContainer: $editorPopoverContentContainer,
                          $target: $ButtonPrimary({
                            $container: $defaultMiniButtonPrimary,
                            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                          })({ click: popDepositTether() }),
                          $open: map(
                            () =>
                              $DepositEditor({
                                label: 'Deposit',
                                hideBalances,
                                tokenRegistry: p.registry,
                                walletAccount: wallet,
                                destination: {
                                  choose: [...(p.registry.get(HUB_CHAIN_ID)?.keys() ?? [])].map(token => ({ chainId: HUB_CHAIN_ID as ChainId, token: token as Hex })),
                                  scope: 'deposit'
                                },
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
                        accountState: puppetAccount,
                        chainId,
                        token,
                        tokenRegistry: p.registry,
                        walletAccount: wallet,
                        draft: map(d => draftFor(d.dep, d.wd, chainId, token), combine({ dep: draftDepositList, wd: draftWithdrawList }))
                      })({ changeDraft: changeDraftTether() })
                    const heldRows: IStream<{ chainId: ChainId; token: Hex }[]> = op(
                      combine({ account: puppetAccount, dep: draftDepositList, wd: draftWithdrawList }),
                      map(q =>
                        [HUB_CHAIN_ID, ...([...CHAIN_IDS] as ChainId[]).filter(c => c !== HUB_CHAIN_ID)].flatMap(chainId =>
                          [...(p.registry.get(chainId)?.keys() ?? [])]
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
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                      })({ click: popDepositTether() }),
                      $open: map(
                        () =>
                          $DepositEditor({
                                label: 'Deposit',
                            hideBalances,
                            tokenRegistry: p.registry,
                            walletAccount: wallet,
                            destination: {
                                  choose: [...(p.registry.get(HUB_CHAIN_ID)?.keys() ?? [])].map(token => ({ chainId: HUB_CHAIN_ID as ChainId, token: token as Hex })),
                                  scope: 'deposit'
                                },
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
                    const $allocateOver = (fund: IFund, $header: I$Node): I$Node => $Popover({
                      $container: $headerPopoverContainer,
                      $contentContainer: $editorPopoverContentContainer,
                      $target: $header,
                      $open: map(
                        (owned: Promise<IOwnState | null>) => {
                          if (root.unreachable.has(HUB_CHAIN_ID as ChainId)) {
                            return $emptySection(`${chainFor(HUB_CHAIN_ID).name} could not be probed for your account; retry once it answers.`)
                          }
                          return $intermediatePromise({
                            $display: just(
                              owned.then(own => {
                                const opened = own?.fundRows.some(row => isAddressEqual(row.master, fund.account))
                                return $DepositEditor({
                                  label: 'Allocate',
                                  $note: $column(spacing.default)(
                                    $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
                                      $text("Allocate opens a round: you and your backers buy units at the fund's value.")
                                    ),
                                    opened ? $AllocationSimulation({ master: fund.account, hideBalances, arrival })({ backers: roundBackersTether() }) : empty
                                  ),
                                  ...(opened ? { gate: map(backers => backers !== null, roundBackers) } : { stakeFloor: minFundedAmount }),
                                  hideBalances,
                                  tokenRegistry: p.registry,
                                  walletAccount: wallet,
                                  destination: {
                                    choose: ([...CHAIN_IDS] as ChainId[]).flatMap(chainId =>
                                      [...(p.registry.get(chainId)?.keys() ?? [])].map(token => ({ chainId, token: token as Hex }))
                                    ),
                                    scope: 'allocate'
                                  },
                                  existingDraft: map(list => list.find(d => d.id === 'deposit') ?? null, draftDepositList)
                                })({ changeDraft: opened ? fundRoundTether() : fundAllocateTether(), arrival: arrivalTether() })
                              })
                            )
                          })
                        },
                        sampleMap((owned: Promise<IOwnState | null>) => owned, ownStateQuery, popAllocate)
                      ),
                      dismiss: merge(fundRound, fundAllocate)
                    })({})
                    const $depositList = switchLatest(
                      map(rows => {
                        if (rows.length === 0) return empty
                        return $column(style({ gap: '0' }))(
                          ...rows.map((r, i) =>
                            $node(style(i === rows.length - 1 ? {} : { borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                              $balanceEditor(r.chainId, r.token)
                            )
                          )
                        )
                      }, heldRows)
                    )
                    const $meta = (label: string): I$Node => $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))
                    const $tradePopover = (key: string, label: string, $editor: () => I$Node): I$Node =>
                      $Popover({
                        $contentContainer: $editorPopoverContentContainer,
                        $target: $ButtonSecondary({
                          $container: $defaultMiniButtonSecondary,
                          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text(label), $popoverCaret())
                        })({ click: popTradeTether(map(() => key)) }),
                        $open: op(
                          popTrade,
                          filter(k => k === key),
                          map(() => $editor())
                        ),
                        dismiss: changeTradeDraft
                      })({})
                    const $mandateRow = (b: IBackingSection, master: Address): I$Node => {
                      const nowSec = getUnixTimestamp()
                      const mandate = b.mandates.find(m => isAddressEqual(m.master, master))
                      const active = mandate !== undefined && mandate.expiry > BigInt(nowSec)
                      const holding = b.holdings.find(h => isAddressEqual(h.master, master))
                      const fundRow = holding !== undefined && holding.standing.kind === 'current' ? holding.standing.fundRow : undefined
                      const draft = op(
                        draftMandateList,
                        map(list => list.find(d => isAddressEqual(d.mandate.master, master)) ?? null)
                      )
                      const sellKey = `sell:${master}`
                      const standing = holding === undefined ? null : holding.standing
                      const $holding =
                        holding === undefined
                          ? [$text('-')]
                          : holding.standing.kind === 'behind'
                            ? [$meta('syncing with the chronicle')]
                            : [
                                $text(readableTokenAmountLabel(value, holding.standing.value)),
                                $node(
                                  style({ color: holding.standing.value >= holding.basis ? palette.positive : palette.negative, fontSize: text.sm })
                                )($text(`${holding.standing.value >= holding.basis ? '+' : ''}${readableTokenAmountLabel(value, holding.standing.value - holding.basis)}`)),
                                ...(holding.standing.queued > 0n ? [$meta(`${readableTokenAmountLabel(value, holding.standing.queuedValue)} queued`)] : []),
                                ...(holding.standing.payout > holding.standing.payoutFee
                                  ? [$meta(`${readableTokenAmountLabel(bond, holding.standing.payout - holding.standing.payoutFee)} paying out`)]
                                  : [])
                              ]
                      return $column(spacing.small, style({ padding: '10px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                        $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                          $node(style({ display: 'flex', flex: 1, minWidth: '160px' }))(
                            $fundProfile(master, fundRow === undefined ? robotCellsOf(master) : gridOf(fundRow), fundRow === undefined ? null : fundSymbolOf(fundRow))
                          ),
                          $column(spacing.tiny, style({ minWidth: '150px' }))(
                            mandate !== undefined && active
                              ? $text(
                                  `${readablePercentage(mandate.allocationRate)} of your deposit per round`
                                )
                              : $meta('Not backing'),
                            ...(mandate !== undefined && active
                              ? [
                                  $meta(
                                    `until ${readableDate(Number(mandate.expiry))}${mandate.cooldownPeriod > 0n ? ` · cooldown ${getDuration(Number(mandate.cooldownPeriod))}` : ''}`
                                  )
                                ]
                              : [])
                          ),
                          $column(spacing.tiny, style({ minWidth: '120px', textAlign: 'right' }))(...$holding),
                          ...(standing !== null && standing.kind === 'current' && holding !== undefined && holding.units > 0n
                            ? [
                                $tradePopover(sellKey, 'Sell', () =>
                                  $SellEditor({
                                    master,
                                    held: holding.units,
                                    fundRow: standing.fundRow,
                                    draft: map(list => list.find((d): d is ISellDraft => d.kind === 'sell' && isAddressEqual(d.master, master)) ?? null, draftTradeList)
                                  })({ changeTradeDraft: changeTradeDraftTether() })
                                )
                              ]
                            : []),
                          $ButtonSecondary({
                            $container: $defaultMiniButtonSecondary,
                            $content: $text(map(open => (open !== null && isAddressEqual(open, master) ? 'Close' : active ? 'Manage' : 'Back'), openMandate))
                          })({ click: toggleMandateTether(map(() => master)) })
                        ),
                        switchLatest(
                          map(
                            open =>
                              open !== null && isAddressEqual(open, master)
                                ? $MandateEditor({ master, existing: mandate, draft, needsDeposit: balanceAt(root.balances, HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)) === 0n })({
                                    changeMandateDraft: changeMandateDraftTether()
                                  })
                                : empty,
                            openMandate
                          )
                        )
                      )
                    }
                    const $backingList = $intermediatePromise({
                      $display: map(async (query: Promise<IBackingSection>) => {
                        const b = await query
                        const masters = b.masters.filter(master => !isAddressEqual(master, puppetAddress))
                        if (masters.length === 0) {
                          return $browseTraders
                        }
                        return $column(spacing.tiny)(...masters.map(m => $mandateRow(b, m)))
                      }, backingQuery)
                    })
                    const fundSwapDelta = (list: ITradeDraft[], chainId: ChainId, token: Address): bigint =>
                      list.reduce(
                        (sum, d) =>
                          d.kind !== 'fundSwap'
                            ? sum
                            : sum +
                              (d.chainId === chainId && isAddressEqual(d.inputToken, token) ? -d.inputAmount : 0n) +
                              (d.destinationChainId === chainId && isAddressEqual(d.outputToken, token) ? d.expectedOutput : 0n),
                        0n
                      )
                    const $fundBalanceAmount = (chainId: ChainId, token: Address, fundBalance: bigint): I$Node => {
                      const description = getTokenDescription(chainId, token)
                      return switchLatest(
                        map(
                          p => {
                            const delta = fundSwapDelta(p.list, chainId, token)
                            return $amountDisplay({
                              hideBalances,
                              usd: just(formatUsd(fundBalance, p.price)),
                              amount: readableTokenAmountLabel(description, fundBalance),
                              change: just(delta === 0n ? null : { usd: formatUsd(fundBalance + delta, p.price), amount: readableTokenAmountLabel(description, fundBalance + delta) }),
                              color: just(delta > 0n ? palette.positive : palette.negative),
                              align: 'flex-end'
                            })
                          },
                          combine({ price: priceFor(chainId, token), list: draftTradeList })
                        )
                      )
                    }
                    const $fundLeg = (s: IFundSection, leg: IFundLeg): I$Node => {
                      const description = getTokenDescription(leg.chainId, leg.token)
                      const swapKey = `fundSwap:${leg.chainId}:${leg.token}`
                      return $column(spacing.small, style({ padding: '8px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                        $row(spacing.default, style({ alignItems: 'center' }))(
                          $tokenProfile(leg.chainId, leg.token),
                          $Popover({
                            $contentContainer: $editorPopoverContentContainer,
                            $target: $ButtonSecondary({
                              $container: $defaultMiniButtonSecondary,
                              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Swap'), $popoverCaret()),
                              disabled: just(leg.fundBalance === 0n)
                            })({ click: popTradeTether(map(() => swapKey)) }),
                            $open: op(
                              popTrade,
                              filter(key => key === swapKey),
                              map(() =>
                                $FundSwapEditor({
                                  account: s.master,
                                  chainId: leg.chainId,
                                  token: leg.token,
                                  fundBalance: leg.fundBalance,
                                  tokenRegistry: p.registry,
                                  draft: map(
                                    list => list.find((d): d is IFundSwapDraft => d.kind === 'fundSwap' && d.id === swapKey) ?? null,
                                    draftTradeList
                                  )
                                })({ changeTradeDraft: changeTradeDraftTether() })
                              )
                            ),
                            dismiss: changeTradeDraft
                          })({}),
                          $node(style({ flex: 1 }))(),
                          $fundBalanceAmount(leg.chainId, leg.token, leg.fundBalance)
                        ),
                        ...(leg.allowance > 0n
                          ? [
                              $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                                $node(style({ flex: 1, minWidth: '160px', fontSize: text.sm, color: palette.foreground }))(
                                  $text(
                                    `${leg.allowance > UNBOUNDED_ALLOWANCE ? 'unlimited' : readableTokenAmountLabel(description, leg.allowance)} approved to the GMX Router`
                                  )
                                ),
                                $infoTooltip(
                                  $node(style({ maxWidth: '240px', lineHeight: '1.4', fontSize: text.sm }))(
                                    $text(
                                      'A standing approval lets GMX pull this token without a signed trade, so the valuation counts the approved amount as an open position rather than free funds. Revoking it costs one relay fee and leaves your positions untouched.'
                                    )
                                  ),
                                  colorShade(palette.foreground, 60)
                                ),
                                $ButtonSecondary({
                                  $container: $defaultMiniButtonSecondary,
                                  $content: $text('Revoke')
                                })({
                                  click: revokeAllowanceTether(
                                    map((): ITradeDraft => ({
                                      kind: 'operate',
                                      id: `revoke:${leg.chainId}:${leg.token}`,
                                      chainId: leg.chainId,
                                      feeToken: bondTokenOf(leg.chainId),
                                      callList: [
                                        {
                                          target: leg.token,
                                          value: 0n,
                                          gasLimit: REVOKE_GAS_LIMIT,
                                          callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [GMX_TOKEN_SPENDER, 0n] })
                                        }
                                      ]
                                    }))
                                  )
                                })
                              )
                            ]
                          : []),
                      )
                    }
                    const $redeemDisabled = $ButtonSecondary({
                      $container: $defaultMiniButtonSecondary,
                      disabled: just(true),
                      $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Redeem'), $popoverCaret())
                    })({})
                    const $redeemSlot = $intermediatePromise({
                      $loader: $redeemDisabled,
                      $$fail: () => $redeemDisabled,
                      $display: map(async (query: Promise<IFundSection | null>) => {
                        const s = await query
                        if (s === null || s.fundRow === undefined) return $redeemDisabled
                        return $ButtonSecondary({
                          $container: $defaultMiniButtonSecondary,
                          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Redeem'), $popoverCaret())
                        })({ click: popTradeTether(map(() => 'redeem')) })
                      }, fundQuery)
                    })
                    const $redeemOver = ($target: I$Node): I$Node =>
                      $Popover({
                        $container: $headerPopoverContainer,
                        $contentContainer: $editorPopoverContentContainer,
                        $target,
                        $open: map(
                          (query: Promise<IFundSection | null>) =>
                            $intermediatePromise({
                              $display: just(
                                query.then(s => {
                                  if (s === null || s.fundRow === undefined) throw new Error('Your fund has no round to redeem from yet.')
                                  const hubLeg = s.legs.find(leg => leg.chainId === HUB_CHAIN_ID && isAddressEqual(leg.token, bondTokenOf(HUB_CHAIN_ID)))
                                  if (hubLeg === undefined) throw new Error(`${bond.symbol} is not registered on ${chainFor(HUB_CHAIN_ID).name}`)
                                  return $RedeemEditor({
                                    master: s.master,
                                    fundRow: s.fundRow,
                                    queue: s.queue,
                                    held: s.units,
                                    fundBalance: hubLeg.fundBalance,
                                    draft: map(list => list.find((d): d is IRedeemDraft => d.kind === 'redeem') ?? null, draftTradeList)
                                  })({ changeTradeDraft: changeTradeDraftTether() })
                                })
                              )
                            }),
                          sampleMap((query: Promise<IFundSection | null>) => query, fundQuery, filter(k => k === 'redeem', popTrade))
                        ),
                        dismiss: changeTradeDraft
                      })({})
                    const $fundPerformance = $node(style({ display: 'flex', width: '200px', height: '40px', flexShrink: '0' }))(
                      $intermediatePromise({
                        $loader: $headerStub('120px'),
                        $display: map(async query => {
                          const shown = await query
                          return shown === null ? $headerFigure('-') : $performanceCell(shown.sinceSec, shown.performance, 'pnl')
                        }, fundPerformanceQuery)
                      })
                    )
                    const $ownedFigure = $intermediatePromise({
                        $loader: $headerStub('110px'),
                        $$fail: () => $headerFigure('-'),
                        $display: map(async (query: Promise<IFundSection | null>) => {
                          const s = await query
                          if (s === null || s.fundRow === undefined) return empty
                          const fundRow = s.fundRow
                          return $amountDisplay({
                            hideBalances,
                            usd: map(price => formatUsd(cashFor(s.units, fundRow.totalUnits, fundRow.value), price), priceFor(HUB_CHAIN_ID, value.address)),
                            amount: readablePercentage(fundRow.totalUnits === 0n ? 0n : (s.units * 10_000n) / fundRow.totalUnits),
                            align: 'flex-end'
                          })
                        }, fundQuery)
                      })
                    const $tradingList = $intermediatePromise({
                      $display: map(async (query: Promise<IFundSection | null>) => {
                        const s = await query
                        if (s === null) return $emptySection('Link a dApp and trade what your account holds.')
                        if (s.fundRow === undefined) {
                          return s.surplus.length === 0
                            ? $emptySection('Allocate your first round to open your fund.')
                            : $column(spacing.tiny)(
                                $node(style({ fontSize: text.xs, color: palette.indeterminate }))($text('In escrow for your fund, not in a round yet')),
                                ...s.surplus.map(row => $EscrowedRow({ hideBalances, ...row })({ fundRound: changeTradeDraftTether() }))
                              )
                        }
                        const legs = s.legs.filter(leg => leg.fundBalance > 0n || leg.allowance > 0n)
                        if (legs.length === 0) return $emptySection('Fund balances on every chain appear here.')
                        const $arriving = switchLatest(
                          map(list => {
                            const targets = list.flatMap(d =>
                              d.kind === 'fundSwap' && !legs.some(leg => leg.chainId === d.destinationChainId && isAddressEqual(leg.token, d.outputToken))
                                ? [{ chainId: d.destinationChainId, token: d.outputToken }]
                                : []
                            )
                            return $column(spacing.tiny)(
                              ...targets.map(t =>
                                $row(spacing.default, style({ alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                                  $node(style({ flex: 1, minWidth: '160px' }))($tokenProfile(t.chainId, t.token)),
                                  $fundBalanceAmount(t.chainId, t.token, 0n)
                                )
                              )
                            )
                          }, draftTradeList)
                        )
                        return $column(spacing.tiny)(...legs.map(leg => $fundLeg(s, leg)), $arriving)
                      }, fundQuery)
                    })
                    return $column(style({ gap: isDesktopScreen ? '40px' : '28px', padding: '0 0 4px' }))(
                      $sectionList(
                        $section($backingHeader(root.account, $depositPopover), $column(spacing.default)($depositList, $backingList)),
                        $section(
                          p.fund === null
                            ? $sectionHeader($heading3($text('Fund')), null, $openFundLink)
                            : $sectionHeader(
                                $allocateOver(
                                  p.fund,
                                  $redeemOver(
                                    $row(spacing.default, style({ alignItems: 'center' }))(
                                      $fundProfile(p.fund.account, p.fund.cells, p.fund.symbol),
                                      isDesktopScreen ? $fundPerformance : empty,
                                      $allocateButton,
                                      $redeemSlot
                                    )
                                  )
                                ),
                                null,
                                $ownedFigure
                              ),
                          p.fund === null
                            ? 'unreachable' in root.chronicle
                              ? $emptySection(`The chronicle could not be reached, so your fund could not be looked up: ${root.chronicle.unreachable}`)
                              : $emptySection(
                                  'Your fund trades on its own key, separate from this account.',
                                  $Link({
                                    route: routeSchema.quickstart,
                                    $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' })),
                                    $content: $text('Create your fund')
                                  })({})
                                )
                            : $column(spacing.default)(
                                $OpenPositions({ master: p.fund.account, hideBalances, positions: openPositions, valuation: openValuation, $empty: empty })({}),
                                $tradingList
                              )
                        ),
                        $AccountHistory(historyQuery, $historyHeader, $emptyHistory)({})
                      )
                    )
                  },
                  skipRepeatsWith(
                    (x: ISectionState, y: ISectionState) => {
                      if (x.kind !== 'params' || y.kind !== 'params') return x.kind === 'pending' && y.kind === 'pending'
                      const a = x.params
                      const b = y.params
                      return (
                        a.wallet?.address === b.wallet?.address &&
                        a.registry === b.registry &&
                        a.root?.account === b.root?.account &&
                        a.fund?.account === b.fund?.account &&
                        (a.root?.deployed.size ?? 0) === (b.root?.deployed.size ?? 0) &&
                        heldKey(a.root) === heldKey(b.root)
                      )
                    },
                    op(
                      sectionQuery,
                      promiseState,
                      map((s): ISectionState => {
                        if (s.status === PromiseStatus.PENDING) return { kind: 'pending' }
                        return s.status === PromiseStatus.ERROR ? { kind: 'error', error: s.error } : { kind: 'params', params: s.value }
                      })
                    )
                  )
                )
              )
            )
          )
        ),
        {
          changeHideBalances,
          changeDraft: merge(changeDraft, fundAllocate, fundRound),
          changeMandateDraft,
          changeTradeDraft: merge(
            changeTradeDraft,
            revokeAllowance,
            map((d): ITradeDraft => ({ kind: 'allocate', id: 'allocate', escrowChainId: Number(d.deposit.destinationChainId) as ChainId, escrowToken: d.deposit.outputToken, contribution: d.expectedOutput, backers: 0n, identity: null }), fundAllocate),
            op(
              sampleMap((backers, d: IDepositDraft) => (backers === null ? null : { backers, d }), roundBackers, fundRound),
              filterNull,
              map((p): ITradeDraft => ({ kind: 'allocate', id: 'allocate', escrowChainId: Number(p.d.deposit.destinationChainId) as ChainId, escrowToken: p.d.deposit.outputToken, contribution: p.d.expectedOutput, backers: p.backers, identity: null }))
            )
          )
        }
      ]
    }
  )
