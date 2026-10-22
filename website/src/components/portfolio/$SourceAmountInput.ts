import { readableTokenAmount } from '@puppet/sdk/core'
import { combine, filter, filterNull, type IStream, map, merge, op, sampleMap, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $node, $text, attrBehavior, component, type I$Node, type I$Slottable, type INode, type INodeCompose, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { colorWeight, palette } from 'aelea/ui-components-theme'
import { $defaultTokenAmountInput, $intermediateText, $noteTooltip, $TokenAmountInput, text } from '@/ui-components'
import { $crumbTrail } from './$InlineSwitchView.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  $overlaySliderRow,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'

export interface I$SourceAmountInput {
  label: string
  decimals: IStream<number>
  amount: IStream<bigint>
  max: IStream<bigint | null>
  total?: IStream<bigint | null>
  locked: IStream<boolean>
  alert: IStream<string | null>
  note: IStream<Promise<string> | string>
  $anchor?: I$Node
  $frame?: ($amount: I$Node) => I$Node
  listing?: IStream<boolean>
  $container?: INodeCompose
}

export const $SourceAmountInput = ({ label, decimals, amount, max, total, locked, alert, note, $anchor, $frame, listing, $container = $editorFlowContainer }: I$SourceAmountInput) =>
  component(
    (
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>,
      [sliderRelease, sliderReleaseTether]: IBehavior<INode, Event>
    ) => {
      const focused = createFocusState(focusEvt, blurEvt)
      const typed: IStream<bigint | null> = state(null, inputAmount)
      const valueToShow: IStream<string> = op(
        combine({ amt: amount, focused, typed, decimals }),
        filter(p => !p.focused || p.typed !== p.amt),
        map(p => (p.amt === 0n ? '' : readableTokenAmount(p.decimals, p.amt)))
      )
      const $amount = $editorAmountLabel(
        $crumbTrail([{ label }]),
        $row(spacing.small, style({ alignItems: 'center' }))(
          switchMap(
            dec =>
              $TokenAmountInput({
                decimals: dec,
                valueToShow,
                $input: $defaultTokenAmountInput(attrBehavior(map(isLocked => ({ readonly: isLocked ? '' : null }), locked)))
              })({
                inputAmount: inputAmountTether(),
                focus: focusEvtTether(),
                blur: blurEvtTether(),
                enter: enterPressTether()
              }),
            decimals
          ),
          $maxAmountButton(amount, max, clickMaxTether(nodeEvent('click')))
        ),
        $noteSlot(
          switchMap(
            msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($intermediateText(note))),
            alert
          )
        )
      )
      const scale = total ?? max
      const reach: IStream<number | null> | null =
        total === undefined
          ? null
          : map(p => (p.total === null || p.max === null || p.total === 0n ? null : Math.min(100, Number((p.max * 10_000n) / p.total) / 100)), combine({ total, max }))
      const slid: IStream<bigint> = op(
        sampleMap(
          (p: { scale: bigint | null; max: bigint | null }, pct: number) => {
            if (p.scale === null || p.max === null) return null
            const picked = scaleByPercent(p.scale, pct)
            return picked > p.max ? p.max : picked
          },
          combine({ scale, max }),
          sliderPercent
        ),
        filterNull,
        multicast
      )
      const maxed: IStream<bigint> = op(
        sampleMap((m: bigint | null) => m, max, clickMax),
        filterNull,
        multicast
      )
      const $slider = $overlaySliderRow(sliderReleaseTether(nodeEvent('change')))(
        $editorPercentSlider({
          value: map(p => (p.scale === null || p.scale === 0n ? 0 : Math.min(1, Number((p.amt * 10_000n) / p.scale) / 10_000)), combine({ amt: amount, scale })),
          ariaLabel: `${label} percentage`,
          disabled: map(p => p.locked || p.max === null || p.max === 0n, combine({ locked, max })),
          error: map(a => a !== null, alert),
          ...(reach === null
            ? { $container: $overlaySliderContainer }
            : {
                trackColor: map(
                  pct =>
                    pct === null
                      ? colorWeight(palette.foreground, 40)
                      : `linear-gradient(to right, ${colorWeight(palette.foreground, 40)} 0 ${pct}%, transparent ${pct}% 100%), repeating-linear-gradient(to right, ${colorWeight(palette.foreground, 25)} 0 3px, transparent 3px 6px)`,
                  reach
                ),
                $container: $overlaySliderContainer(
                  styleBehavior(map(pct => (pct === null ? null : { background: `linear-gradient(to right, ${colorWeight(palette.foreground, 40)} 0 ${pct}%, transparent ${pct}% 100%) center / 100% 2px no-repeat` }), reach))
                )
              })
        })({ change: sliderPercentTether() })
      )
      return [
        $node(style({ display: 'contents' }))(
          $frame === undefined ? $container($amount, ...($anchor === undefined ? [] : [$anchor])) : $frame($amount),
          listing === undefined ? $slider : $node(style({ display: 'contents' }), styleBehavior(map(open => (open ? { display: 'none' } : null), listing)))($slider)
        ),
        {
          change: merge(inputAmount, slid, maxed),
          commit: merge(sampleMap((amount: bigint) => amount, slid, sliderRelease), maxed),
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

