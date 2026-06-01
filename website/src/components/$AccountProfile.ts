import { EMPTY_NAME } from '@puppet/sdk/account'
import { empty, type IStream, map, switchLatest } from 'aelea/stream'
import { $node, $text, type I$Node, type INodeCompose, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Hex, hexToString } from 'viem'
import type { Address } from 'viem/accounts'
import { $infoLabel, text } from '@/ui-components'
import { $jazzicon } from '../common/$avatar.js'
import { $pixelAvatar } from '../common/$pixelAvatar.js'
import { $card2 } from '../common/elements/$common.js'

export const readableAccountName = (name?: Hex | null): string | undefined => {
  if (!name || name === EMPTY_NAME) return undefined
  const decoded = hexToString(name, { size: 32 }).trim()
  return decoded.length > 0 ? decoded : undefined
}

export const $profileDisplay = ({
  $container = $row,
  address,
  name,
  ensName,
  showAddress = true,
  profileSize = 45,
  pixel = true,
  $labelContainer
}: {
  $container?: INodeCompose
  address: Address
  name?: Hex | null
  ensName?: string | null
  showAddress?: boolean
  profileSize?: number
  pixel?: boolean
  $labelContainer?: INodeCompose
}) => {
  return $container(spacing.small, style({ alignItems: 'center', textDecoration: 'none' }))(
    $profileAvatar({ size: profileSize, address, pixel }),
    showAddress
      ? $AccountLabel({
          address,
          ensName: readableAccountName(name) ?? ensName,
          $container: $labelContainer
        })
      : empty
  )
}

export const $profileAvatar = ({
  address,
  size = isDesktopScreen ? 50 : 36,
  pixel = true
}: {
  address: Address
  size?: number
  pixel?: boolean
}) => {
  return $row(style({ width: `${size}px`, borderRadius: '50%', overflow: 'hidden', height: `${size}px` }))(
    pixel ? $pixelAvatar(address) : $jazzicon(address)
  )
}

export const $disconnectedWalletDisplay = ($container = $row, size = 50) => {
  return $container(spacing.small, style({ alignItems: 'center', textDecoration: 'none' }))(
    $node(style({ width: `${size}px`, aspectRatio: '1 / 1', borderRadius: '50%' }))(
      style({
        display: 'flex',
        border: `1px solid ${colorShade(palette.foreground, 40)}`,
        placeContent: 'center',
        alignItems: 'center'
      })
    )($node(style({ fontWeight: 800, color: palette.foreground }))($text('?'))),
    $column(style({ whiteSpace: 'nowrap', fontSize: text.sm, alignItems: 'center' }))(
      $node(style({}))($text('0x----')),
      $node(style({ fontSize: text.xxl, lineHeight: 1 }))($text('----'))
    )
  )
}

export const $stubAccountDisplay = ({
  address,
  $title = $infoLabel($text('Your account')),
  $detail,
  $action,
  profileSize = 48
}: {
  address: IStream<Address>
  $title?: I$Node
  $detail?: I$Node
  $action?: I$Node
  profileSize?: number
}) => {
  return $card2(
    style({
      width: '100%',
      borderRadius: '30px',
      padding: '20px 24px',
      border: `1px solid ${colorShade(palette.foreground, 25)}`
    })
  )(
    $row(spacing.big, style({ alignItems: 'center' }))(
      $node(
        style({
          width: `${profileSize}px`,
          height: `${profileSize}px`,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: '0',
          border: `1px dashed ${colorShade(palette.foreground, 40)}`,
          opacity: '0.7'
        })
      )(switchLatest(map($pixelAvatar, address))),
      $column(spacing.small, style({ minWidth: '0', flex: '1' }))(
        $title,
        $detail ??
          $node(
            style({
              fontFamily: 'monospace',
              fontSize: text.base,
              color: palette.message,
              overflowWrap: 'anywhere'
            })
          )(switchLatest(map(a => $node($text(a)), address)))
      ),
      $action ??
        $node(
          style({
            flexShrink: '0',
            fontSize: text.xs,
            color: palette.foreground,
            border: `1px solid ${colorShade(palette.foreground, 30)}`,
            borderRadius: '100px',
            padding: '4px 10px'
          })
        )($text('Not created yet'))
    )
  )
}

export const $AccountLabel = ({
  address,
  ensName,
  $container = $column,
  primarySize = 1,
  secondarySize = primarySize * 0.85
}: {
  address: string
  ensName?: string | null
  $container?: INodeCompose
  primarySize?: number
  secondarySize?: number
}) => {
  // If ENS name exists, display it; otherwise fall back to shortened address
  if (ensName) {
    return $container(style({ alignItems: 'baseline', flexDirection: 'row' }))(
      $node(style({ fontSize: `${primarySize}rem` }))($text(ensName))
    )
  }

  return $container(style({ alignItems: 'baseline', flexDirection: 'row' }))(
    $node(style({ fontSize: `${secondarySize}rem`, color: palette.foreground }))($text(`${address.slice(0, 6)}..`)),
    $node(style({ fontSize: `${primarySize}rem` }))($text(address.slice(-4)))
  )
}
