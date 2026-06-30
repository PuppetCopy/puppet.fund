import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { predictFundAccount, predictPuppetAccount, symbolForBaseTokenId } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import { applyFactor, getDuration, getRegisteredTokenDescription, readablePercentage } from '@puppet/sdk/core'
import type { IFund } from '@puppet/sdk/schema'
import {
  computeClaimable,
  computeQueuedShares,
  type ISubaccountState,
  type ITokenRegistryMap,
  stubSubaccountState,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  combine,
  empty,
  fromPromise,
  type IStream,
  just,
  map,
  op,
  skipRepeatsWith,
  start,
  switchLatest,
  switchPromises,
  tap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { getAddress, type Hex, isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { $arrowRight, $icon, $infoLabel, $infoTooltip, $navLink, $puppeteer, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2, $navText } from '../common/elements/$common.js'
import { $AccountMenu } from '../components/$AccountMenu.js'
import { $fundProfile, $profileDisplay } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $usdTimeline, type ITimelinePoint } from '../components/participant/$ProfilePeformanceTimeline.js'
import { $FundEditor } from '../components/portfolio/$FundEditor.js'
import { $FundSell } from '../components/portfolio/$FundSell.js'
import { $SubscribeEditor } from '../components/portfolio/$SubscribeEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IDepositDraft,
  IFundSwapDraft,
  IRecognizeFundDraft,
  IRedeemDraft,
  ISellDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import context from '../io/context.js'
import { fetchMasterPoolState, fetchPuppetBalanceTimeline, type ISubscribeRule } from '../io/datastore/query.js'
import { liveTotalUsdValue } from '../io/totalValue.js'
import type { connectWallet, IConnectedWallet } from '../wallet/index.js'
import type { IPageFilterParams } from './types.js'

const $timelineCard = (
  hideBalances: IStream<boolean>,
  timelineQuery: IStream<Promise<ITimelinePoint[]>>,
  activityTimeframe: IStream<IntervalTime>,
  $lead: I$Node,
  changeActivityTimeframeTether: IBehavior<any, IntervalTime>[1],
  liveUsd: IStream<number | null>
): I$Node =>
  $card2(
    style({
      padding: 0,
      height: '200px',
      position: 'relative',
      margin: isDesktopScreen ? '-36px -36px 0' : '-12px -12px 0px'
    })
  )(
    $usdTimeline({
      hideBalances,
      timelineQuery,
      label: 'Total Value (USD)',
      tooltip: 'Your total value in USD: account balance plus the current value of your open positions',
      activityTimeframe,
      $lead,
      liveUsd,
      $empty: $column(
        spacing.small,
        style({ alignItems: 'center', textAlign: 'center', color: palette.foreground, fontSize: text.sm })
      )($heading3($text('No activity yet')))
    })({ changeActivityTimeframe: changeActivityTimeframeTether() })
  )

interface I$Portfolio extends IPageFilterParams {
  hideBalances: IStream<boolean>
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  draftAllocateList: IStream<IAllocateDraft[]>
  draftSwapList: IStream<IFundSwapDraft[]>
  draftRedeemList: IStream<IRedeemDraft[]>
  draftMatchingRuleList: IStream<ISubscribeRule[]>
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<ISubaccountState | null>
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
}

export const $Portfolio = ({
  hideBalances,
  activityTimeframe,
  collateralTokenList,
  walletQuery,
  walletState: rootState,
  userMatchingRuleQuery,
  draftDepositList,
  draftWithdrawList,
  draftAllocateList,
  draftSwapList,
  draftRedeemList,
  draftMatchingRuleList
}: I$Portfolio) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [changeHideBalances, changeHideBalancesTether]: IBehavior<boolean>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<IFundSwapDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft | IRecognizeFundDraft>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [_connect, connectTether]: IBehavior<ReturnType<typeof connectWallet>>
    ) => {
      const registeredCollateralList = fromPromise(
        context
          .getTokenRegistry()
          .then(reg => [...(reg.get(HUB_CHAIN_ID)?.values() ?? [])].map(i => i.token).filter(t => t !== PROTOCOL.nativeToken))
      )
      const walletState: IStream<IConnectedWallet | null> = op(walletQuery, switchPromises, state())

      interface IPortfolioSectionParams {
        root: ISubaccountState | null
        registry: ITokenRegistryMap
        wallet: IConnectedWallet | null
        rules: ISubscribeRule[]
        draftRules: ISubscribeRule[]
      }
      const heldKey = (root: ISubaccountState | null): string =>
        root
          ? [...root.balances.entries()]
              .filter(([, r]) => r.signedBalance > 0n)
              .map(([t]) => t)
              .sort()
              .join(',')
          : ''
      const pendingSubKey = (rules: ISubscribeRule[]): string =>
        [...new Set(rules.filter(r => r.allocationRate > 0n).map(r => r.baseToken))].sort().join(',')
      const tokenRegistryValue = fromPromise(context.getTokenRegistry())

      const balanceTimelineQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ tf: activityTimeframe, root: rootState, registry: tokenRegistryValue }),
        // rootState re-emits on every optimistic attest/settlement fold; only refetch the (multi-request) timeline
        // when an input that actually changes the series moves.
        skipRepeatsWith(
          (a, b) =>
            a.tf === b.tf &&
            a.root?.account === b.root?.account &&
            a.root?.lastTransactionHash === b.root?.lastTransactionHash &&
            (a.root?.funds.length ?? 0) === (b.root?.funds.length ?? 0) &&
            (a.root?.positions.length ?? 0) === (b.root?.positions.length ?? 0) &&
            heldKey(a.root) === heldKey(b.root)
        ),
        map(p => fetchPuppetBalanceTimeline(p.registry, p.root ? [p.root] : [], p.tf))
      )

      // Live, optimistic total that drives the chart headline so a settled withdraw tweens the value the instant
      // rootState folds it, independent of the (slower, multi-request) timeline re-fetch behind the line.
      const liveUsd = liveTotalUsdValue(rootState, tokenRegistryValue)

      const $lead = $row(style({ flex: 1 }))(
        $SelectCollateralToken({ selectedList: collateralTokenList, tokenList: registeredCollateralList })({
          changeCollateralTokenList: selectCollateralTokenListTether()
        })
      )

      const $fundProfileByAddress = (fundAddress: Address): I$Node =>
        switchLatest(
          map(
            fund =>
              fund
                ? $fundProfile({ master: fund.master, baseToken: fund.baseToken, name: fund.name }, 36)
                : $profileDisplay({ address: fundAddress, profileSize: 36 }),
            op(just(fetchMasterPoolState(fundAddress)), switchPromises, start(undefined))
          )
        )

      return [
        $column(spacing.default)(
          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
            $navText('/leaderboard', 'Leaderboard'),
            $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
            $node(style({ color: palette.message }))($text('Portfolio')),
            $node(style({ flex: 1 }))(),
            $AccountMenu({ walletState, hideBalances })({ changeHideBalances: changeHideBalancesTether() })
          ),
          $card(spacing.big, style({ flex: 1, width: '100%' }))(
            $timelineCard(hideBalances, balanceTimelineQuery, activityTimeframe, $lead, changeActivityTimeframeTether, liveUsd),
            switchLatest(
              map(
                (p: IPortfolioSectionParams) => {
                  if (!p.wallet)
                    return $column(
                      spacing.big,
                      style({ alignItems: 'center', textAlign: 'center', padding: '40px 16px' })
                    )(
                      $heading3($text('Connect your wallet')),
                      $infoLabel(style({ maxWidth: '420px' }))(
                        $text(
                          'Fund top traders and let them trade your capital on GMX, or run your own fund and get funded. Connect to see your balances, funds and open positions.'
                        )
                      ),
                      $WalletConnect()({ connect: connectTether() }),
                      $navText('/leaderboard', 'Browse traders →')
                    )
                  const wallet = p.wallet
                  const signer = wallet.session?.signer ?? p.root?.signer ?? wallet.address
                  const puppetAddress = predictPuppetAccount({ user: wallet.address, signer })
                  const puppetAccount: IStream<ISubaccountState> = op(
                    rootState,
                    map(root => root ?? stubSubaccountState({ user: wallet.address, signer }))
                  )
                  const registeredIds = [...(p.registry.get(HUB_CHAIN_ID)?.keys() ?? [])]

                  const $balanceEditor = (token: Hex, inlineNote?: string): I$Node => {
                    // Deep-link: a ?action=deposit-<symbol> (or withdraw-) on arrival opens this token's editor once.
                    // Read the param fresh and clear it on open, so a re-render does not re-open and a fresh navigation
                    // re-arms it. The symbol is derived the same way the linking row builds it.
                    const symbol =
                      symbolForBaseTokenId(token) ??
                      getRegisteredTokenDescription(tokenInfoFor(p.registry, HUB_CHAIN_ID, token).token).symbol
                    const param = new URLSearchParams(location.search).get('action')
                    const verb =
                      param === `deposit-${symbol}`
                        ? ('deposit' as const)
                        : param === `withdraw-${symbol}`
                          ? ('withdraw' as const)
                          : null
                    // state() so the open signal REPLAYS: on reload the editor mounts during the init storm and the
                    // popover's open-state subscribes after this fires; a bare one-shot (just) would be lost to that
                    // late consumer, leaving a half-open popover (no label, dead click). state replays the verb to it.
                    const autoOpen = verb
                      ? op(
                          just(verb),
                          tap(() => {
                            const url = new URL(location.href)
                            url.searchParams.delete('action')
                            window.history.replaceState(null, '', `${url.pathname}${url.search}`)
                          }),
                          state()
                        )
                      : undefined
                    return $TokenBalanceEditor({
                      hideBalances,
                      accountState: puppetAccount,
                      token,
                      tokenRegistry: p.registry,
                      walletAccount: wallet,
                      inlineNote,
                      autoOpen,
                      draft: op(
                        combine({ dep: draftDepositList, wd: draftWithdrawList }),
                        map(
                          d =>
                            d.dep.find(x => x.account === puppetAddress && x.output.baseToken === token) ??
                            d.wd.find(x => x.account === puppetAddress && x.inputAmount.baseToken === token) ??
                            null
                        )
                      )
                    })({ changeDraft: changeDraftTether() })
                  }

                  const activeRules = p.rules.filter(rule => rule.allocationRate > 0n)
                  const pendingRules = p.draftRules.filter(rule => rule.allocationRate > 0n)
                  const $emptyBalances = $column(
                    spacing.small,
                    style({ padding: '8px 0', color: palette.foreground, fontSize: text.sm })
                  )(
                    $node(style({ color: palette.message, fontSize: text.base }))($text('No balances yet')),
                    $text(
                      'Find a trader worth following and we will prompt you to deposit, your capital then trades alongside theirs. Fund from any token, on any chain.'
                    ),
                    $navText('/leaderboard', 'Find traders to follow →')
                  )
                  const fundedIds = registeredIds.filter(
                    tid => (p.root?.balances.get(tid)?.signedBalance ?? 0n) > 0n
                  )
                  const $depositList =
                    fundedIds.length === 0
                      ? $emptyBalances
                      : switchLatest(
                          map(collateral => {
                            const ids = fundedIds.filter(tid => {
                              const token = p.registry.get(HUB_CHAIN_ID)?.get(tid)?.token
                              if (token === undefined) return false
                              if (token === PROTOCOL.nativeToken) return true
                              return collateral.length === 0 || collateral.some(c => isAddressEqual(c, token))
                            })
                            return $column(spacing.default)(...ids.map(tid => $balanceEditor(tid)))
                          }, collateralTokenList)
                        )

                  const fundStubBase = stubSubaccountState({ user: wallet.address, signer })
                  const $fundRows = (p.root?.funds ?? []).map(fund => {
                    // Multi-key CREATE2: each fund's address derives from its own
                    // {master, baseToken, name}, not the bare puppet account.
                    const fundAddress = predictFundAccount({
                      master: puppetAddress,
                      baseToken: fund.baseToken,
                      name: fund.name
                    })
                    const fundStub: ISubaccountState = {
                      ...fundStubBase,
                      account: fundAddress,
                      signer: puppetAddress,
                      isFund: true
                    }
                    const fundAccount: IStream<ISubaccountState> = op(
                      rootState,
                      map(root =>
                        root
                          ? {
                              ...fundStub,
                              funds: root.funds,
                              positions: root.positions,
                              chains: root.chains,
                              lastTransactionHash: root.lastTransactionHash
                            }
                          : fundStub
                      )
                    )
                    return $column(
                      spacing.tiny,
                      style({ flex: 1 })
                    )(
                      $card2(
                        style({
                          maxWidth: '520px',
                          width: '100%',
                          alignSelf: 'center',
                          borderRadius: '30px',
                          padding: '20px 24px',
                          border: `1px solid ${colorShade(palette.foreground, 25)}`,
                          display: 'flex',
                          flex: 1
                        })
                      )(
                        $FundEditor({
                          hideBalances,
                          account: fundAccount,
                          walletAccount: wallet,
                          tokenRegistry: p.registry,
                          fund: just({ master: puppetAddress, baseToken: fund.baseToken, name: fund.name }),
                          draft: map(list => list.find(d => d.account === fundAddress) ?? null, draftAllocateList),
                          redeemDraft: map(
                            list => list.find(d => d.masterAccount === fundAddress) ?? null,
                            draftRedeemList
                          ),
                          swapDraftList: draftSwapList
                        })({
                          changeDraft: changeMasterDraftTether(),
                          changeSwapDraft: changeSwapDraftTether(),
                          changeRedeemDraft: changeRedeemDraftTether(),
                          changeFulfillDraft: changeFulfillDraftTether()
                        })
                      )
                    )
                  })

                  const $subscriptionRow = (rule: ISubscribeRule): I$Node =>
                    $row(spacing.default, style({ alignItems: 'center' }))(
                      $navLink({
                        route: routeSchema.fund.detail,
                        params: { address: rule.fund },
                        $content: $fundProfileByAddress(rule.fund as Address)
                      }),
                      $SubscribeEditor({
                        master: rule.master,
                        name: rule.name,
                        collateralToken: rule.baseToken,
                        baseToken: rule.baseToken,
                        userMatchingRuleQuery,
                        draftMatchingRuleList,
                        label: 'Change',
                        showTokenIcon: false,
                        mini: true
                      })({ changeMatchRuleList: changeMatchRuleListTether() }),
                      $node(style({ color: palette.foreground, fontSize: text.sm, whiteSpace: 'nowrap' }))(
                        $text(`Allow ${readablePercentage(rule.allocationRate)}`),
                        rule.throttlePeriod > 0n
                          ? $node(style({ color: colorShade(palette.foreground, 60), fontSize: text.xs }))(
                              $text(` · max 1 / ${getDuration(Number(rule.throttlePeriod))}`)
                            )
                          : empty
                      ),
                      $node(style({ flex: 1 }))(),
                      $FundSell({
                        hideBalances,
                        puppet: puppetAddress,
                        masterAccount: rule.fund as Address,
                        baseToken: rule.baseToken,
                        tokenRegistry: p.registry,
                        position: op(
                          rootState,
                          map(root =>
                            root?.positions.find(pos => isAddressEqual(pos.fund as Address, rule.fund as Address))
                          )
                        )
                      })({ changeRedeemDraft: changeRedeemDraftTether() })
                    )

                  const subsByToken = new Map<Hex, ISubscribeRule[]>()
                  for (const rule of activeRules) {
                    const tid = rule.baseToken as Hex
                    const group = subsByToken.get(tid) ?? []
                    group.push(rule)
                    subsByToken.set(tid, group)
                  }
                  for (const rule of pendingRules) {
                    const tid = rule.baseToken as Hex
                    if (!subsByToken.has(tid)) subsByToken.set(tid, [])
                  }
                  const $subscriptionGroups = [...subsByToken.entries()].map(([, rules]) =>
                    $column(spacing.default)(
                      ...(rules.length > 0
                        ? rules.map($subscriptionRow)
                        : [
                            $node(style({ color: palette.foreground, fontSize: text.sm }))(
                              $text('A pending allocation in your cart will draw on this balance.')
                            )
                          ])
                    )
                  )

                  // Pending (cart-draft) rules carry no resolved fund address yet, so they contribute nothing to this
                  // already-ruled exclusion set; drop them before getAddress to avoid getAddress(undefined) throwing.
                  const ruledFunds = new Set(
                    [...activeRules, ...pendingRules].filter(r => r.fund).map(r => getAddress(r.fund as Address))
                  )
                  const fundById = new Map((p.root?.funds ?? []).map(f => [getAddress(f.fund as Address), f] as const))
                  const redemptionFunds: IFund[] = []
                  for (const pos of p.root?.positions ?? []) {
                    const fund = fundById.get(getAddress(pos.fund as Address))
                    if (!fund || ruledFunds.has(getAddress(fund.fund as Address))) continue
                    const surrender =
                      fund.liquidationRate !== 0n ? applyFactor(fund.liquidationRate, pos.sharesHeld) : 0n
                    if (computeClaimable(pos, fund) + surrender > 0n || computeQueuedShares(pos, fund) > 0n) {
                      redemptionFunds.push(fund)
                    }
                  }
                  const $redemptionRow = (fund: IFund): I$Node =>
                    $row(spacing.default, style({ alignItems: 'center' }))(
                      $navLink({
                        route: routeSchema.fund.detail,
                        params: { address: fund.fund as Address },
                        $content: $fundProfileByAddress(fund.fund as Address)
                      }),
                      $node(style({ flex: 1 }))(),
                      $FundSell({
                        hideBalances,
                        puppet: puppetAddress,
                        masterAccount: fund.fund as Address,
                        baseToken: tokenInfoFor(p.registry, HUB_CHAIN_ID, fund.baseToken as Hex).token,
                        tokenRegistry: p.registry,
                        position: op(
                          rootState,
                          map(root =>
                            root?.positions.find(pos => isAddressEqual(pos.fund as Address, fund.fund as Address))
                          )
                        )
                      })({ changeRedeemDraft: changeRedeemDraftTether() })
                    )

                  const $emptyHint = (label: string): I$Node =>
                    $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))

                  return $column(spacing.big, style({ padding: '16px 0' }))(
                    $column(spacing.default)(
                      $row(
                        spacing.small,
                        style({
                          alignItems: 'center',
                          paddingBottom: '12px',
                          borderBottom: `1px solid ${colorShade(palette.foreground, 15)}`
                        })
                      )(
                        $heading3($text('Balances')),
                        $infoTooltip(
                          $node(
                            style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm })
                          )(
                            $text(
                              'Your overall balance in the app, held by your smart account. It funds the traders you follow, drawn from this balance at match time. Deposit from any token on any chain, withdraw anytime.'
                            )
                          ),
                          colorShade(palette.foreground, 60),
                          '20px'
                        )
                      ),
                      $depositList
                    ),
                    $column(spacing.default)(
                      $row(
                        spacing.small,
                        style({
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: '12px',
                          borderBottom: `1px solid ${colorShade(palette.foreground, 15)}`
                        })
                      )(
                        $row(spacing.small, style({ alignItems: 'center' }))(
                          $icon({
                            $content: $puppeteer,
                            width: '18px',
                            viewBox: '0 0 32 32',
                            fill: palette.message,
                            svgOps: style({ display: 'block' })
                          }),
                          $heading3($text('Funds')),
                          $infoTooltip(
                            $node(
                              style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm })
                            )(
                              $text(
                                'Funds you run as the master trader. Each is a smart account that puppets fund; you trade the pooled capital on GMX and share in the performance.'
                              )
                            ),
                            colorShade(palette.foreground, 60),
                            '20px'
                          )
                        ),
                        $navText('/', '+ Create a Fund', () => {
                          let tries = 0
                          const scrollToQuickstart = () => {
                            const el = document.getElementById('hello-create')
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            else if (tries++ < 30) requestAnimationFrame(scrollToQuickstart)
                          }
                          requestAnimationFrame(scrollToQuickstart)
                        })
                      ),
                      ...($fundRows.length > 0
                        ? $fundRows
                        : [$emptyHint('No funds yet. Create one to get funded to trade.')])
                    ),
                    ...($subscriptionGroups.length === 0
                      ? []
                      : [
                          $column(spacing.default)(
                            $row(
                              spacing.small,
                              style({
                                alignItems: 'center',
                                paddingBottom: '12px',
                                borderBottom: `1px solid ${colorShade(palette.foreground, 15)}`
                              })
                            )(
                              $icon({
                                $content: $puppetLogo,
                                width: '18px',
                                viewBox: '0 0 32 32',
                                fill: palette.message,
                                svgOps: style({ display: 'block' })
                              }),
                              $heading3($text('Puppet Account')),
                              $infoTooltip(
                                $node(
                                  style({
                                    display: 'block',
                                    maxWidth: '280px',
                                    whiteSpace: 'normal',
                                    fontSize: text.sm
                                  })
                                )(
                                  $text(
                                    'Traders you fund, grouped by the token each fund trades in. Deposit that token here to fund the allocations under it; an unfunded allocation is simply skipped at match time.'
                                  )
                                ),
                                colorShade(palette.foreground, 60),
                                '20px'
                              )
                            ),
                            ...$subscriptionGroups
                          )
                        ]),
                    ...(redemptionFunds.length === 0
                      ? []
                      : [
                          $column(spacing.default)(
                            $row(
                              spacing.small,
                              style({
                                alignItems: 'center',
                                paddingBottom: '12px',
                                borderBottom: `1px solid ${colorShade(palette.foreground, 15)}`
                              })
                            )(
                              $heading3($text('Pending redemptions')),
                              $infoTooltip(
                                $node(
                                  style({
                                    display: 'block',
                                    maxWidth: '280px',
                                    whiteSpace: 'normal',
                                    fontSize: text.sm
                                  })
                                )(
                                  $text(
                                    'Funds you hold shares in or have queued to redeem, outside your active funding. Claim once the manager processes the queue.'
                                  )
                                ),
                                colorShade(palette.foreground, 60),
                                '20px'
                              )
                            ),
                            ...redemptionFunds.map($redemptionRow)
                          )
                        ])
                  )
                },
                skipRepeatsWith(
                  (a: IPortfolioSectionParams, b: IPortfolioSectionParams) =>
                    a.wallet?.address === b.wallet?.address &&
                    a.wallet?.session?.signer === b.wallet?.session?.signer &&
                    a.registry === b.registry &&
                    a.rules === b.rules &&
                    !!a.root === !!b.root &&
                    a.root?.signer === b.root?.signer &&
                    (a.root?.funds.length ?? 0) === (b.root?.funds.length ?? 0) &&
                    heldKey(a.root) === heldKey(b.root) &&
                    pendingSubKey(a.draftRules) === pendingSubKey(b.draftRules),
                  combine({
                    root: rootState,
                    registry: tokenRegistryValue,
                    wallet: walletState,
                    rules: switchPromises(userMatchingRuleQuery),
                    draftRules: draftMatchingRuleList
                  })
                )
              )
            )
          )
        ),
        {
          changeActivityTimeframe,
          selectCollateralTokenList,
          changeHideBalances,
          changeDraft,
          changeRedeemDraft,
          changeAllocateDraft: changeMasterDraft,
          changeSwapDraft,
          changeFulfillDraft,
          changeMatchRuleList
        }
      ]
    }
  )
