import { predictPuppetAccount } from '@puppet/sdk/account'
import { formatFixed, getMasterMatchingKey } from '@puppet/sdk/core'
import {
  awaitPromises,
  combine,
  empty,
  type IStream,
  map,
  op,
  sampleMap,
  switchMap,
  switchPromises,
  tap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attrBehavior, component, type INodeCompose, style, styleBehavior } from 'aelea/ui'
import { $defaultButtonContainer, $Popover, $row, isDesktopScreen, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Hex } from 'viem'
import { isAddressEqual } from 'viem'
import type { Address } from 'viem/accounts'
import { $ButtonSecondary, $caretDown, $defaultMiniButtonSecondary, $icon, $popoverCaret, text } from '@/ui-components'
import { $tokenIconByAddress } from '../../common/$common.js'
import { $responsiveFlex } from '../../common/elements/$common.js'
import { $separator2 } from '../../pages/common.js'
import { walletQuery } from '../../wallet/index.js'
import { $MatchingRuleEditor, type ISubscribeRule } from './$MatchingRuleEditor.js'

interface I$SubscribeEditor {
  master: Address
  name: Hex
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  collateralToken: Address
  baseToken: Hex
  draftMatchingRuleList: IStream<ISubscribeRule[]>
  $container?: INodeCompose
  prominent?: boolean
  label?: string
  showTokenIcon?: boolean
  mini?: boolean
}

export const $defaultSubscribeEditorContainer = $row(spacing.small, style({ alignItems: 'center' }))

export const $SubscribeEditor = (config: I$SubscribeEditor) =>
  component(
    (
      [popRouteSubscriptionEditor, popRouteSubscriptionEditorTether]: IBehavior<PointerEvent>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>
    ) => {
      const masterMatchingKey = getMasterMatchingKey(config.collateralToken, config.master)

      const {
        $container = $defaultSubscribeEditorContainer,
        draftMatchingRuleList,
        master,
        name,
        collateralToken,
        baseToken,
        userMatchingRuleQuery,
        prominent = false,
        label,
        showTokenIcon = true,
        mini = false
      } = config

      // Own-fund check reads ONLY the live wallet's session — never lastStoredSession(): a stored session resurrects a
      // previous account as if connected, so after a wallet-account switch this would compare the new fund against the
      // stale user's PA. With no live session the viewer can't own this fund, so Follow stays enabled. Seed false ("not
      // your own fund until proven") because the button is a lazily-mounted popover target binding `disabled` here — a
      // no-initial state() would render it in its default (non-enabled) state until walletQuery resolves; a new user must
      // be able to open Follow, set a rule, and add it to the cart (the subscribe intent onboards them, create-on-missing).
      const isOwnFund: IStream<boolean> = op(
        walletQuery,
        switchPromises,
        map(wallet => {
          if (!wallet?.session) return false
          return isAddressEqual(predictPuppetAccount({ user: wallet.session.user, signer: wallet.session.signer }), master)
        }),
        state(false)
      )

      const activeRule = op(
        userMatchingRuleQuery,
        map(async listQuery => {
          const list = await listQuery.catch(() => [] as ISubscribeRule[])
          return list.find(mr => getMasterMatchingKey(mr.baseToken, mr.master) === masterMatchingKey)
        }),
        awaitPromises
      )

      const matchingRule = op(
        combine({ active: activeRule, draftList: draftMatchingRuleList }),
        map(p => p.draftList.find(d => d.masterMatchingKey === masterMatchingKey) ?? p.active)
      )

      const subscriptionState = op(
        combine({ rule: matchingRule, draftList: draftMatchingRuleList, own: isOwnFund }),
        map(params => {
          const hasDraft = params.draftList.some(draft => draft.masterMatchingKey === masterMatchingKey)
          const hasActiveRule = params.rule && params.rule.allocationRate > 0n
          const rateText =
            params.rule?.allocationRate
              ? `${Math.round(formatFixed(4, params.rule.allocationRate) * 10000) / 100}%`
              : '0%'

          if (hasDraft) {
            return {
              status: 'pending' as const,
              label: label ?? rateText,
              ariaLabel: 'Allocation change pending in cart for this trader'
            }
          }
          if (hasActiveRule) {
            return {
              status: 'active' as const,
              label: label ?? (prominent ? `(${rateText})` : `${rateText}`),
              ariaLabel: `Currently funding this trader at ${rateText} allocation. Activate to edit.`
            }
          }
          return {
            status: 'none' as const,
            label: 'Follow',
            ariaLabel: 'Not following this trader. Activate to set a funding rule.'
          }
        }),
        state()
      )

      const borderColorStyle = map(state => {
        if (state.status === 'pending') return { borderColor: `${palette.indeterminate} !important` }
        if (state.status === 'active') return { borderColor: `${palette.primary} !important` }
        return null
      }, subscriptionState)

      const $statusMark = switchMap(state => {
        if (state.status === 'active') {
          return empty
        }
        if (state.status === 'pending') {
          return $node(
            style({
              width: isDesktopScreen ? '10px' : '8px',
              height: isDesktopScreen ? '10px' : '8px',
              minWidth: isDesktopScreen ? '10px' : '8px',
              borderRadius: '50%',
              backgroundColor: palette.indeterminate
            })
          )()
        }
        return empty
      }, subscriptionState)

      return [
        $Popover({
          $container,
          $open: op(
            popRouteSubscriptionEditor,
            sampleMap(match => {
              return $MatchingRuleEditor({
                draftMatchingRuleList,
                model: match,
                masterMatchingKey,
                baseToken: collateralToken,
                master,
                name
              })({
                changeMatchRuleList: changeMatchRuleListTether()
              })
            }, matchingRule)
          ),
          dismiss: changeMatchRuleList,
          $target: (mini
            ? $ButtonSecondary({
                disabled: isOwnFund,
                $content: $row(spacing.tiny, style({ alignItems: 'center' }))(
                  $statusMark,
                  $text(map(state => state.label, subscriptionState)),
                  $popoverCaret()
                ),
                $container: $defaultMiniButtonSecondary(styleBehavior(borderColorStyle))
              })
            : $ButtonSecondary({
                disabled: isOwnFund,
                $content: $responsiveFlex(style({ alignItems: 'center', gap: isDesktopScreen ? '6px' : '4px' }))(
                  $row(style({ alignItems: 'center', gap: '4px' }))(
                    showTokenIcon
                      ? $node(
                          style({
                            display: 'flex',
                            position: 'relative',
                            zIndex: 1,
                            marginLeft: isDesktopScreen ? (prominent ? '-12px' : '-14px') : '-10px'
                          })
                        )($tokenIconByAddress(collateralToken, isDesktopScreen ? '30px' : '26px'))
                      : empty,
                    isMobileScreen ? $statusMark : empty,
                    isMobileScreen
                      ? $icon({
                          $content: $caretDown,
                          width: '12px',
                          svgOps: style({ marginLeft: '4px', minWidth: '8px' }),
                          viewBox: '0 0 32 32'
                        })
                      : empty
                  ),
                  showTokenIcon ? $separator2 : empty,
                  $row(style({ alignItems: 'center', gap: '6px' }))(
                    isDesktopScreen ? $statusMark : empty,
                    $text(map(state => state.label, subscriptionState)),
                    isDesktopScreen
                      ? $icon({
                          $content: $caretDown,
                          width: '8px',
                          svgOps: style({ marginTop: '2px', minWidth: '8px' }),
                          viewBox: '0 0 32 32'
                        })
                      : empty
                  )
                ),
                $container: $defaultButtonContainer(
                  style({ position: 'relative', overflow: 'visible' }),
                  style({
                    color: palette.message,
                    whiteSpace: 'nowrap',
                    fill: 'white',
                    borderStyle: 'solid',
                    alignSelf: 'center',
                    fontSize: prominent ? text.base : text.xs,
                    backgroundColor: prominent ? palette.primary : palette.background,
                    fontWeight: 'bold',
                    borderWidth: '1px',
                    borderColor: prominent ? palette.primary : colorShade(palette.foreground, 40)
                  }),
                  isDesktopScreen
                    ? style({
                        borderRadius: '100px',
                        padding: prominent ? '0 8px' : '2px 10px',
                        height: 'auto'
                      })
                    : style({
                        borderRadius: '8px',
                        padding: '4px 8px',
                        height: 'auto'
                      }),
                  attrBehavior(map(state => ({ 'aria-label': state.ariaLabel }), subscriptionState)),
                  styleBehavior(borderColorStyle)
                )
              }))({
            click: popRouteSubscriptionEditorTether()
          })
        })({}),
        {
          changeMatchRuleList
        }
      ]
    }
  )
