import { empty, isStream } from 'aelea/stream'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $icon, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $caretDblDown, text } from '@/ui-components'

export const $card = $column(
  spacing.default,
  style({
    borderRadius: '6px',
    boxShadow: 'var(--card-shadow)',
    padding: isDesktopScreen ? '28px' : '12px',
    backgroundColor: palette.background
  })
)

export const $card2 = $column(
  spacing.default,
  style({
    borderRadius: '6px',
    padding: '12px',
    backgroundColor: palette.middleground,
    boxShadow: 'rgba(0, 0, 0, 0.25) 0px 4px 20px 0px'
  })
)

export const $separator = $node(style({ color: palette.foreground, pointerEvents: 'none' }))($text('|'))
export const $responsiveFlex = isDesktopScreen ? $row(spacing.default) : $column(spacing.small, style({ flex: 1 }))

export const $labeledDivider = (label: string | I$Node, displayIcon = true) => {
  return $row(spacing.default, style({ placeContent: 'center', alignItems: 'center' }))(
    $column(style({ flex: 1, borderBottom: `1px solid ${colorShade(palette.foreground, 40)}` }))(),
    $row(spacing.small, style({ alignItems: 'center' }))(
      isStream(label) ? label : $node(style({ fontSize: text.sm }))($text(label)),
      displayIcon
        ? $icon({ $content: $caretDblDown, width: '10px', viewBox: '0 0 32 32', fill: palette.foreground })
        : empty
    ),
    $column(style({ flex: 1, borderBottom: `1px solid ${colorShade(palette.foreground, 40)}` }))()
  )
}
