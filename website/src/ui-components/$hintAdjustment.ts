import { combine, empty, filterNull, type IStream, just, map, op, reduce, skipRepeats, switchLatest, toStream } from 'aelea/stream'
import { PromiseStatus, state } from 'aelea/stream-extended'
import { $node, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette, text } from 'aelea/ui-components-theme'
import { $icon } from './$common.js'
import { $intermediateText, intermediateState } from './$IntermediateDisplay.js'
import { $arrowRight } from './$icons.js'

const BALANCE_MASK = '••••'

export const maskBalance = <T extends Promise<string> | string>(src: IStream<T> | T, hideBalances: IStream<boolean>): IStream<T> =>
  map(
    p => (!p.hide ? p.v : ((typeof p.v === 'string' ? (p.v === '-' ? p.v : BALANCE_MASK) : p.v.then(text => (text === '-' ? text : BALANCE_MASK))) as T)),
    combine({ hide: hideBalances, v: toStream(src) })
  )

export interface IAmountChange {
  usd: Promise<string> | string
  amount: Promise<string> | string
}

export interface I$AmountDisplay {
  hideBalances: IStream<boolean>
  usd: IStream<Promise<string> | string>
  amount?: IStream<Promise<string> | string> | string
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
  const $stack = (usdSrc: IStream<Promise<string> | string>, amountVal: IStream<Promise<string> | string> | string | undefined, $sep?: I$Node): I$Node =>
    $column(style({ gap: '2px', alignItems: align, textAlign: align === 'flex-end' ? 'right' : align === 'center' ? 'center' : 'left', minWidth: '0' }))(
      $node(
        style({ fontWeight: '600', fontFamily: 'var(--font-numbers)', fontSize: usdFontSize, color: palette.message }),
        styleBehavior(
          map(
            p => (p.zero ? { color: palette.foreground, fontWeight: '500' } : { color: p.c }),
            combine({
              zero: op(
                intermediateState(map(v => Promise.resolve(v), usdSrc)),
                reduce((zero: boolean, s) => (s.status === PromiseStatus.DONE ? Number(s.value.replace(/[^0-9.-]/g, '')) === 0 : zero), false)
              ),
              c: usdColor
            })
          )
        )
      )($intermediateText(maskBalance(usdSrc, hideBalances))),
      ...($sep ? [$sep] : []),
      ...(amountVal === undefined
        ? []
        : [
            $node(
              style({ fontSize: text.xs }),
              styleBehavior(map(c => ({ color: c }), amountColor))
            )($intermediateText(maskBalance(amountVal, hideBalances)))
          ])
    )
  const $current = $stack(usd, amount, $between)
  if (!change) return $current
  const next = op(change, state())
  const drafted = op(next, filterNull, state())
  return $row(spacing.small, style({ alignItems: 'center' }))(
    $current,
    switchLatest(
      map(
        p =>
          p.shown
            ? $row(spacing.small, style({ alignItems: 'center' }))(
                $icon({ $content: $arrowRight, width: '10px', viewBox: '0 0 32 32', fill: p.cl }),
                $stack(map(c => c.usd, drafted), map(c => c.amount, drafted))
              )
            : empty,
        combine({ shown: op(next, map(c => c !== null), skipRepeats), cl: op(color, skipRepeats) })
      )
    )
  )
}
