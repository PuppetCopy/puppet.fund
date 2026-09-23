import { readableAddress } from '@puppet/sdk/core'
import type { ICells } from '@puppet/sdk/ui-components'
import { $node, $text, attr, type I$Node, style, stylePseudo } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, href } from 'aelea/ui-router'
import type { Address } from 'viem'
import { $anchor, softNavClick } from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $jazzicon } from '../common/$avatar.js'
import { $fundAvatar } from '../common/$fundAvatar.js'

export const $accountLabel = ({
  address,
  ensName,
  primarySize = 1
}: {
  address: string
  ensName?: string | null
  primarySize?: number
}) => {
  if (ensName) {
    return $column(style({ alignItems: 'baseline', flexDirection: 'row', minWidth: '0' }))(
      $node(
        style({
          fontSize: `${primarySize}rem`,
          minWidth: '0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        })
      )($text(ensName))
    )
  }

  return $column(style({ alignItems: 'baseline', flexDirection: 'row' }))(
    $node(style({ fontSize: `${primarySize * 0.85}rem`, color: palette.foreground }))($text(`${address.slice(0, 6)}…`)),
    $node(style({ fontSize: `${primarySize}rem` }))($text(address.slice(-4)))
  )
}

export const $fundProfile = (master: Address, cells: ICells, name: string | null, size = 28): I$Node => {
  const url = href(routeSchema.traders.detail, { master })
  return $defaultAnchor(
    attr({ href: url }),
    spacing.small,
    style({ display: 'flex', alignItems: 'center', minWidth: '0', color: palette.message, textDecoration: 'none' }),
    softNavClick(url)
  )(
    $fundAvatar(cells, size),
    $column(style({ gap: '3px', minWidth: '0' }))(
      ...(name === null
        ? []
        : [$node(style({ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(name))]),
      $accountLabel({ address: master, primarySize: 0.85 })
    )
  )
}

export const $addressLink = (address: Address, size = 18): I$Node =>
  $anchor(
    attr({ href: `https://debank.com/profile/${address}`, target: '_blank', title: 'Portfolio on DeBank' }),
    style({ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0', color: 'inherit', textDecoration: 'none' }),
    stylePseudo(':hover', { opacity: '0.8' })
  )($jazzicon(address, size), $node(style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))($text(readableAddress(address))))
