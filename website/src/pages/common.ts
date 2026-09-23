import { getDuration, getUnixTimestamp } from '@puppet/sdk/core'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $separator, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $infoLabel, text } from '@/ui-components'

export const $separator2 = style(
  { backgroundColor: colorShade(palette.foreground, 40), alignSelf: 'stretch', display: 'block' },
  $separator
)

export const $stack = ($primary: I$Node, $secondary: I$Node, align: 'flex-start' | 'flex-end'): I$Node =>
  $column(spacing.tiny, style({ alignItems: align, placeContent: 'center', whiteSpace: 'nowrap' }))($primary, $separator2, $secondary)

export const $headerStub = (width: string): I$Node =>
  $node(style({ width, height: '12px', borderRadius: '6px', background: colorShade(palette.foreground, 15) }))()

export const $headerFigure = (label: string): I$Node => $node(style({ fontSize: text.sm, color: palette.foreground, whiteSpace: 'nowrap' }))($text(label))

export const ago = (sec: number): string => `${getDuration(getUnixTimestamp() - sec)} ago`

export const $caption = (label: string): I$Node => $node(style({ fontSize: text.xs, color: palette.foreground }))($text(label))

export const $emptyNote = (title: string, detail: string): I$Node =>
  $column(spacing.tiny)(
    $node(style({ color: palette.message, fontSize: text.sm }))($text(title)),
    $infoLabel(style({ fontSize: text.xs }))($text(detail))
  )
