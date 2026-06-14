import { isStream } from 'aelea/stream'
import { $node, $text, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, $Tooltip, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'

export const $tooltipDropContainer = $column(
  style({
    whiteSpace: 'pre-wrap',
    maxWidth: '600px',
    userSelect: 'text',
    background: colorShade(palette.foreground, 14),
    border: `1px solid ${colorShade(palette.foreground, 32)}`,
    boxShadow: `${palette.shadow} 0px 4px 20px 8px, ${palette.shadow} 0px 1px 3px 1px`,
    padding: '16px',
    minWidth: '300px',
    borderRadius: '8px'
  })
)

import { text } from '@/ui-components'
import { $fromText, $icon } from './$common.js'
import { $caretDblDown, $info } from './$icons.js'

export const $infoLabel = $node(style({ color: palette.foreground }))

// Inline `<muted-label> <value>` row. When `tooltip` is set the label + info
// icon together become the tooltip trigger.
export const $labeledValue = (label: string | I$Slottable, value: string | I$Slottable, tooltip?: I$Slottable) =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    tooltip
      ? $Tooltip({
          $dropContainer: $tooltipDropContainer,
          $content: tooltip,
          $anchor: $row(style({ alignItems: 'center', cursor: 'help' }))(
            $infoLabel($fromText(label)),
            $icon({
              $content: $info,
              viewBox: '0 0 32 32',
              fill: palette.foreground,
              size: '20px',
              svgOps: style({ padding: '0 4px' })
            })
          )
        })({})
      : $infoLabel($fromText(label)),
    isStream(value) ? value : $text(value)
  )

export const $infoTooltip = (text: string | I$Slottable, color = palette.foreground, size = '24px') =>
  $Tooltip({
    $dropContainer: $tooltipDropContainer,
    $content: isStream(text) ? text : $node($text(text)),
    $anchor: $icon({
      $content: $info,
      viewBox: '0 0 32 32',
      fill: color,
      size,
      svgOps: style({ display: 'block', flexShrink: '0', padding: '2px', cursor: 'help' })
    })
  })({})

export const $labeledDivider = (label: string | I$Slottable) =>
  $row(spacing.default, style({ placeContent: 'center', alignItems: 'center' }))(
    $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))(),
    $row(spacing.small, style({ color: palette.foreground, alignItems: 'center' }))(
      $node(style({ fontSize: text.sm }))($fromText(label)),
      $icon({ $content: $caretDblDown, width: '10px', viewBox: '0 0 32 32', fill: palette.foreground })
    ),
    $column(style({ flex: 1, borderBottom: `1px solid ${palette.horizon}` }))()
  )
