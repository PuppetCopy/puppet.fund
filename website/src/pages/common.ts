import { style } from 'aelea/ui'
import { $separator } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'

export const $separator2 = style(
  { backgroundColor: colorShade(palette.foreground, 40), alignSelf: 'stretch', display: 'block' },
  $separator
)
