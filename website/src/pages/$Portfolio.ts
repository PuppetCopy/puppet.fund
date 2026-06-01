import type { IntervalTime } from '@puppet/sdk/const'
import type { ISubaccountState, ITokenRegistryMap } from '@puppet/sdk/state'
import { combine, filter, type IStream, map, nowWith, op, switchLatest, switchPromises } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { pushUrl } from 'aelea/ui-router'
import { isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { $arrowRight, $icon, $infoLabel, $Link, text } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $heading3 } from '../common/$text.js'
import { $card, $card2 } from '../common/elements/$common.js'
import { $profileDisplay } from '../components/$AccountProfile.js'
import { $SelectCollateralToken } from '../components/$CollateralTokenSelector.js'
import { $usdTimeline, type ITimelinePoint } from '../components/participant/$ProfilePeformanceTimeline.js'
import { $MasterAccountEditor } from '../components/portfolio/$MasterAccountEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  ICreateMasterDraft,
  IDepositDraft,
  IFulfillDraft,
  ISellDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import * as context from '../io/context.js'
import { fetchPuppetBalanceTimeline } from '../io/indexer/query.js'
import type { IConnectedWallet } from '../wallet/index.js'
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
      tooltip: 'Your total value in USD — account balance plus the marked value of open positions',
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
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  subaccountList: IStream<Promise<ISubaccountState[]>>
  activeMaster: IStream<Address | null>
}

export const $Portfolio = ({
  activityTimeframe,
  collateralTokenList,
  walletQuery,
  subaccountList,
  activeMaster,
  draftDepositList,
  draftWithdrawList
}: I$Portfolio) =>
  component(
    (
      [changeActivityTimeframe, changeActivityTimeframeTether]: IBehavior<any, IntervalTime>,
      [selectCollateralTokenList, selectCollateralTokenListTether]: IBehavior<Address[]>,
      [selectIndexTokenList, _selectIndexTokenListTether]: IBehavior<Address[]>,
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft | ICreateMasterDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IFulfillDraft>
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

      const $accountRow = (acc: ISubaccountState, registry: ITokenRegistryMap, wallet: IConnectedWallet): I$Node => {
        const account: IStream<ISubaccountState> = op(
          subaccountListState,
          map(list => list.find(b => isAddressEqual(b.account, acc.account)) ?? acc)
        )
        const $typeChip = $node(
          style({
            fontSize: text.xs,
            color: palette.foreground,
            border: `1px solid ${colorShade(palette.foreground, 30)}`,
            borderRadius: '100px',
            padding: '2px 10px'
          })
        )($text(acc.isMaster ? 'Master' : 'Puppet'))
        const $editor = acc.isMaster
          ? $MasterAccountEditor({ account, walletAccount: wallet, tokenRegistry: registry, activeMaster })({
              changeDraft: changeMasterDraftTether(),
              changeRedeemDraft: changeRedeemDraftTether(),
              changeFulfillDraft: changeFulfillDraftTether()
            })
          : $TokenBalanceEditor({
              accountState: account,
              tokenRegistry: registry,
              walletAccount: wallet,
              draft: op(
                combine({ dep: draftDepositList, wd: draftWithdrawList }),
                map(
                  p => p.dep.find(d => d.account === acc.account) ?? p.wd.find(d => d.account === acc.account) ?? null
                )
              )
            })({ changeDraft: changeDraftTether() })
        const $profile = $profileDisplay({ address: acc.account, name: acc.name, profileSize: 36 })
        return $row(spacing.big, style({ alignItems: 'center', flexWrap: 'wrap' }))(
          acc.isMaster
            ? $Link({ route: routeSchema.master.detail, params: { address: acc.account }, $content: $profile })({})
            : $profile,
          $editor,
          $node(style({ flex: 1 }))(),
          $typeChip
        )
      }

      const $accountSeparator = () =>
        $node(style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 12) }))()

      return [
        $column(spacing.default)(
          $row(
            spacing.small,
            style({ alignItems: 'center', paddingLeft: '20px', fontSize: text.sm, color: palette.foreground })
          )(
            $element('a')(
              attr({ href: '/' }),
              style({ color: palette.foreground, cursor: 'pointer' }),
              stylePseudo(':hover', { color: colorShade(palette.primary, 50) }),
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
            $node(style({ color: palette.message }))($text('Portfolio'))
          ),
          $card(spacing.big, style({ flex: 1, width: '100%' }))(
            $timelineCard(balanceTimelineQuery, activityTimeframe, $lead, changeActivityTimeframeTether),
            switchLatest(
              map(
                p => {
                  if (!p.wallet) return $infoLabel($text('Connect your wallet to view your accounts'))
                  if (p.accounts.length === 0) return $infoLabel($text('No accounts yet'))
                  const wallet = p.wallet
                  return $column(
                    spacing.big,
                    style({ padding: '16px 0' })
                  )(
                    ...p.accounts.flatMap((acc, i) =>
                      i === 0
                        ? [$accountRow(acc, p.registry, wallet)]
                        : [$accountSeparator(), $accountRow(acc, p.registry, wallet)]
                    )
                  )
                },
                combine({ accounts: subaccountListState, registry: tokenRegistryValue, wallet: walletState })
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
          changeCreateMasterDraft: filter((d): d is ICreateMasterDraft => d.kind === 'createMaster', changeMasterDraft),
          changeAllocateDraft: filter((d): d is IAllocateDraft => d.kind === 'allocate', changeMasterDraft),
          changeFulfillDraft
        }
      ]
    }
  )
