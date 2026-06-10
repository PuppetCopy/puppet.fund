import { combine, type IStream, just, map, switchLatest } from 'aelea/stream'
import { $node, $text, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette, text } from 'aelea/ui-components-theme'
import { $icon } from './$common.js'
import { $loadingValue } from './$IntermediateDisplay.js'
import { $arrowRight } from './$icons.js'

export interface IAmountChange {
  usd: string
  amount: string
}

export interface I$AmountDisplay {
  usd: IStream<string>
  amount: IStream<string> | string
  change?: IStream<IAmountChange | null>
  color?: IStream<string>
  align?: 'flex-start' | 'flex-end'
  usdFontSize?: string
}

export const $amountDisplay = ({
  usd,
  amount,
  change,
  color = just(palette.foreground),
  align = 'flex-start',
  usdFontSize = text.base
}: I$AmountDisplay): I$Node => {
  const $stack = ($usdVal: I$Slottable, amountVal: IStream<string> | string): I$Node =>
    $column(style({ gap: '1px', alignItems: align, minWidth: '0' }))(
      $node(style({ fontWeight: '600', fontSize: usdFontSize, color: palette.message }))($usdVal),
      $node(style({ color: palette.foreground, fontSize: text.xs }))($text(amountVal))
    )
  const $current = $stack($loadingValue(usd), amount)
  if (!change) return $current
  return switchLatest(
    map(
      p =>
        p.c === null
          ? $current
          : $row(spacing.small, style({ alignItems: 'center' }))(
              $current,
              $icon({ $content: $arrowRight, width: '10px', viewBox: '0 0 32 32', fill: p.cl }),
              $stack($text(p.c.usd), p.c.amount)
            ),
      combine({ c: change, cl: color })
    )
  )
}
