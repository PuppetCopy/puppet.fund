import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId, IntervalTime } from '@puppet/sdk/const'
import { getDuration, getTokenDescription, getUnixTimestamp, readableAddress, readableDate, readablePercentage, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import type { IMandateRow } from '@puppet/sdk/schema'
import { bondTokenOf, chainTokenOfKey, type ITokenRegistryMap, listedTokenAddresses } from '@puppet/sdk/state'
import {
  combine,
  empty,
  filter,
  type IStream,
  just,
  map,
  merge,
  op,
  reduce,
  sampleMap,
  skipRepeatsWith,
  start,
  switchLatest
} from 'aelea/stream'
import { type IBehavior, PromiseStatus, promiseState, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
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
  $labeledDivider,
  $popoverCaret,
  $sectionLoader,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../app/localStoreSchema.js'
import { routeSchema } from '../app/routeSchema.js'
import { $tokenProfile } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2 } from '../common/elements/$common.js'
import { $AccountMenu } from '../components/$AccountMenu.js'
import { accountDisplayName } from '../components/$AccountProfile.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $ValueTimeline } from '../components/participant/$ValueTimeline.js'
import { $AccountHistory } from '../components/portfolio/$AccountHistory.js'
import { $DepositEditor } from '../components/portfolio/$DepositEditor.js'
import { $MandateEditor } from '../components/portfolio/$MandateEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import { $CycleEditor } from '../components/portfolio/$TradeEditors.js'
import { $UnbondEditor } from '../components/portfolio/$UnbondEditor.js'
import {
  arrivalFloor,
  depositCreditToken,
  type IDepositDraft,
  type IEditorDraft,
  type IMandateDraft,
  type ITradeDraft,
  type IUnbondDraft,
  type IWithdrawDraft
} from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import context from '../io/context.js'
import { type IBackingView, ownBackingViews, ownTradeViews } from '../io/datastore/own.js'
import type { ITimelinePoint } from '../io/datastore/traders.js'
import type { ITradeView } from '../io/datastore/trading.js'
import { flatTimeline, walletTimeline } from '../io/datastore/walletTimeline.js'
import type { IAccountAction } from '../io/journal/history.js'
import type { IOwnState } from '../io/journal/localFold.js'
import { formatUsd, priceFor } from '../io/price.js'
import { walletValueUsd } from '../io/walletValue.js'
import { balanceAt, type IConnectedWallet, type IRootState, type IWalletPair } from '../wallet/index.js'
import type { IPageFilterParams } from './types.js'

const $section = $column(spacing.small)
const $sectionList = $column(style({ gap: isDesktopScreen ? '48px' : '34px' }))
const value = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))
const bond = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID))

const BOND_TOOLTIP = `One ${bond.symbol} pool on ${chainFor(HUB_CHAIN_ID).name}, shared by every trader you back. Bond deposits land there, and you can release whatever is not backing an open cycle.`

const $sectionTip = (tooltip: string): I$Node =>
  $infoTooltip(
    $node(style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm }))($text(tooltip)),
    colorShade(palette.foreground, 60))

const $emptySection = (detail: string, $cta?: I$Node): I$Node =>
  $row(spacing.small, style({ alignItems: 'baseline', flexWrap: 'wrap', padding: '4px 0', color: palette.foreground, fontSize: text.sm }))(
    $node($text(detail)),
    ...($cta ? [$cta] : [])
  )

const $sectionHeader = ($title: I$Node, tooltip: string, $trailing?: I$Node): I$Node =>
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
    $row(spacing.small, style({ alignItems: 'center' }))($title, $sectionTip(tooltip)),
    $trailing ?? empty
  )

const $bondDivider = ($action: I$Node): I$Node =>
  $column(style({ paddingTop: '8px' }))(
    $labeledDivider(
      $row(spacing.default, style({ alignItems: 'center' }))(
        $row(spacing.small, style({ alignItems: 'center' }))($text('Bond balances'), $sectionTip(BOND_TOOLTIP)),
        $action
      )
    )
  )

interface I$Portfolio extends IPageFilterParams {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  walletRoot: IStream<IRootState | null>
  historyQuery: IStream<Promise<IAccountAction[]>>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  mandatesQuery: IStream<Promise<IMandateRow[]>>
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  draftMandateList: IStream<IMandateDraft[]>
  draftUnbondList: IStream<IUnbondDraft[]>
  draftTradeList: IStream<ITradeDraft[]>
}

export const $Portfolio = ({
  hideBalances,
  walletPair,
  walletRoot,
  historyQuery,
  ownStateQuery,
  mandatesQuery,
  draftDepositList,
  draftWithdrawList,
  draftMandateList,
  draftUnbondList,
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
      [toggleTrade, toggleTradeTether]: IBehavior<PointerEvent, string>,
      [popDeposit, popDepositTether]: IBehavior<PointerEvent>,
      [popUnbond, popUnbondTether]: IBehavior<PointerEvent>,
      [changeUnbondDraft, changeUnbondDraftTether]: IBehavior<IUnbondDraft>,
      [popBondDeposit, popBondDepositTether]: IBehavior<PointerEvent>,
      [changeBondDeposit, changeBondDepositTether]: IBehavior<IDepositDraft | IWithdrawDraft>
    ) => {

      interface ISectionParams {
        root: IRootState | null
        registry: ITokenRegistryMap
        wallet: IConnectedWallet | null
      }
      type ISectionState = { kind: 'params'; params: ISectionParams } | { kind: 'error'; error: unknown } | { kind: 'pending' }
      const heldKey = (root: IRootState | null): string =>
        root ? root.balances.filter(b => b.balance > 0n).map(b => `${b.chainId}:${b.token}`).sort().join(',') : ''

      const activityTimeframe: IStream<IntervalTime> = op(
        uiStorage.replayWrite(localStoreSchema.global.activityTimeframe, changeActivityTimeframe),
        state()
      )
      const timelineQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ own: ownStateQuery, tf: activityTimeframe }),
        map(async p => {
          const own = await p.own
          const until = getUnixTimestamp()
          if (own === null) return flatTimeline(until - p.tf, until)
          const [views, backings] = await Promise.all([ownTradeViews(own), ownBackingViews(own)])
          const [points, live] = await Promise.all([
            walletTimeline([own.account], own.books, until - p.tf, until),
            walletValueUsd(views, backings, own.deposits, own.bonds)
          ])
          return live === null ? points : [...points.slice(0, -1), { time: until, value: live }]
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
          'What your account holds over time. Deposits and withdrawals count at their value when they landed, open cycles at their latest valuation, and settlements at their closing value. The last point is live.',
        activityTimeframe
      })({ changeActivityTimeframe: changeActivityTimeframeTether() }))

      const sectionQuery: IStream<Promise<ISectionParams>> = op(
        walletPair,
        map(async pair => {
          const [registry, root] = await Promise.all([context.getTokenRegistry(), pair.root])
          return { wallet: pair.wallet, root, registry }
        }),
        state()
      )

      const $historyHeader = ($trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3($text('History')),
          'Every settled action of your account, read from its own on-chain log: deposits, withdrawals, mandates, trades and settlements.',
          $trailing
        )
      const $balancesHeader = ($trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3($text('Balances')),
          'Tokens your account holds on each chain. Deposit any token from any chain and choose where it lands; your first deposit sets up your account.',
          $trailing
        )
      const $tradingHeader = ($trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3($text('Trading')),
          'Trade what your account holds through a linked dApp. Your first order opens a cycle: it locks that capital and matches backers to it. Closing at flat settles the cycle. Marked value is the latest valuation of the book.',
          $trailing
        )
      const $backingHeader = ($trailing?: I$Node): I$Node =>
        $sectionHeader(
          $heading3($text('Backing')),
          `Your ${bond.symbol} bond is one pool, shared by every trader you back. Each match uses the share your mandate allows from what is still matchable. Your claim follows the latest valuation of each book and shows as evaluating while it is pending.`,
          $trailing
        )
      const $emptyHistory = $emptySection('Every settled action of your account lands here.')
      const draftedBond: IStream<bigint> = map(
        q =>
          q.dep.filter(d => d.arrival === 'bond').reduce((total, d) => total + arrivalFloor(d), 0n) +
          q.man.reduce((total, d) => total + d.bond, 0n),
        combine({ dep: draftDepositList, man: draftMandateList })
      )
      const $bondStandingRow = (bonded: IStream<bigint>, pending: IStream<bigint>, $release: I$Node | null): I$Node => {
        const figures = op(
          combine({ bonded, pending, price: priceFor(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)) }),
          skipRepeatsWith((a, b) => a.bonded === b.bonded && a.pending === b.pending && a.price === b.price),
          state()
        )
        const shown = op(
          figures,
          map(f => f.bonded !== 0n || f.pending !== 0n),
          skipRepeatsWith((a, b) => a === b)
        )
        return switchLatest(
          map(
            visible =>
              visible
                ? $row(
                    spacing.default,
                    style({ alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` })
                  )(
                    $tokenProfile(HUB_CHAIN_ID, bond.address),
                    ...($release === null ? [] : [$release]),
                    $node(style({ flex: 1 }))(),
                    $amountDisplay({
                      hideBalances,
                      usd: map(f => formatUsd(f.bonded, f.price), figures),
                      amount: map(f => readableTokenAmountLabel(bond, f.bonded), figures),
                      change: map(
                        f =>
                          f.pending === 0n
                            ? null
                            : { usd: formatUsd(f.bonded + f.pending, f.price), amount: readableTokenAmountLabel(bond, f.bonded + f.pending) },
                        figures
                      ),
                      color: just(palette.positive),
                      align: 'flex-end'
                    })
                  )
                : empty,
            shown
          )
        )
      }
      const draftedCredits: IStream<{ chainId: ChainId; token: Hex; amount: bigint }[]> = op(
        draftDepositList,
        map(list =>
          list
            .filter(d => d.arrival === 'credit' && d.expectedOutput > 0n)
            .map(d => ({ chainId: Number(d.deposit.destinationChainId) as ChainId, token: depositCreditToken(d), amount: d.expectedOutput }))
        ),
        skipRepeatsWith((a, b) => a.map(r => `${r.chainId}:${r.token}:${r.amount}`).join() === b.map(r => `${r.chainId}:${r.token}:${r.amount}`).join())
      )
      const $draftedCreditRow = (row: { chainId: ChainId; token: Hex; amount: bigint }): I$Node => {
        const description = getTokenDescription(row.chainId, row.token)
        return $row(
          spacing.default,
          style({ alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` })
        )(
          $tokenProfile(row.chainId, row.token),
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
      const $onboardingShell = ($balancesAction: I$Node, $bondAction: I$Node): I$Node =>
        $column(style({ gap: isDesktopScreen ? '40px' : '28px', padding: '0 0 4px' }))(
          $sectionList(
            $section(
              $balancesHeader($balancesAction),
              switchLatest(
                map(
                  rows =>
                    rows.length === 0
                      ? $emptySection('Deposit any token, from any chain.')
                      : $column(spacing.default)(...rows.map($draftedCreditRow)),
                  draftedCredits
                )
              ),
              $bondDivider($bondAction),
              $bondStandingRow(just(0n), draftedBond, null)
            ),
            $section(
              $tradingHeader(),
              $emptySection('Link a dApp and trade what your account holds.')
            ),
            $section(
              $backingHeader(),
              $emptySection(
                'Back a trader with your bond.',
                $Link({
                  route: routeSchema.traders,
                  $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' })),
                  $content: $text('Browse traders')
                })({})
              )
            ),
            $section($historyHeader(), $emptyHistory)
          )
        )

      const tradeQuery: IStream<Promise<ITradeView[]>> = op(
        ownStateQuery,
        map(async q => {
          const own = await q
          return own === null ? [] : ownTradeViews(own)
        }),
        state()
      )
      const openTrade: IStream<string | null> = op(
        toggleTrade,
        reduce((open: string | null, key: string) => (open === key ? null : key), null),
        state(null)
      )
      const $sectionSkeleton = $sectionList(
        $section($backingHeader(), $sectionLoader),
        $section($historyHeader(), $sectionLoader)
      )
      interface IBackingSection {
        masters: Address[]
        mandates: IMandateRow[]
        views: IBackingView[]
      }
      const backingQuery: IStream<Promise<IBackingSection>> = op(
        combine({ own: ownStateQuery, mandates: mandatesQuery }),
        map(async q => {
          const [own, mandates] = await Promise.all([q.own, q.mandates])
          const views = own === null ? [] : await ownBackingViews(own)
          const masters = [...new Set([...mandates.map(m => getAddress(m.master)), ...views.map(v => getAddress(v.book.master))])]
          return { masters, mandates, views }
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
            $Link({ route: routeSchema.traders, $anchor: $defaultAnchor(style({ color: colorShade(palette.message, 85), textDecoration: 'none' })), $content: $text('Traders') })({}),
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
                      return $onboardingShell($WalletConnect()({}), $WalletConnect()({}))
                    }
                    const wallet = p.wallet
                    const root = p.root
                    if (root === null) {
                      return $onboardingShell(
                        $Popover({
                          $contentContainer: $editorPopoverContentContainer,
                          $target: $ButtonPrimary({
                            $container: $defaultMiniButtonPrimary,
                            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Deposit'), $popoverCaret())
                          })({ click: popDepositTether() }),
                          $open: map(
                            () =>
                              $DepositEditor({
                                hideBalances,
                                account: null,
                                tokenRegistry: p.registry,
                                walletAccount: wallet,
                                destination: 'choose',
                                arrival: 'credit',
                                existingDraft: map(
                                  list => list.find(d => Number(d.deposit.destinationChainId) === d.deposit.chainId) ?? null,
                                  draftDepositList
                                )
                              })({ changeDraft: changeDraftTether() }),
                            popDeposit
                          ),
                          dismiss: changeDraft
                        })({}),
                        $Popover({
                          $contentContainer: $editorPopoverContentContainer,
                          $target: $ButtonPrimary({
                            $container: $defaultMiniButtonPrimary,
                            $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Bond'), $popoverCaret())
                          })({ click: popBondDepositTether() }),
                          $open: map(
                            () =>
                              $DepositEditor({
                                hideBalances,
                                account: null,
                                tokenRegistry: p.registry,
                                walletAccount: wallet,
                                destination: { chainId: HUB_CHAIN_ID, token: bondTokenOf(HUB_CHAIN_ID) },
                                arrival: 'bond',
                                existingDraft: map(list => list.find(d => d.arrival === 'bond') ?? null, draftDepositList)
                              })({ changeDraft: changeBondDepositTether() }),
                            popBondDeposit
                          ),
                          dismiss: changeBondDeposit
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
                          x.arrival === 'credit' &&
                          ((Number(x.deposit.destinationChainId) === chainId && isAddressEqual(depositCreditToken(x), token)) ||
                            (x.deposit.chainId === chainId && isAddressEqual(x.deposit.inputToken, token)))
                      ) ?? (wd.find(x => x.chainId === chainId && isAddressEqual(x.inputAmount.token, token)) ?? null)
                    const draftDelta = (d: IEditorDraft, chainId: ChainId, token: Hex): bigint => {
                      if (d.kind === 'withdraw') {
                        return d.chainId === chainId && isAddressEqual(d.inputAmount.token, token) ? -d.inputAmount.amount : 0n
                      }
                      return Number(d.deposit.destinationChainId) === chainId && isAddressEqual(depositCreditToken(d), token)
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
                            hideBalances,
                            account: puppetAddress,
                            tokenRegistry: p.registry,
                            walletAccount: wallet,
                            destination: 'choose',
                            arrival: 'credit',
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
                    const $bondDepositPopover = $Popover({
                      $contentContainer: $editorPopoverContentContainer,
                      $target: $ButtonPrimary({
                        $container: $defaultMiniButtonPrimary,
                        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Bond'), $popoverCaret())
                      })({ click: popBondDepositTether() }),
                      $open: map(
                        () =>
                          $DepositEditor({
                            hideBalances,
                            account: puppetAddress,
                            tokenRegistry: p.registry,
                            walletAccount: wallet,
                            destination: { chainId: HUB_CHAIN_ID, token: bondTokenOf(HUB_CHAIN_ID) },
                            arrival: 'bond',
                            existingDraft: map(list => list.find(d => d.arrival === 'bond') ?? null, draftDepositList)
                          })({ changeDraft: changeBondDepositTether() }),
                        popBondDeposit
                      ),
                      dismiss: changeBondDeposit
                    })({})
                    const $unbondPopover = $Popover({
                      $contentContainer: $editorPopoverContentContainer,
                      $target: $bondStandingRow(
                        map(a => a.bonded, puppetAccount),
                        draftedBond,
                        $ButtonSecondary({
                          $container: $defaultMiniButtonSecondary,
                          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Release'), $popoverCaret())
                        })({ click: popUnbondTether() })
                      ),
                      $open: sampleMap(
                        (account: IRootState, _click: PointerEvent) =>
                          $UnbondEditor({
                            bonded: account.bonded,
                            existingDraft: map(list => list.find(d => d.id === 'unbond') ?? null, draftUnbondList)
                          })({ changeDraft: changeUnbondDraftTether() }),
                        puppetAccount,
                        popUnbond
                      ),
                      dismiss: changeUnbondDraft
                    })({})
                    const $bondedStanding: I$Node = $unbondPopover
                    const $depositList = switchLatest(
                      map(rows => {
                        if (rows.length === 0) {
                          return $emptySection('Deposit any token, from any chain.')
                        }
                        return $column(style({ gap: '0' }))(
                          ...rows.map((r, i) =>
                            $node(style(i === rows.length - 1 ? {} : { borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                              $balanceEditor(r.chainId, r.token)
                            )
                          )
                        )
                      }, heldRows)
                    )
                    const $mandateRow = (b: IBackingSection, master: Address): I$Node => {
                      const nowSec = getUnixTimestamp()
                      const mandate = b.mandates.find(m => isAddressEqual(m.master, master))
                      const active = mandate !== undefined && mandate.expiry > BigInt(nowSec)
                      const views = b.views.filter(v => isAddressEqual(v.book.master, master))
                      const stake = views.reduce((acc, v) => acc + v.row.stake, 0n)
                      const claim = views.some(v => v.claim === null) ? null : views.reduce((acc, v) => acc + (v.claim ?? 0n), 0n)
                      const draft = op(
                        draftMandateList,
                        map(list => list.find(d => d.mandate !== null && isAddressEqual(d.mandate.master, master)) ?? null)
                      )
                      const $meta = (label: string): I$Node => $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))
                      return $column(spacing.small, style({ padding: '10px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                        $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                          $row(spacing.small, style({ alignItems: 'center', flex: 1, minWidth: '160px' }))(
                            $roboAvatar(master, 28),
                            $column(spacing.tiny)(
                              $Link({
                                route: routeSchema.traders.detail,
                                params: { master },
                                $anchor: $defaultAnchor(style({ fontWeight: '600', color: palette.message, textDecoration: 'none' })),
                                $content: $text(accountDisplayName(master))
                              })({}),
                              $meta(readableAddress(master))
                            )
                          ),
                          $column(spacing.tiny, style({ minWidth: '150px' }))(
                            mandate !== undefined && active
                              ? $text(
                                  `${readablePercentage(mandate.allocationRate)} of matchable bond in ${listedTokenAddresses(p.registry, HUB_CHAIN_ID, mandate.tokenIdList)
                                    .map(t => getTokenDescription(HUB_CHAIN_ID, t).symbol)
                                    .join(', ')} per match`
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
                          $column(spacing.tiny, style({ minWidth: '120px', textAlign: 'right' }))(
                            $text(
                              views.length === 0
                                ? '-'
                                : claim === null
                                  ? `${readableTokenAmountLabel(value, stake)} (evaluating)`
                                  : readableTokenAmountLabel(value, claim)
                            ),
                            ...(views.length > 0 && claim !== null
                              ? [
                                  $node(style({ color: claim >= stake ? palette.positive : palette.negative, fontSize: text.sm }))(
                                    $text(`${claim >= stake ? '+' : ''}${readableTokenAmountLabel(value, claim - stake)}`)
                                  )
                                ]
                              : [])
                          ),
                          $ButtonSecondary({
                            $container: $defaultMiniButtonSecondary,
                            $content: $text(map(open => (open !== null && isAddressEqual(open, master) ? 'Close' : active ? 'Manage' : 'Back'), openMandate))
                          })({ click: toggleMandateTether(map(() => master)) })
                        ),
                        switchLatest(
                          map(
                            open =>
                              open !== null && isAddressEqual(open, master)
                                ? $MandateEditor({ registry: p.registry, master, existing: mandate, draft })({
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
                        if (b.masters.length === 0) {
                          return $emptySection(
                            'Back a trader with your bond.',
                            $Link({
                              route: routeSchema.traders,
                              $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' })),
                              $content: $text('Browse traders')
                            })({})
                          )
                        }
                        return $column(spacing.tiny)(...b.masters.map(m => $mandateRow(b, m)))
                      }, backingQuery)
                    })
                    const $bookRow = (view: ITradeView): I$Node => {
                      const chainId = Number(view.book.chainId) as ChainId
                      const open = view.book.cycle > view.settledCycle
                      const $meta = (label: string): I$Node => $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))
                      const markLabel =
                        view.mark === undefined
                          ? '-'
                          : view.mark.pending || view.mark.closeValue === undefined
                            ? 'evaluating'
                            : readableTokenAmountLabel(value, view.mark.closeValue)
                      return $column(spacing.small, style({ padding: '10px 0', borderBottom: `1px solid ${colorShade(palette.foreground, 10)}` }))(
                        $row(spacing.default, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                          $column(spacing.tiny, style({ flex: 1, minWidth: '160px' }))(
                            $tokenProfile(chainId, getAddress(view.book.token)),
                            $meta(`${readablePercentage(view.book.skin)} skin`)
                          ),
                          $column(spacing.tiny, style({ minWidth: '150px' }))(
                            $text(`cycle ${view.book.cycle} · ${open ? 'open' : 'settled'}`),
                            $meta(`${view.book.backerList.length} backer${view.book.backerList.length === 1 ? '' : 's'} · ${readableTokenAmountLabel(value, view.book.backed)} backing`)
                          ),
                          $column(spacing.tiny, style({ minWidth: '120px', textAlign: 'right' }))($text(markLabel), $meta('marked value')),
                          $ButtonSecondary({
                            $container: $defaultMiniButtonSecondary,
                            $content: $text(map(o => (o === view.book.id ? 'Close' : 'Cycle'), openTrade))
                          })({ click: toggleTradeTether(map(() => view.book.id)) })
                        ),
                        switchLatest(
                          map(
                            o =>
                              o === view.book.id
                                ? $CycleEditor({ view })({
                                    changeTradeDraft: changeTradeDraftTether()
                                  })
                                : empty,
                            openTrade
                          )
                        )
                      )
                    }
                    const $tradingList = $intermediatePromise({
                      $display: map(async (query: Promise<ITradeView[]>) => {
                        const views = await query
                        if (views.length === 0) {
                          return $emptySection('Link a dApp and trade what your account holds.')
                        }
                        return $column(spacing.tiny)(...views.map($bookRow))
                      }, tradeQuery)
                    })
                    return $column(style({ gap: isDesktopScreen ? '40px' : '28px', padding: '0 0 4px' }))(
                      $sectionList(
                        $section(
                          $balancesHeader($depositPopover),
                          $depositList,
                          $bondDivider($bondDepositPopover),
                          $bondedStanding
                        ),
                        $section($tradingHeader(), $tradingList),
                        $section($backingHeader(), $backingList),
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
          changeDraft: merge(changeDraft, changeBondDeposit),
          changeMandateDraft,
          changeUnbondDraft,
          changeTradeDraft
        }
      ]
    }
  )
