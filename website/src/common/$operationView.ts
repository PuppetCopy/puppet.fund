import { VENUES } from '@puppet/sdk/venue'
import { empty } from 'aelea/stream'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $icon, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $gmx, $hyperliquid, text } from '@/ui-components'
import type { IStepField, IVenueAction } from './operation.js'

const VENUE_ICON: Record<string, I$Node> = {
  gmx: $icon({ $content: $gmx, size: '16px', viewBox: '0 0 32 32', fill: palette.message }),
  hyperliquid: $icon({ $content: $hyperliquid, size: '16px', viewBox: '-2 19 158 158', fill: palette.message })
}

export const $venueIcon = (venue: string): I$Node => {
  const known = VENUES.find(v => v.name === venue || v.venueId === venue)
  if (known === undefined) return empty
  const icon = VENUE_ICON[known.venueId]
  if (icon !== undefined) return icon
  return $node(
    style({
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      backgroundColor: colorShade(palette.message, 20),
      color: palette.message,
      fontSize: '8px',
      fontWeight: '700',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0'
    })
  )($text(known.name.slice(0, 2).toUpperCase()))
}

export const $venueFields = (fields: readonly IStepField[]): I$Node =>
  $column(style({ gap: '2px', minWidth: '160px' }))(
    ...fields.map(field =>
      $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', whiteSpace: 'normal' }))(
        $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(field.label)),
        $node(style({ fontSize: text.xs, color: palette.message, wordBreak: 'break-all', textAlign: 'right' }))($text(field.value))
      )
    )
  )

export const $venueHeadline = (x: IVenueAction, ...$extra: I$Node[]): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: 0 }))(
    $venueIcon(x.venue),
    $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(x.venue)),
    $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(x.label)),
    ...$extra
  )
