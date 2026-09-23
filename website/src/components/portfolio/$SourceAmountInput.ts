import { readableTokenAmount } from '@puppet/sdk/core'
import { combine, filter, filterNull, type IStream, map, merge, op, sampleMap, switchMap } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type I$Slottable, type INode, type INodeCompose, nodeEvent, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $infoTooltip, $noteTooltip, $TokenAmountInput, text } from '@/ui-components'
import { $crumbTrail } from './$InlineSwitchView.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'

export interface I$SourceAmountInput {
  label: string
  decimals: number
  amount: IStream<bigint>
  max: IStream<bigint | null>
  alert: IStream<string | null>
  note: IStream<string>
  $anchor: I$Node
  $container?: INodeCompose
}

export const $SourceAmountInput = ({ label, decimals, amount, max, alert, note, $anchor, $container = $editorFlowContainer }: I$SourceAmountInput) =>
  component(
    (
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>
    ) => {
      const focused = createFocusState(focusEvt, blurEvt)
      const valueToShow: IStream<string> = op(
        combine({ amt: amount, focused }),
        filter(p => !p.focused),
        map(p => (p.amt === 0n ? '' : readableTokenAmount(decimals, p.amt)))
      )
      return [
        $node(style({ display: 'contents' }))(
          $container(
            $editorAmountLabel(
              $crumbTrail([{ label }]),
              $row(spacing.small, style({ alignItems: 'center' }))(
                $TokenAmountInput({ decimals, valueToShow })({
                  inputAmount: inputAmountTether(),
                  focus: focusEvtTether(),
                  blur: blurEvtTether(),
                  enter: enterPressTether()
                }),
                $maxAmountButton(amount, max, clickMaxTether(nodeEvent('click')))
              ),
              $noteSlot(
                switchMap(
                  msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(note))),
                  alert
                )
              )
            ),
            $anchor
          ),
          $node(style({ margin: '0 -28px', display: 'flex' }))(
            $editorPercentSlider({
              value: map(p => (p.max === null || p.max === 0n ? 0 : Math.min(1, Number((p.amt * 10_000n) / p.max) / 10_000)), combine({ amt: amount, max })),
              ariaLabel: `${label} percentage`,
              disabled: map(m => m === null || m === 0n, max),
              error: map(a => a !== null, alert),
              $container: $overlaySliderContainer
            })({ change: sliderPercentTether() })
          )
        ),
        {
          change: merge(
            inputAmount,
            op(
              sampleMap((m: bigint | null, pct: number) => (m === null ? null : scaleByPercent(m, pct)), max, sliderPercent),
              filterNull
            ),
            op(
              sampleMap((m: bigint | null) => m, max, clickMax),
              filterNull
            )
          ),
          enter: enterPress
        }
      ]
    }
  )

export const $sourceAnchor = ($profile: I$Node, $caption: I$Slottable): I$Node =>
  $node(style({ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', flexShrink: '0' }))(
    $profile,
    $row(spacing.tiny, style({ color: palette.foreground, fontSize: text.xs, whiteSpace: 'nowrap', alignItems: 'center', minHeight: '16px' }))($caption)
  )

export const $detailLine = (label: string, $figure: I$Slottable, hint?: string): I$Node =>
  $row(spacing.small, style({ fontSize: text.sm, alignItems: 'center' }))(
    $row(spacing.tiny, style({ flex: 1, alignItems: 'center', color: palette.foreground }))(
      $text(label),
      ...(hint === undefined ? [] : [$infoTooltip($node(style({ maxWidth: '260px', lineHeight: '1.4', fontSize: text.sm }))($text(hint)))])
    ),
    $node(style({ textAlign: 'right', whiteSpace: 'nowrap' }))($figure)
  )
