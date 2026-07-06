import { readableTokenAmount } from '@puppet/sdk/core'
import { combine, constant, empty, type IStream, map, merge, start, switchMap } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, type I$Node, type I$Op, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  $defaultDropdownContainer,
  $defaultSliderContainer,
  $infoTooltip,
  $noteTooltip,
  $Slider,
  NOTE_TOOLTIP_HEIGHT,
  text
} from '@/ui-components'
import { $chainIcon } from '../../common/$chain.js'
import { formatUsd } from '../../io/price.js'

export const createFocusState = (focusEvt: IStream<unknown>, blurEvt: IStream<unknown>): IStream<boolean> =>
  state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

export const $editorDropdownContainer = $defaultDropdownContainer(style({ alignItems: 'flex-end', flexShrink: '0' }))

export const $noteSlot = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))

export const $editorPercentSlider = (config: {
  value: IStream<number>
  disabled: IStream<boolean>
  error: IStream<boolean>
  ariaLabel: string
}) =>
  $Slider({
    value: config.value,
    step: 0.01,
    orientation: 'horizontal',
    ariaLabel: config.ariaLabel,
    disabled: config.disabled,
    error: config.error,
    motion: { stiffness: 800, damping: 58 },
    $container: $defaultSliderContainer(style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' }))
  })

export const $maxAmountButton = (
  amount: IStream<bigint>,
  balance: IStream<bigint | null>,
  clickTether: I$Op<HTMLButtonElement>
) =>
  switchMap(
    p => {
      if (p.amt !== 0n) return empty
      const ready = p.bal !== null && p.bal > 0n
      return $element('button')(
        attr({ type: 'button', disabled: ready ? null : 'true' }),
        style({
          background: 'transparent',
          border: `1px solid ${colorShade(palette.foreground, 25)}`,
          borderRadius: '8px',
          padding: '2px 8px',
          fontSize: text.xs,
          fontWeight: '600',
          color: palette.foreground,
          cursor: ready ? 'pointer' : 'not-allowed',
          opacity: ready ? '1' : '0.4',
          alignSelf: 'center',
          flexShrink: '0'
        }),
        clickTether
      )($text('Max'))
    },
    combine({ amt: amount, bal: balance })
  )

export const amountUsdLabel = (amount: IStream<bigint>, price: IStream<bigint | null>): IStream<string> =>
  map(p => (p.amt === 0n ? '' : formatUsd(p.amt, p.price)), combine({ amt: amount, price }))

export const scaleByPercent = (total: bigint, pct: number): bigint => {
  const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
  return (total * bp) / 10000n
}

export const $statRow = (label: string, value: string | IStream<string>) =>
  $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
    $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label)),
    $node(style({ color: palette.message, fontWeight: '600' }))($text(value))
  )

export interface ISurplusLeg {
  chainId: number
  amount: bigint
  decimals: number
  symbol: string
}

export const $surplusAlertSlot = (config: {
  alert: IStream<string | null>
  amountUsd: IStream<string>
  surplus: IStream<{ usd: string; legs: ISurplusLeg[] }>
  $note: ($legs: I$Node) => I$Node
  $legAddress: (leg: ISurplusLeg) => I$Node
}): I$Node =>
  $noteSlot(
    switchMap(
      p =>
        p.msg
          ? $noteTooltip($text(p.msg))
          : $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text(p.usd)),
              ...(p.surplus.legs.length > 0
                ? [
                    $row(spacing.tiny, style({ alignItems: 'center' }))(
                      $node(style({ color: palette.positive, fontSize: text.xs }))($text(`+ ${p.surplus.usd}`)),
                      $infoTooltip(
                        config.$note(
                          $column(spacing.tiny)(
                            ...p.surplus.legs.map(leg =>
                              $row(spacing.small, style({ alignItems: 'center' }))(
                                $chainIcon(leg.chainId, 14),
                                $node(style({ color: palette.positive }))(
                                  $text(`+${readableTokenAmount(leg.decimals, leg.amount)} ${leg.symbol}`)
                                ),
                                config.$legAddress(leg)
                              )
                            )
                          )
                        ),
                        palette.positive,
                        '16px'
                      )
                    )
                  ]
                : [])
            ),
      combine({ msg: config.alert, usd: start('', config.amountUsd), surplus: config.surplus })
    )
  )
