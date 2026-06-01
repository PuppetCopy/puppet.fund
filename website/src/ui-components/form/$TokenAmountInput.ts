import { parseReadableNumber } from '@puppet/sdk/core'
import { filter, type IStream, map, tap } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $element,
  attr,
  component,
  effectProp,
  effectRun,
  type INode,
  type INodeCompose,
  nodeEvent,
  style
} from 'aelea/ui'
import { palette, text } from 'aelea/ui-components-theme'
import { parseUnits } from 'viem'

export const $defaultTokenAmountInput: INodeCompose<HTMLInputElement> = $element('input')(
  attr({ type: 'text', inputmode: 'decimal', placeholder: '0' }),
  style({
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    fontSize: text.display,
    fontWeight: 'lighter',
    color: palette.message,
    width: '100%',
    minWidth: '0',
    padding: '0',
    boxShadow: 'none'
  })
)

export interface I$TokenAmountInput {
  decimals: number
  valueToShow: IStream<string>
  $input?: INodeCompose<HTMLInputElement>
}

export const $TokenAmountInput = ({ decimals, valueToShow, $input = $defaultTokenAmountInput }: I$TokenAmountInput) =>
  component(
    (
      [inputAmount, inputAmountTether]: IBehavior<INode<HTMLInputElement>, bigint>,
      [focusEvt, focusEvtTether]: IBehavior<INode<HTMLInputElement>, FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<INode<HTMLInputElement>, FocusEvent>,
      [enterPress, enterPressTether]: IBehavior<INode<HTMLInputElement>, KeyboardEvent>
    ) => [
      $input(
        effectRun(el => {
          const id = window.setTimeout(() => (el as HTMLInputElement).focus(), 50)
          return {
            [Symbol.dispose]() {
              window.clearTimeout(id)
            }
          }
        }),
        focusEvtTether(nodeEvent('focus')),
        blurEvtTether(nodeEvent('blur')),
        enterPressTether(
          nodeEvent('keydown'),
          filter((e: KeyboardEvent) => e.key === 'Enter'),
          tap((e: KeyboardEvent) => e.preventDefault())
        ),
        inputAmountTether(
          nodeEvent('input'),
          map((ev: Event) => {
            const target = ev.target
            if (!(target instanceof HTMLInputElement)) return 0n
            const raw = target.value
            const rawCaret = target.selectionStart ?? raw.length
            const clean = raw.replace(/[^\d.]/g, '')
            if (!clean) {
              if (target.value !== '') target.value = ''
              return 0n
            }
            const dotIdx = clean.indexOf('.')
            const intPart = dotIdx < 0 ? clean : clean.slice(0, dotIdx)
            const decPart = dotIdx < 0 ? '' : clean.slice(dotIdx)
            const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + decPart
            let countBefore = 0
            for (let i = 0; i < Math.min(rawCaret, raw.length); i++) {
              if (/[\d.]/.test(raw[i])) countBefore++
            }
            let newCaret = 0
            let counted = 0
            while (newCaret < formatted.length && counted < countBefore) {
              if (/[\d.]/.test(formatted[newCaret])) counted++
              newCaret++
            }
            if (target.value !== formatted) target.value = formatted
            target.setSelectionRange(newCaret, newCaret)
            const parsed = parseReadableNumber(clean)
            if (!Number.isFinite(parsed)) return 0n
            try {
              return parseUnits(String(parsed), decimals)
            } catch {
              return 0n
            }
          })
        ),
        effectProp('value', valueToShow)
      )(),
      { inputAmount, focus: focusEvt, blur: blurEvt, enter: enterPress }
    ]
  )
