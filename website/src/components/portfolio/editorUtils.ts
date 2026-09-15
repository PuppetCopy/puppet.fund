import type { ChainId } from '@puppet/sdk/const'
import { readableTokenAmount } from '@puppet/sdk/core'
import { combine, constant, empty, type IStream, just, map, merge, switchMap } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, type I$Node, type I$Op, type INodeCompose, style, styleBehavior } from 'aelea/ui'
import { $column, $defaultPopoverContentContainer, $row, designSheet, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultSliderContainer, $infoTooltip, $noteTooltip, $Slider, NOTE_TOOLTIP_HEIGHT, text } from '@/ui-components'
import { $chainIcon } from '../../common/$chain.js'
import { formatUsd } from '../../io/price.js'

export const createFocusState = (focusEvt: IStream<unknown>, blurEvt: IStream<unknown>): IStream<boolean> =>
  state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

export const $editorPopoverContentContainer = $defaultPopoverContentContainer(
  designSheet.customScroll,
  style({ scrollbarWidth: 'thin' }),
  styleBehavior(just({ maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }))
)

export const $noteSlot = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))

export const $editorFlowContainer = $row(
  style({
    padding: '20px 28px',
    borderRadius: '22px 22px 0 0',
    background: palette.background,
    margin: '-28px -28px 0px',
    width: '450px',
    gap: '12px',
    alignItems: 'center'
  })
)

export const $editorAmountLabel = $element('label')(
  style({ display: 'flex', flexDirection: 'column', cursor: 'text', flex: '1', minWidth: '0', gap: '8px' })
)

export const $overlaySliderContainer = $defaultSliderContainer(style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' }))

export const $editorPercentSlider = ({
  value,
  disabled,
  error,
  ariaLabel,
  $container = $defaultSliderContainer(style({ height: '14px', width: '100%', flexShrink: '0' }))
}: {
  value: IStream<number>
  disabled: IStream<boolean>
  error: IStream<boolean>
  ariaLabel: string
  $container?: INodeCompose
}) =>
  $Slider({
    value,
    step: 0.01,
    orientation: 'horizontal',
    ariaLabel,
    disabled,
    error,
    motion: { stiffness: 800, damping: 58 },
    $container
  })

export const $miniButton = (
  label: string,
  disabled: boolean,
  clickTether: I$Op<HTMLButtonElement>,
  negative = false
) =>
  $element('button')(
    attr({ type: 'button', disabled: disabled ? 'true' : null }),
    style({
      background: 'transparent',
      border: `1px solid ${negative ? colorShade(palette.negative, 35) : colorShade(palette.foreground, 25)}`,
      borderRadius: '8px',
      padding: '2px 8px',
      fontSize: text.xs,
      fontWeight: '600',
      color: negative ? palette.negative : palette.foreground,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? '0.4' : '1',
      flexShrink: '0'
    }),
    clickTether
  )($text(label))

export const $maxAmountButton = (
  amount: IStream<bigint>,
  balance: IStream<bigint | null>,
  clickTether: I$Op<HTMLButtonElement>
) =>
  switchMap(
    p => {
      if (p.amt !== 0n) return empty
      const ready = p.bal !== null && p.bal > 0n
      return $miniButton('Max', !ready, clickTether)
    },
    combine({ amt: amount, bal: balance })
  )

export const amountUsdLabel = (amount: IStream<bigint>, price: IStream<bigint | null>): IStream<string> =>
  switchMap(amt => (amt === 0n ? just('$0') : map(p => formatUsd(amt, p), price)), amount)

export const scaleByPercent = (total: bigint, pct: number): bigint => {
  const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
  return (total * bp) / 10000n
}

export interface ISurplusLeg {
  chainId: ChainId
  amount: bigint
  decimals: number
  symbol: string
}

export const $surplusAlertSlot = (config: {
  alert: IStream<string | null>
  amountUsd: IStream<string>
  surplus: IStream<{ usd: string; legs: ISurplusLeg[] } | null>
  $note: ($legs: I$Node) => I$Node
  $legAddress: (leg: ISurplusLeg) => I$Node
}): I$Node =>
  $noteSlot(
    switchMap(
      msg =>
        msg
          ? $noteTooltip($text(msg))
          : $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text(config.amountUsd)),
              switchMap(
                surplus =>
                  surplus === null
                    ? $node(style({ color: palette.indeterminate, fontSize: text.xs }))(
                        $text('Stranded funds could not be checked on the selected chain')
                      )
                    : surplus.legs.length === 0
                      ? empty
                      : $row(spacing.tiny, style({ alignItems: 'center' }))(
                          $node(style({ color: palette.positive, fontSize: text.xs }))($text(`+ ${surplus.usd}`)),
                          $infoTooltip(
                            config.$note(
                              $column(spacing.tiny)(
                                ...surplus.legs.map(leg =>
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
                            palette.positive)
                        ),
                config.surplus
              )
            ),
      config.alert
    )
  )
