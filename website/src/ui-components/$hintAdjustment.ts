import { combine, empty, type IStream, just, map, switchLatest, toStream } from 'aelea/stream'
import { $node, $text, attr, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette, text } from 'aelea/ui-components-theme'
import { hideBalances } from './balanceVisibility.js'
import { $icon } from './$common.js'
import { $loadingValue } from './$IntermediateDisplay.js'
import { $arrowRight } from './$icons.js'

const BALANCE_MASK = '••••'
const maskBalance = (src: IStream<string> | string): IStream<string> =>
  map(p => (p.hide ? BALANCE_MASK : p.v), combine({ hide: hideBalances, v: toStream(src) }))

// The fund's redemption gauge: a thin track that doubles as the separator inside a fund
// value display. The negative fill is the share of the fund awaiting redemption, an
// objective pool-health read wherever a fund is shown.
export const $redemptionGauge = (ratio: number): I$Node => {
  const clamped = Math.max(0, Math.min(1, ratio))
  const pct = Math.round(clamped * 1000) / 10
  return $row(
    attr({ title: `${pct}% of shares awaiting redemption` }),
    style({
      width: '100%',
      height: '2px',
      borderRadius: '1px',
      overflow: 'hidden',
      backgroundColor: colorShade(palette.foreground, 12)
    })
  )(
    clamped === 0
      ? empty
      : $node(style({ width: `${clamped * 100}%`, height: '100%', backgroundColor: palette.negative }))()
  )
}

export interface IAmountChange {
  usd: string
  amount: string
  // Rendered between the projected dollar and token lines (e.g. the projected gauge).
  $between?: I$Node
}

export interface I$AmountDisplay {
  usd: IStream<string>
  amount: IStream<string> | string
  change?: IStream<IAmountChange | null>
  color?: IStream<string>
  align?: 'flex-start' | 'flex-end' | 'center'
  usdFontSize?: string
  // Rendered between the dollar and token lines (e.g. the fund redemption gauge).
  $between?: I$Node
}

export const $amountDisplay = ({
  usd,
  amount,
  change,
  color = just(palette.foreground),
  align = 'flex-start',
  usdFontSize = text.base,
  $between
}: I$AmountDisplay): I$Node => {
  // Zero values render de-emphasized (secondary color/weight): every row stays
  // visible, but only live values draw the eye.
  const isZeroDisplay = (v: string) => Number(v.replace(/[^0-9.-]/g, '')) === 0
  const $stack = (usdSrc: IStream<string>, amountVal: IStream<string> | string, $sep?: I$Node): I$Node =>
    $column(style({ gap: '1px', alignItems: align, minWidth: '0' }))(
      $node(
        style({ fontWeight: '600', fontSize: usdFontSize, color: palette.message }),
        styleBehavior(map(v => (isZeroDisplay(v) ? { color: palette.foreground, fontWeight: '500' } : null), usdSrc))
      )($loadingValue(maskBalance(usdSrc))),
      ...($sep ? [$sep] : []),
      $node(style({ color: palette.foreground, fontSize: text.xs }))($text(maskBalance(amountVal)))
    )
  const $current = $stack(usd, amount, $between)
  if (!change) return $current
  return switchLatest(
    map(
      p =>
        p.c === null
          ? $current
          : $row(spacing.small, style({ alignItems: 'center' }))(
              $current,
              $icon({ $content: $arrowRight, width: '10px', viewBox: '0 0 32 32', fill: p.cl }),
              $stack(toStream(p.c.usd), p.c.amount, p.c.$between)
            ),
      combine({ c: change, cl: color })
    )
  )
}
