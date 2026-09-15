import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { getTokenDescription, readableTokenAmount } from '@puppet/sdk/core'
import { bondTokenOf } from '@puppet/sdk/state'
import { combine, filter, type IStream, just, map, merge, op, sample, sampleMap, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $ButtonPrimaryOutline, $noteTooltip, $TokenAmountInput, text } from '@/ui-components'
import { $tokenProfile } from '../../common/$common.js'
import { priceFor } from '../../io/price.js'
import { $crumbTrail } from './$InlineSwitchView.js'
import type { IUnbondDraft } from './draft.js'
import {
  $editorAmountLabel,
  $editorFlowContainer,
  $editorPercentSlider,
  $maxAmountButton,
  $noteSlot,
  $overlaySliderContainer,
  amountUsdLabel,
  createFocusState,
  scaleByPercent
} from './editorUtils.js'

export interface I$UnbondEditor {
  bonded: bigint
  existingDraft: IStream<IUnbondDraft | null>
}

export const $UnbondEditor = ({ bonded, existingDraft }: I$UnbondEditor) =>
  component(
    (
      [clickAddDraft, clickAddDraftTether]: IBehavior<PointerEvent>,
      [inputAmount, inputAmountTether]: IBehavior<bigint>,
      [focusEvt, focusEvtTether]: IBehavior<FocusEvent>,
      [blurEvt, blurEvtTether]: IBehavior<FocusEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickMax, clickMaxTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [enterPress, enterPressTether]: IBehavior<KeyboardEvent>
    ) => {
      const token = bondTokenOf(HUB_CHAIN_ID)
      const description = getTokenDescription(HUB_CHAIN_ID, token)
      const price = priceFor(HUB_CHAIN_ID, token)
      const balance: IStream<bigint> = just(bonded)

      const sliderAmount: IStream<bigint> = sampleMap((bal, pct) => scaleByPercent(bal, pct), balance, sliderPercent)
      const maxAmount: IStream<bigint> = sample(balance, clickMax)
      const hydration: IStream<bigint> = map(d => (d === null ? 0n : d.amount), existingDraft)
      const amountValue: IStream<bigint> = state(0n, merge(inputAmount, sliderAmount, maxAmount, hydration))
      const focused = createFocusState(focusEvt, blurEvt)

      const alert: IStream<string | null> = state(
        null,
        map(p => (p.amount > p.balance ? `Exceeds bonded ${readableTokenAmount(description, p.balance)}` : null), combine({ amount: amountValue, balance }))
      )
      const disabled: IStream<boolean> = state(true, map(p => p.amount === 0n || p.alert !== null, combine({ amount: amountValue, alert })))
      const submitTrigger: IStream<unknown> = merge(
        clickAddDraft,
        op(
          sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enterPress),
          filter(p => !p.dis)
        )
      )

      const valueToShow: IStream<string> = map(
        (p: { amt: bigint; focused: boolean }) => (p.amt === 0n ? '' : readableTokenAmount(description.decimals, p.amt)),
        filter((p: { amt: bigint; focused: boolean }) => !p.focused, combine({ amt: amountValue, focused }))
      )
      const $field = $TokenAmountInput({ decimals: description.decimals, valueToShow })({
        inputAmount: inputAmountTether(),
        focus: focusEvtTether(),
        blur: blurEvtTether(),
        enter: enterPressTether()
      })

      const sliderValue: IStream<number> = map(
        p => (p.bal === 0n ? 0 : Math.min(1, Number((p.amt * 10000n) / p.bal) / 10000)),
        combine({ amt: amountValue, bal: balance })
      )
      const $percentSlider = $editorPercentSlider({
        value: sliderValue,
        ariaLabel: 'Amount percentage',
        disabled: map(b => b === 0n, balance),
        error: map(a => a !== null, alert),
        $container: $overlaySliderContainer
      })({ change: sliderPercentTether() })

      const amountUsd: IStream<string> = amountUsdLabel(amountValue, price)
      const $alert = $noteSlot(
        switchMap(
          msg => (msg ? $noteTooltip($text(msg)) : $node(style({ color: palette.foreground, fontSize: text.xs }))($text(amountUsd))),
          alert
        )
      )
      const $maxButton = $maxAmountButton(amountValue, balance, clickMaxTether(nodeEvent('click')))

      const changeDraft: IStream<IUnbondDraft> = op(
        sample(amountValue, submitTrigger),
        filter(amount => amount > 0n),
        map(amount => ({ kind: 'unbond' as const, id: 'unbond', amount }))
      )

      return [
        $column(spacing.default, style({ width: '394px' }))(
          $editorFlowContainer(
            $editorAmountLabel(
              $crumbTrail([{ label: 'Release bond' }]),
              $row(spacing.small, style({ alignItems: 'center' }))($field, $maxButton),
              $alert
            ),
            $node(style({ flexShrink: '0' }))($tokenProfile(HUB_CHAIN_ID, token, 28))
          ),
          $node(style({ margin: '0 -26px', display: 'flex' }))($percentSlider),
          $row(spacing.default, style({ alignItems: 'center' }))(
            $node(style({ flex: 1, minWidth: 0, fontSize: text.sm, color: palette.foreground }))($text('Returns bond not backing an open cycle.')),
            $ButtonPrimaryOutline({ disabled, $content: $text('Save') })({ click: clickAddDraftTether() })
          )
        ),
        { changeDraft }
      ]
    }
  )
