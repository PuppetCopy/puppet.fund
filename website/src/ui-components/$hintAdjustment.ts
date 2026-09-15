import { combine, type IStream, just, map, switchLatest, toStream } from 'aelea/stream'
import { $node, $text, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette, text } from 'aelea/ui-components-theme'
import { $icon } from './$common.js'
import { $loadingValue } from './$IntermediateDisplay.js'
import { $arrowRight } from './$icons.js'

const BALANCE_MASK = '••••'
export const maskBalance = (src: IStream<string> | string, hideBalances: IStream<boolean>): IStream<string> =>
  map(p => (p.v === '-' ? '-' : p.hide ? BALANCE_MASK : p.v), combine({ hide: hideBalances, v: toStream(src) }))

export interface IAmountChange {
  usd: string
  amount: string
  $between?: I$Node
}

export interface I$AmountDisplay {
  hideBalances: IStream<boolean>
  usd: IStream<string>
  amount: IStream<string> | string
  change?: IStream<IAmountChange | null>
  color?: IStream<string>
  align?: 'flex-start' | 'flex-end' | 'center'
  usdFontSize?: string
  usdColor?: IStream<string>
  amountColor?: IStream<string>
  $between?: I$Node
}

export const $amountDisplay = ({
  hideBalances,
  usd,
  amount,
  change,
  color = just(palette.foreground),
  align = 'flex-start',
  usdFontSize = text.base,
  usdColor = just(palette.message),
  amountColor = just(palette.foreground),
  $between
}: I$AmountDisplay): I$Node => {
  const isZeroDisplay = (v: string) => Number(v.replace(/[^0-9.-]/g, '')) === 0
  const $stack = (usdSrc: IStream<string>, amountVal: IStream<string> | string, $sep?: I$Node): I$Node =>
    $column(style({ gap: '1px', alignItems: align, textAlign: align === 'flex-end' ? 'right' : align === 'center' ? 'center' : 'left', minWidth: '0' }))(
      $node(
        style({ fontWeight: '600', fontSize: usdFontSize, color: palette.message }),
        styleBehavior(
          map(
            p => (isZeroDisplay(p.v) ? { color: palette.foreground, fontWeight: '500' } : { color: p.c }),
            combine({ v: usdSrc, c: usdColor })
          )
        )
      )($loadingValue(maskBalance(usdSrc, hideBalances))),
      ...($sep ? [$sep] : []),
      $node(
        style({ fontSize: text.xs }),
        styleBehavior(map(c => ({ color: c }), amountColor))
      )($text(maskBalance(amountVal, hideBalances)))
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
