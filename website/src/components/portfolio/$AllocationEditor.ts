import { getMasterMatchingKey } from '@puppet/sdk/core'
import { awaitPromises, combine, empty, type IStream, map, op, sampleMap } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $text, component, type INodeCompose, style, styleBehavior } from 'aelea/ui'
import { $defaultButtonContainer, $Popover, $row, isDesktopScreen, isMobileScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem/accounts'
import { $ButtonSecondary, $caretDown, $icon, text } from '@/ui-components'
import { $tokenIconByAddress } from '../../common/$common.js'
import { $responsiveFlex } from '../../common/elements/$common.js'
import { $separator2 } from '../../pages/common.js'
import { $MatchingRuleEditor, type ISubscribeRule } from './$MatchingRuleEditor.js'

interface I$AllocationEditor {
  master: Address
  userMatchingRuleQuery: IStream<Promise<ISubscribeRule[]>>
  collateralToken: Address
  draftMatchingRuleList: IStream<ISubscribeRule[]>
  $container?: INodeCompose
}

export const $defaultAllocationEditorContainer = $row(spacing.small, style({ alignItems: 'center' }))

export const $AllocationEditor = (config: I$AllocationEditor) =>
  component(
    (
      [popRouteSubscriptionEditor, popRouteSubscriptionEditorTether]: IBehavior<PointerEvent>,
      [changeMatchRuleList, changeMatchRuleListTether]: IBehavior<ISubscribeRule[]>
    ) => {
      const masterMatchingKey = getMasterMatchingKey(config.collateralToken, config.master)

      const {
        $container = $defaultAllocationEditorContainer,
        draftMatchingRuleList,
        master,
        collateralToken,
        userMatchingRuleQuery
      } = config

      const matchingRule = op(
        userMatchingRuleQuery,
        map(async listQuery => {
          const list = await listQuery
          return list.find(mr => getMasterMatchingKey(mr.baseToken, mr.master) === masterMatchingKey)
        }),
        awaitPromises
      )

      const borderColorStyle = op(
        combine({ rule: matchingRule, draftList: draftMatchingRuleList }),
        map(params => {
          const hasDraft = params.draftList.some(draft => draft.masterMatchingKey === masterMatchingKey)
          const hasActiveRule = params.rule && params.rule.allocationRate > 0n
          if (hasDraft) return { borderColor: `${palette.indeterminate} !important` }
          if (hasActiveRule) return { borderColor: `${palette.primary} !important` }
          return null
        })
      )

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
              $row(style({ alignItems: 'center' }))(
                $tokenIconByAddress(collateralToken, isDesktopScreen ? '38px' : '24px'),
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
              $row(style({ gap: '6px' }))(
                $text('Copy'),
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
                fontSize: text.sm,
                backgroundColor: palette.background,
                fontWeight: 'bold',
                borderWidth: '1px',
                borderColor: colorShade(palette.foreground, 40)
              }),
              isDesktopScreen
                ? style({
                    borderRadius: '100px',
                    padding: '0',
                    height: 'auto'
                  })
                : style({
                    borderRadius: '8px',
                    padding: '4px 8px',
                    height: 'auto'
                  }),
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
