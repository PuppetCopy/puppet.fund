import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'

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

export const $windowDot = $row(style({ width: '8px', height: '8px', borderRadius: '50%' }))
export const $defaultMockWindow = $column(
  style({
    borderRadius: '6px',
    overflow: 'hidden',
    boxShadow: '#00000063 0px 5px 20px 3px',
    width: '100%',
    backgroundColor: palette.background
  })
)
export const $mockWindow = ($content: I$Node, $container = $defaultMockWindow): I$Node =>
  $container(
    $row(style({ backgroundColor: palette.background, alignItems: 'center', gap: '4px', padding: '6px 8px' }))(
      $windowDot(style({ backgroundColor: palette.negative }))(),
      $windowDot(style({ backgroundColor: palette.indeterminate }))(),
      $windowDot(style({ backgroundColor: palette.positive }))()
    ),
    $content
  )

export const $separator = $node(style({ color: palette.foreground, pointerEvents: 'none' }))($text('|'))
export const $responsiveFlex = isDesktopScreen ? $row(spacing.default) : $column(spacing.small, style({ flex: 1 }))

