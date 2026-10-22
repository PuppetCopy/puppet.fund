import { jazziconSvg } from '@puppet/sdk/ui-components'
import { $node, $wrapNativeElement, type I$Node, style } from 'aelea/ui'
import { $row } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem/accounts'

export const AVATAR_SIZE = 42

export const $avatarBadge = $node(
  style({
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: palette.background,
    border: `1px solid ${colorShade(palette.foreground, 40)}`
  })
)

export const $badged = ($avatar: I$Node, $badge: I$Node | null): I$Node =>
  $node(style({ position: 'relative', display: 'flex', flexShrink: '0', lineHeight: '0' }))(
    $avatar,
    ...($badge === null ? [] : [$node(style({ position: 'absolute', right: '-3px', bottom: '-3px' }))($badge)])
  )

export function $jazzicon(address: Address, size?: number) {
  const $svg = $wrapNativeElement(new DOMParser().parseFromString(jazziconSvg(address), 'image/svg+xml').documentElement)()
  return size === undefined
    ? $svg
    : $row(
        style({ width: `${size}px`, height: `${size}px`, borderRadius: '50%', overflow: 'hidden', flexShrink: '0' })
      )($svg)
}
