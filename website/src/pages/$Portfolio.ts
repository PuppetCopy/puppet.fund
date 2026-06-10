import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { predictPuppetAccount } from '@puppet/sdk/account'
import type { IntervalTime } from '@puppet/sdk/const'
import { getDuration, readablePercentage } from '@puppet/sdk/core'
import { type ISubaccountState, stubSubaccountState } from '@puppet/sdk/state'
import { combine, empty, type IStream, just, map, nowWith, op, start, switchLatest, switchPromises } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { pushUrl } from 'aelea/ui-router'
import { isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { $arrowRight, $icon, $infoLabel, $infoTooltip, $navLink, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2 } from '../common/elements/$common.js'
import { $profileDisplay } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $usdTimeline, type ITimelinePoint } from '../components/participant/$ProfilePeformanceTimeline.js'
import { $AllocateEditor } from '../components/portfolio/$AllocateEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IDepositDraft,
  IFulfillDraft,
  ISellDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import * as context from '../io/context.js'
import { fetchMasterPoolState, fetchPuppetBalanceTimeline, type ISubscribeRule } from '../io/indexer/query.js'
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
      label: 'Portfolio',
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
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  subaccountList: IStream<Promise<ISubaccountState[]>>
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
}

export const $Portfolio = ({
  activityTimeframe,
  collateralTokenList,
  walletQuery,
  subaccountList,
  userMatchingRuleQuery,
  draftDepositList,
  draftWithdrawList,
  draftAllocateList
}: I$Portfolio) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, _selectIndexTokenListTether]: IBehavior<Address[]>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IFulfillDraft>,
      // Wiring this through is what subscribes $WalletConnect's click → map(connectWallet)
      // operator chain. Without it, button clicks don't fire connect. Value is unused here.
      [_connect, connectTether]: IBehavior<ReturnType<typeof connectWallet>>
    ) => {
      const registeredCollateralList = switchPromises(context.registeredCollateralListQuery)
      const walletState: IStream<IConnectedWallet | null> = op(walletQuery, switchPromises, state())
      const subaccountListState: IStream<ISubaccountState[]> = op(subaccountList, switchPromises, state())
      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)

      const balanceTimelineQuery: IStream<Promise<ITimelinePoint[]>> = op(
        combine({ tf: activityTimeframe, accounts: subaccountListState }),
        map(p => fetchPuppetBalanceTimeline(p.accounts, p.tf))
      )

      const $lead = $row(style({ flex: 1 }))(
        $SelectCollateralToken({ selectedList: collateralTokenList, tokenList: registeredCollateralList })({
          changeCollateralTokenList: selectCollateralTokenListTether()
        })
      )

      const $sectionLabel = (label: string): I$Node =>
        $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500', letterSpacing: '0.5px' }))(
          $text(label)
        )

      const $fundProfile = (fundAddress: Address): I$Node =>
        switchLatest(
          map(
            fund =>
              $profileDisplay({
                address: fundAddress,
                name: fund?.name,
                profileSize: 36,
                $avatar: $roboAvatar((fund?.shareToken ?? fundAddress) as Address, 36)
              }),
            op(just(fetchMasterPoolState(fundAddress)), switchPromises, start(undefined))
          )
        )

      const $accountSeparator = () =>
        $node(style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 12) }))()

      return [
        $column(spacing.default)(
          $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm, color: palette.foreground }))(
            $element('a')(
              attr({ href: '/' }),
              style({ color: colorShade(palette.message, 85), cursor: 'pointer' }),
              stylePseudo(':hover', { color: palette.message }),
              effectProp(
                'onclick',
                nowWith(() => (ev: MouseEvent) => {
                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                  ev.preventDefault()
                  pushUrl('/')
                })
              )
            )($text('Leaderboard')),
            $icon({ $content: $arrowRight, fill: palette.foreground, width: '8px' }),
            $node(style({ color: palette.message }))($text('Portfolio')),
            $node(style({ flex: 1 }))(),
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
                p => {
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
                  const existingSigner = p.accounts.find(a => a.user && isAddressEqual(a.user, wallet.address))?.signer
                  const signer = wallet.session?.signer ?? existingSigner ?? wallet.address
                  const puppetAddress = predictPuppetAccount({ user: wallet.address, signer })
                  const lateBindDerivation = wallet.session ? undefined : { user: wallet.address }
                  const puppetAccount: IStream<ISubaccountState> = op(
                    subaccountListState,
                    map(
                      list =>
                        list.find(b => isAddressEqual(b.account, puppetAddress)) ??
                        stubSubaccountState({ user: wallet.address, signer })
                    )
                  )
                  const registeredIds = [...(p.registry.get(HUB_CHAIN_ID)?.keys() ?? [])]
                  // The puppet account is often just a controller (masters allocate straight
                  // from the wallet), so zero-balance rows are noise: list only held tokens
                  // and hide the whole section when there are none.
                  const puppetSnapshot = p.accounts.find(b => isAddressEqual(b.account, puppetAddress))
                  const heldIds = registeredIds.filter(
                    tid => (puppetSnapshot?.balances.get(tid)?.signedBalance ?? 0n) > 0n
                  )

                  const $balanceRows = heldIds.map(tokenId =>
                    $TokenBalanceEditor({
                      accountState: puppetAccount,
                      baseTokenId: tokenId,
                      tokenRegistry: p.registry,
                      walletAccount: wallet,
                      lateBindDerivation,
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
                  )

                  const funds = p.accounts.filter(a => a.isFund)
                  const $fundRows = funds.map(acc => {
                    const account: IStream<ISubaccountState> = op(
                      subaccountListState,
                      map(list => list.find(b => isAddressEqual(b.account, acc.account)) ?? acc)
                    )
                    return $node(style({ display: 'flex', flex: 1 }))(
                      $AllocateEditor({
                        account,
                        walletAccount: wallet,
                        tokenRegistry: p.registry,
                        draft: map(list => list.find(d => d.account === acc.account) ?? null, draftAllocateList),
                        $profile: $navLink({
                          route: routeSchema.master.detail,
                          params: { address: acc.account },
                          $content: $fundProfile(acc.account)
                        })
                      })({
                        changeDraft: changeMasterDraftTether(),
                        changeRedeemDraft: changeRedeemDraftTether(),
                        changeFulfillDraft: changeFulfillDraftTether()
                      })
                    )
                  })

                  const activeRules = p.rules.filter(rule => rule.allocationRate > 0n)
                  const $subscriptionRows = activeRules.map(rule =>
                    $row(spacing.big, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                      $navLink({
                        route: routeSchema.master.detail,
                        params: { address: rule.fund },
                        $content: $fundProfile(rule.fund as Address)
                      }),
                      $node(style({ color: palette.foreground, fontSize: text.sm }))(
                        $text(
                          `${readablePercentage(rule.allocationRate)} per match, at most every ${getDuration(Number(rule.throttlePeriod))}`
                        )
                      )
                    )
                  )

                  const $emptyHint = (label: string): I$Node =>
                    $node(style({ color: palette.foreground, fontSize: text.sm }))($text(label))

                  return $column(spacing.big, style({ padding: '16px 0' }))(
                    ...(heldIds.length === 0
                      ? []
                      : [
                          $column(spacing.default)(
                            $row(spacing.tiny, style({ alignItems: 'center' }))(
                              $sectionLabel('Balances'),
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
                          ),
                          $accountSeparator()
                        ]),
                    $column(spacing.default)(
                      $sectionLabel('Your funds'),
                      ...($fundRows.length > 0
                        ? $fundRows
                        : [$emptyHint('No funds yet. Create one to get backed to trade.')]),
                      $row(style({ placeContent: 'flex-end' }))(
                        $element('a')(
                          attr({ href: '/hello' }),
                          style({
                            color: colorShade(palette.message, 85),
                            fontSize: text.sm,
                            textDecoration: 'none',
                            cursor: 'pointer'
                          }),
                          stylePseudo(':hover', { color: palette.message }),
                          effectProp(
                            'onclick',
                            nowWith(() => (ev: MouseEvent) => {
                              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
                              ev.preventDefault()
                              pushUrl('/hello')
                            })
                          )
                        )($text('+ Create fund'))
                      )
                    ),
                    $accountSeparator(),
                    $column(spacing.default)(
                      $sectionLabel('Subscriptions'),
                      ...($subscriptionRows.length > 0
                        ? $subscriptionRows
                        : [$emptyHint('Not copying any traders yet. Pick them on the leaderboard.')])
                    )
                  )
                },
                combine({
                  accounts: subaccountListState,
                  registry: tokenRegistryValue,
                  wallet: walletState,
                  rules: switchPromises(userMatchingRuleQuery)
                })
              )
            )
          )
        ),
        {
          changeActivityTimeframe,
          selectCollateralTokenList,
          selectIndexTokenList,
          changeDraft,
          changeRedeemDraft,
          changeAllocateDraft: changeMasterDraft,
          changeFulfillDraft
        }
      ]
    }
  )
