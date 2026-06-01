import { combine, type IStream, just, map } from 'aelea/stream'
import { $node, $text, type I$Slottable, style, styleBehavior } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $icon } from './$common.js'
import { $arrowRight } from './$icons.js'

export interface I$HintAdjustment {
  $val: I$Slottable
  // Empty string = no pending adjustment; arrow + text are hidden.
  change: IStream<string>
  color?: IStream<string>
}

export const $hintAdjustment = ({ change, color = just(palette.foreground), $val }: I$HintAdjustment) =>
  $row(spacing.small, style({ lineHeight: 1, alignItems: 'center' }))(
    styleBehavior(
      map(str => (str ? { color: palette.foreground } : {}), change),
      $node($val)
    ),
    $icon({
      $content: $arrowRight,
      width: '10px',
      viewBox: '0 0 32 32',
      svgOps: styleBehavior(
        map(p => (p.str ? { fill: p.color } : { display: 'none' }), combine({ str: change, color }))
      )
    }),
    $text(change)
  )
