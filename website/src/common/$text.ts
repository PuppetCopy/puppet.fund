import { $custom, style } from 'aelea/ui'
import { palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'

export const $heading1 = $custom('h1')(
  style({ fontSize: text.xxl, fontWeight: 900, letterSpacing: '.05em', margin: 0 })
)
export const $heading2 = $custom('h2')(style({ fontSize: text.xl, letterSpacing: '.05em', margin: 0 }))
export const $heading3 = $custom('h3')(
  style({ color: palette.message, fontSize: text.base, letterSpacing: '.05em', margin: 0 })
)
