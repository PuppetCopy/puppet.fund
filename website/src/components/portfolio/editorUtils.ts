import { combine, constant, empty, filter, type IStream, just, map, merge, op, sampleMap, switchMap } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, type I$Node, type I$Op, type INodeCompose, style } from 'aelea/ui'
import { $column, $defaultPopoverContentContainer, designSheet, isDesktopScreen, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultSliderContainer, NOTE_TOOLTIP_HEIGHT, $Slider, $intermediateLine, text } from '@/ui-components'
import { usdOf } from '../../io/price.js'

export const QUOTE_CALLDATA_BYTES = 8_192n

export const createFocusState = (focusEvt: IStream<unknown>, blurEvt: IStream<unknown>): IStream<boolean> =>
  state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))

export const $editorPopoverContentContainer = $defaultPopoverContentContainer(designSheet.customScroll, style({ scrollbarWidth: 'thin', maxWidth: 'calc(100vw - 32px)' }))

export const $noteSlot = $node(style({ height: NOTE_TOOLTIP_HEIGHT, display: 'flex', alignItems: 'center' }))

export const $editorFlowContainer = $row(
  style({
    padding: isDesktopScreen ? '20px 28px' : '16px',
    borderRadius: '22px 22px 0 0',
    background: palette.background,
    margin: isDesktopScreen ? '-28px -28px 0px' : '-16px -16px 0px',
    gap: '12px',
    alignItems: 'center'
  })
)

export const $editorAmountLabel = $element('label')(
  style({ display: 'flex', flexDirection: 'column', cursor: 'text', flex: '1', minWidth: '0', gap: '8px' })
)

export const $overlaySliderContainer = $defaultSliderContainer(style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' }))
export const $overlaySliderRow = $node(style({ margin: isDesktopScreen ? '0 -28px -16px' : '0 -16px -16px', display: 'flex' }))

export const $editorPercentSlider = ({
  value,
  disabled,
  error,
  ariaLabel,
  color,
  trackColor,
  $container = $defaultSliderContainer(style({ height: '14px', width: '100%', flexShrink: '0' }))
}: {
  value: IStream<number>
  disabled: IStream<boolean>
  error: IStream<boolean>
  ariaLabel: string
  color?: IStream<string>
  trackColor?: IStream<string>
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
    color,
    trackColor,
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

export const $intermediateEditor: I$Node = $column(spacing.default)($intermediateLine('5em', text.sm), $intermediateLine('100%', '48px'), $intermediateLine('100%', '48px'), $intermediateLine('80%', text.xs))

export const amountUsdLabel = (amount: IStream<bigint>, price: IStream<Promise<bigint | null>>): IStream<Promise<string> | string> =>
  switchMap((amt): IStream<Promise<string> | string> => (amt === 0n ? just('$0') : map(at => usdOf(amt, at), price)), amount)

export const scaleByPercent = (total: bigint, pct: number): bigint => {
  const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
  return (total * bp) / 10000n
}

export const $caption = (label: string | IStream<string>): I$Node =>
  $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($text(label))

export const submitOn = (disabled: IStream<boolean>, click: IStream<PointerEvent>, enter: IStream<KeyboardEvent>): IStream<unknown> =>
  merge(
    click,
    op(
      sampleMap((dis: boolean, evt: KeyboardEvent) => ({ dis, evt }), disabled, enter),
      filter(p => !p.dis)
    )
  )
