import { formatFixed, getMasterMatchingKey } from '@puppet/sdk/core'
import { awaitPromises, combine, empty, type IStream, map, op, sampleMap, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attrBehavior, component, type INodeCompose, style, styleBehavior } from 'aelea/ui'
import { $defaultButtonContainer, $Popover, $row, isDesktopScreen, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem/accounts'
import { $ButtonSecondary, $caretDown, $check, $icon, text } from '@/ui-components'
import { $tokenIconByAddress } from '../../common/$common.js'
import { $responsiveFlex } from '../../common/elements/$common.js'
import { $separator2 } from '../../pages/common.js'
import { $MatchingRuleEditor, type ISubscribeRule } from './$MatchingRuleEditor.js'

interface I$FundEditor {
  master: Address
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  collateralToken: Address
  draftMatchingRuleList: IStream<ISubscribeRule[]>
  $container?: INodeCompose
  // When true (Master page hero) the button reads as the page's confident primary CTA:
  // filled primary weight + trader-facing copy ('Copy this trader' / 'Edit allocation').
  prominent?: boolean
}

export const $defaultFundEditorContainer = $row(spacing.small, style({ alignItems: 'center' }))

export const $FundEditor = (config: I$FundEditor) =>
  component(
    (
      [popRouteSubscriptionEditor, popRouteSubscriptionEditorTether]: IBehavior<PointerEvent>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>
    ) => {
      const masterMatchingKey = getMasterMatchingKey(config.collateralToken, config.master)

      const {
        $container = $defaultFundEditorContainer,
        draftMatchingRuleList,
        master,
        collateralToken,
        userMatchingRuleQuery,
        prominent = false
      } = config

      const matchingRule = op(
        userMatchingRuleQuery,
        map(async listQuery => {
          const list = await listQuery
          return list.find(mr => getMasterMatchingKey(mr.baseToken, mr.master) === masterMatchingKey)
        }),
        awaitPromises
      )

      // Single source of truth for the subscription cue: feeds the button label, aria-label,
      // status icon and (as reinforcement) the border color.
      const subscriptionState = op(
        combine({ rule: matchingRule, draftList: draftMatchingRuleList }),
        map(params => {
          const hasDraft = params.draftList.some(draft => draft.masterMatchingKey === masterMatchingKey)
          const hasActiveRule = params.rule && params.rule.allocationRate > 0n
          if (hasDraft) {
            return {
              status: 'pending' as const,
              label: 'In cart',
              ariaLabel: 'Allocation change pending in cart for this trader'
            }
          }
          if (hasActiveRule) {
            const ratePercent = formatFixed(4, params.rule!.allocationRate) * 100
            const rateText = `${Math.round(ratePercent * 100) / 100}%`
            return {
              status: 'active' as const,
              label: prominent ? `Edit allocation (${rateText})` : `Copying ${rateText}`,
              ariaLabel: `Currently copying this trader at ${rateText} allocation. Activate to edit.`
            }
          }
          return {
            status: 'none' as const,
            label: prominent ? 'Copy this trader' : 'Copy',
            ariaLabel: 'Not copying this trader. Activate to copy.'
          }
        }),
        state()
      )

      const borderColorStyle = map(state => {
        if (state.status === 'pending') return { borderColor: `${palette.indeterminate} !important` }
        if (state.status === 'active') return { borderColor: `${palette.primary} !important` }
        return null
      }, subscriptionState)

      // A small filled dot/check rendered in both the desktop and mobile variants so the state
      // is not conveyed by border color alone.
      const $statusMark = switchMap(state => {
        if (state.status === 'active') {
          return $icon({
            $content: $check,
            width: isDesktopScreen ? '14px' : '12px',
            fill: palette.primary,
            svgOps: style({ minWidth: isDesktopScreen ? '14px' : '12px' }),
            viewBox: '0 0 24 24'
          })
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
                master
              })({
                changeMatchRuleList: changeMatchRuleListTether()
              })
            }, matchingRule)
          ),
          dismiss: changeMatchRuleList,
          $target: $ButtonSecondary({
            $content: $responsiveFlex(style({ alignItems: 'center', gap: isDesktopScreen ? '6px' : '4px' }))(
              $row(style({ alignItems: 'center', gap: '4px' }))(
                $tokenIconByAddress(collateralToken, isDesktopScreen ? '38px' : '24px'),
                // Surface the state as a dot/check in the mobile collapsed variant (where the
                // label text may be clipped) so the cue is never color-only.
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
              $separator2,
              $row(style({ alignItems: 'center', gap: '6px' }))(
                isDesktopScreen ? $statusMark : empty,
                $text(map(state => state.label, subscriptionState)),
                isDesktopScreen
                  ? $icon({
                      $content: $caretDown,
                      width: '8px',
                      svgOps: style({ marginTop: '2px', minWidth: '8px', marginRight: '8px' }),
                      viewBox: '0 0 32 32'
                    })
                  : empty
              )
            ),
            $container: $defaultButtonContainer(
              style({
                color: palette.message,
                whiteSpace: 'nowrap',
                fill: 'white',
                borderStyle: 'solid',
                alignSelf: 'center',
                fontSize: prominent ? text.base : text.sm,
                // Master page hero reads as a confident filled primary CTA; the list keeps the
                // lighter secondary/outline weight.
                backgroundColor: prominent ? palette.primary : palette.background,
                fontWeight: 'bold',
                borderWidth: '1px',
                borderColor: prominent ? palette.primary : colorShade(palette.foreground, 40)
              }),
              isDesktopScreen
                ? style({
                    borderRadius: '100px',
                    padding: prominent ? '0 8px' : '0',
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
          })({
            click: popRouteSubscriptionEditorTether()
          })
        })({}),
        {
          changeMatchRuleList
        }
      ]
    }
  )
