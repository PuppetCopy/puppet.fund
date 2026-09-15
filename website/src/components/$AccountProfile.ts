import { roboAvatarNameFromTraits, roboTraitsFromAddress } from '@puppet/sdk/ui-components'
import { $node, $text, style } from 'aelea/ui'
import { $column } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'

export const accountDisplayName = (address: Address): string => roboAvatarNameFromTraits(roboTraitsFromAddress(address))

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
