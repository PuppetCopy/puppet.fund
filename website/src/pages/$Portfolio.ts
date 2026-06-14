import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import { getDuration, readablePercentage } from '@puppet/sdk/core'
import { type ISubaccountState, type ITokenRegistryMap, stubSubaccountState } from '@puppet/sdk/state'
import {
  combine,
  empty,
  type IStream,
  just,
  map,
  nowWith,
  op,
  skipRepeatsWith,
  start,
  switchLatest,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  component,
  effectProp,
  type I$Node,
  style,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { pushUrl } from 'aelea/ui-router'
import type { Hex } from 'viem'
import type { Address } from 'viem/accounts'
import {
  $arrowRight,
  $balanceVisibilityToggle,
  $icon,
  $infoLabel,
  $infoTooltip,
  $navLink,
  $puppeteer,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2 } from '../common/elements/$common.js'
import { $fundProfile, $profileDisplay, readableAccountName } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $usdTimeline, type ITimelinePoint } from '../components/participant/$ProfilePeformanceTimeline.js'
import { $FundEditor } from '../components/portfolio/$FundEditor.js'
import { $SubscribeEditor } from '../components/portfolio/$SubscribeEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IDepositDraft,
  IRedeemDraft,
  ISellDraft,
  ISwapDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import * as context from '../io/context.js'
import { fetchMasterPoolState, fetchPuppetBalanceTimeline, type ISubscribeRule } from '../io/indexer/query.js'
import { sqlClient } from '../io/indexer/sql.js'
import {
  type connectWallet,
  disconnect,
  type IConnectedWallet,
  refreshWallet,
  revokeSessionKey
} from '../wallet/index.js'
import type { IPageFilterParams } from './types.js'

const $timelineCard = (
  timelineQuery: IStream<Promise<ITimelinePoint[]>>,
  activityTimeframe: IStream<IntervalTime>,
  $lead: I$Node,
  changeActivityTimeframeTether: IBehavior<any, IntervalTime>[1]
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
      timelineQuery,
      label: 'Wallet Page',
      tooltip: 'Your total value in USD: account balance plus the marked value of open positions',
      activityTimeframe,
      $lead,
      $empty: $column(
        spacing.small,
        style({ alignItems: 'center', textAlign: 'center', color: palette.foreground, fontSize: text.sm })
      )($heading3($text('No Activity Found')))
    })({ changeActivityTimeframe: changeActivityTimeframeTether() })
  )

interface I$Portfolio extends IPageFilterParams {
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  draftAllocateList: IStream<IAllocateDraft[]>
  draftRedeemList: IStream<IRedeemDraft[]>
  draftSwapList: IStream<ISwapDraft[]>
  draftMatchingRuleList: IStream<ISubscribeRule[]>
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<ISubaccountState | null>
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
}

export const $Portfolio = ({
  activityTimeframe,
  collateralTokenList,
  walletQuery,
  walletState: rootState,
  userMatchingRuleQuery,
  draftDepositList,
  draftWithdrawList,
  draftAllocateList,
  draftRedeemList,
  draftSwapList,
  draftMatchingRuleList
}: I$Portfolio) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<ISwapDraft>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>,
      [_connect, connectTether]: IBehavior<ReturnType<typeof connectWallet>>
    ) => {
      const registeredCollateralList = switchPromises(context.registeredCollateralListQuery)
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
        [...new Set(rules.filter(r => r.allocationRate > 0n).map(r => r.baseTokenId))].sort().join(',')
      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)

      const balanceTimelineQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ tf: activityTimeframe, root: rootState }),
        map(p => fetchPuppetBalanceTimeline(p.root ? [p.root] : [], p.tf))
      )

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
                ? $fundProfile({ master: fund.master, baseTokenId: fund.baseTokenId, name: fund.name }, 36)
                : $profileDisplay({ address: fundAddress, profileSize: 36 }),
            op(just(fetchMasterPoolState(fundAddress)), switchPromises, start(undefined))
          )
        )

      const $accountSeparator = () =>
        $node(style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 12) }))()

      return [
        $column(spacing.default)(
          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
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
            $node(style({ color: palette.message }))($text('Wallet Page')),
            $node(style({ flex: 1 }))(),
            $balanceVisibilityToggle(),
            switchLatest(
              map(
                wallet =>
                  wallet
                    ? $node(
                        attr({ role: 'button', tabindex: '0' }),
                        style({ color: palette.foreground, cursor: 'pointer' }),
                        stylePseudo(':hover', { color: palette.message }),
                        effectProp(
                          'onclick',
                          nowWith(() => async () => {
                            revokeSessionKey(wallet.address)
                            await disconnect()
                            refreshWallet()
                          })
                        )
                      )($text('Disconnect'))
                    : empty,
                walletState
              )
            )
          ),
          $card(spacing.big, style({ flex: 1, width: '100%' }))(
            $timelineCard(balanceTimelineQuery, activityTimeframe, $lead, changeActivityTimeframeTether),
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
                        $text('Connect your wallet to see your accounts, balances and open positions.')
                      ),
                      $WalletConnect()({ connect: connectTether() })
                    )
                  const wallet = p.wallet
                  const signer = wallet.session?.signer ?? p.root?.signer ?? wallet.address
                  const puppetAddress = predictPuppetAccount({ user: wallet.address, signer })
                  const lateBindDerivation = wallet.session ? undefined : { user: wallet.address }
                  const puppetAccount: IStream<ISubaccountState> = op(
                    rootState,
                    map(root => root ?? stubSubaccountState({ user: wallet.address, signer }))
                  )
                  const registeredIds = [...(p.registry.get(HUB_CHAIN_ID)?.keys() ?? [])]
                  // The puppet account is often just a controller (masters allocate straight
                  // from the wallet), so zero-balance rows are noise: list only held tokens
                  // and hide the whole section when there are none.
                  const puppetSnapshot = p.root

                  const $balanceEditor = (tokenId: Hex, inlineNote?: string): I$Node =>
                    $TokenBalanceEditor({
                      accountState: puppetAccount,
                      baseTokenId: tokenId,
                      tokenRegistry: p.registry,
                      walletAccount: wallet,
                      lateBindDerivation,
                      inlineNote,
                      draft: op(
                        combine({ dep: draftDepositList, wd: draftWithdrawList }),
                        map(
                          d =>
                            d.dep.find(x => x.account === puppetAddress && x.inputAmount.baseTokenId === tokenId) ??
                            d.wd.find(x => x.account === puppetAddress && x.inputAmount.baseTokenId === tokenId) ??
                            null
                        )
                      )
                    })({ changeDraft: changeDraftTether() })

                  const activeRules = p.rules.filter(rule => rule.allocationRate > 0n)
                  const pendingRules = p.draftRules.filter(rule => rule.allocationRate > 0n)
                  const subscriptionTokenIds = new Set(
                    [...activeRules, ...pendingRules].map(rule => rule.baseTokenId as Hex)
                  )
                  const heldIds = registeredIds.filter(
                    tid =>
                      (puppetSnapshot?.balances.get(tid)?.signedBalance ?? 0n) > 0n && !subscriptionTokenIds.has(tid)
                  )

                  const $balanceRows = heldIds.map(tid => $balanceEditor(tid))

                  const fundAddress = predictFundAccount(puppetAddress)
                  const fundStubBase = stubSubaccountState({ user: wallet.address, signer })
                  const $fundRows = (p.root?.funds ?? []).map(fund => {
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
                    return $column(spacing.tiny, style({ flex: 1 }))(
                      $card2(
                        style({
                          borderRadius: '30px',
                          padding: '20px 24px',
                          border: `1px solid ${colorShade(palette.foreground, 25)}`,
                          display: 'flex',
                          flex: 1
                        })
                      )(
                        $FundEditor({
                          account: fundAccount,
                          walletAccount: wallet,
                          tokenRegistry: p.registry,
                          initialBaseTokenId: just(fund.baseTokenId),
                          fundName: just(readableAccountName(fund.name) ?? ''),
                          draft: map(list => list.find(d => d.account === fundAddress) ?? null, draftAllocateList),
                          redeemDraft: map(
                            list => list.find(d => d.masterAccount === fundAddress) ?? null,
                            draftRedeemList
                          ),
                          swapDraftList: draftSwapList,
                          $stubAnchor: ($aumDisplay, $depositButton, $withdrawButton, $stakeDisplay) =>
                            $row(spacing.big, style({ alignItems: 'center', width: '100%' }))(
                              $column(
                                spacing.small,
                                style({ alignItems: 'flex-start', minWidth: '0' })
                              )(
                                $navLink({
                                  route: routeSchema.fund.detail,
                                  params: { address: fundAddress },
                                  $content: $fundProfile(
                                    { master: puppetAddress, baseTokenId: fund.baseTokenId, name: fund.name },
                                    48
                                  )
                                })
                              ),
                              $row(spacing.default, style({ alignItems: 'center' }))(
                                $column(style({ gap: '2px', alignItems: 'flex-end' }))(
                                  $node(style({ color: palette.foreground, fontSize: text.xs }))($text('AUM')),
                                  $aumDisplay
                                ),
                                $column(spacing.small, style({ alignItems: 'flex-end' }))(
                                  $depositButton,
                                  $withdrawButton
                                )
                              ),
                              $node(style({ flex: 1 }))(),
                              $column(style({ gap: '2px', alignItems: 'flex-end' }))(
                                $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Balance')),
                                $stakeDisplay
                              )
                            )
                        })({
                          changeDraft: changeMasterDraftTether(),
                          changeRedeemDraft: changeRedeemDraftTether(),
                          changeFulfillDraft: changeFulfillDraftTether(),
                          changeSwapDraft: changeSwapDraftTether()
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
                        collateralToken: rule.baseToken,
                        baseTokenId: rule.baseTokenId,
                        userMatchingRuleQuery,
                        draftMatchingRuleList,
                        label: 'Change',
                        showTokenIcon: false
                      })({ changeMatchRuleList: changeMatchRuleListTether() }),
                      $node(style({ flex: 1 }))(),
                      $node(style({ color: palette.foreground, fontSize: text.sm, whiteSpace: 'nowrap' }))(
                        $text(`Allow ${readablePercentage(rule.allocationRate)}`),
                        rule.throttlePeriod > 0n
                          ? $node(style({ color: colorShade(palette.foreground, 60), fontSize: text.xs }))(
                              $text(` · max 1 / ${getDuration(Number(rule.throttlePeriod))}`)
                            )
                          : empty
                      )
                    )

                  const subsByToken = new Map<Hex, ISubscribeRule[]>()
                  for (const rule of activeRules) {
                    const tid = rule.baseTokenId as Hex
                    const group = subsByToken.get(tid) ?? []
                    group.push(rule)
                    subsByToken.set(tid, group)
                  }
                  for (const rule of pendingRules) {
                    const tid = rule.baseTokenId as Hex
                    if (!subsByToken.has(tid)) subsByToken.set(tid, [])
                  }
                  const $subscriptionGroups = [...subsByToken.entries()].map(([tokenId, rules]) =>
                    $column(spacing.default)(
                      $balanceEditor(tokenId, 'Funds your account, not the trader'),
                      $column(
                        spacing.default,
                        style({
                          paddingLeft: '14px',
                          marginLeft: '10px',
                          borderLeft: `1px solid ${colorShade(palette.foreground, 15)}`
                        })
                      )(
                        ...(rules.length > 0
                          ? rules.map($subscriptionRow)
                          : [
                              $node(style({ color: palette.foreground, fontSize: text.sm }))(
                                $text('A pending copy in your cart will draw on this balance.')
                              )
                            ])
                      )
                    )
                  )

                  const $emptyHint = (label: string): I$Node =>
                    $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))

                  return $column(spacing.big, style({ padding: '16px 0' }))(
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
                          $heading3($text('Fund Subaccounts')),
                          $infoTooltip(
                            $node(
                              style({ display: 'block', maxWidth: '280px', whiteSpace: 'normal', fontSize: text.sm })
                            )(
                              $text(
                                'Funds you run as the master trader. Each is a smart account that backers allocate into to copy your trades; you trade the pooled capital on GMX and share in the performance.'
                              )
                            ),
                            colorShade(palette.foreground, 60),
                            '20px'
                          )
                        ),
                        $element('a')(
                          attr({ href: '/' }),
                          style({
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            color: palette.message,
                            fontSize: text.sm,
                            fontWeight: '600',
                            textDecoration: 'none',
                            cursor: 'pointer',
                            padding: '5px 13px',
                            borderRadius: '100px',
                            border: `1px solid ${colorShade(palette.foreground, 40)}`
                          }),
                          stylePseudo(':hover', {
                            color: palette.primary,
                            borderColor: palette.primary,
                            backgroundColor: colorShade(palette.primary, 10)
                          }),
                          effectProp(
                            'onclick',
                            nowWith(() => (ev: MouseEvent) => {
                              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                              ev.preventDefault()
                              pushUrl('/')
                              let tries = 0
                              const scrollToQuickstart = () => {
                                const el = document.getElementById('hello-create')
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                else if (tries++ < 30) requestAnimationFrame(scrollToQuickstart)
                              }
                              requestAnimationFrame(scrollToQuickstart)
                            })
                          )
                        )($text('+ Create fund'))
                      ),
                      ...($fundRows.length > 0
                        ? $fundRows
                        : [$emptyHint('No funds yet. Create one to get backed to trade.')])
                    ),
                    ...(heldIds.length === 0
                      ? []
                      : [
                          $accountSeparator(),
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
                                  style({
                                    display: 'block',
                                    maxWidth: '280px',
                                    whiteSpace: 'normal',
                                    fontSize: text.sm
                                  })
                                )(
                                  $text(
                                    'Your overall balance in the app, held by your smart account. It is primarily used for funding: seeding your own fund and matching the traders you copy. Deposit from any token on any chain, withdraw anytime.'
                                  )
                                ),
                                colorShade(palette.foreground, 60),
                                '20px'
                              )
                            ),
                            ...$balanceRows
                          )
                        ]),
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
                                    'Traders you copy, grouped by the token each fund trades in. Deposit that token here to fund the copies under it; an unfunded copy is simply skipped at match time.'
                                  )
                                ),
                                colorShade(palette.foreground, 60),
                                '20px'
                              )
                            ),
                            ...$subscriptionGroups
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
          changeDraft,
          changeRedeemDraft,
          changeAllocateDraft: changeMasterDraft,
          changeFulfillDraft,
          changeSwapDraft,
          changeMatchRuleList
        }
      ]
    }
  )
