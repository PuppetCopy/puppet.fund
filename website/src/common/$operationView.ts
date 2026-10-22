import { VENUE_ICONS } from '@puppet/sdk/ui-components'
import { VENUES } from '@puppet/sdk/venue'
import { empty } from 'aelea/stream'
import { $node, $text, $wrapNativeElement, attr, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $icon, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $anchor, $externalMark, text } from '@/ui-components'
import type { IStepField } from './operation.js'

const iconless = VENUES.map(venue => venue.venueId).filter(id => VENUE_ICONS[id] === undefined)
if (iconless.length > 0) throw new Error(`venue icon missing for ${iconless.join(', ')}: add it to VENUE_ICONS in sdk/src/ui-components/venueIcons.ts`)

export const $venueIcon = (venue: string, size: number): I$Node => {
  const known = VENUES.find(v => v.name === venue || v.venueId === venue)
  const icon = VENUE_ICONS[known === undefined ? venue : known.venueId]
  if (icon === undefined) return empty
  const body = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${icon.body}</svg>`, 'image/svg+xml').documentElement.firstElementChild
  if (body === null) throw new Error(`the icon of ${venue} has no shape`)
  return $icon({ $content: $wrapNativeElement(body)(), viewBox: icon.viewBox, size: `${size}px`, fill: palette.message })
}

export const $venueLink = (venue: string): I$Slottable => {
  const known = VENUES.find(v => v.name === venue || v.venueId === venue)
  if (known === undefined) return $text(venue)
  const host = known.dapp?.hosts[0]
  if (host === undefined) return $text(known.name)
  return $anchor(
    attr({ href: `https://${host}`, target: '_blank', rel: 'noopener noreferrer' }),
    style({ display: 'inline-flex', alignItems: 'center', color: palette.message })
  )($text(known.name), $externalMark())
}

export const $venueFields = (fields: readonly IStepField[]): I$Node =>
  $column(style({ gap: '2px', minWidth: '160px' }))(
    ...fields.map(field =>
      $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', whiteSpace: 'normal' }))(
        $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($text(field.label)),
        field.href === undefined
          ? $node(style({ fontSize: text.xs, color: palette.message, wordBreak: 'break-all', textAlign: 'right' }))($text(field.value))
          : $anchor(
              attr({ href: field.href, target: '_blank', rel: 'noopener noreferrer' }),
              style({ display: 'inline-flex', alignItems: 'center', fontSize: text.xs, color: palette.message, textAlign: 'right' })
            )($text(field.value), $externalMark())
      )
    )
  )
