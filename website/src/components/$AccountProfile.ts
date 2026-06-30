import type { IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictShareToken, symbolForBaseTokenId } from '@puppet/sdk/account'
import { BYTES32_ZERO } from '@puppet/sdk/const'
import {
  decodeFundName,
  type IFundRank,
  roboAvatarNameFromTraits,
  roboTraitsFromNameAndAddress,
  roboTraitsFromRank
} from '@puppet/sdk/ui-components'
import { combine, empty, map, switchLatest } from 'aelea/stream'
import { $node, $text, type I$Node, type INodeCompose, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Hex, hexToString, toHex } from 'viem'
import type { Address } from 'viem/accounts'
import { text } from '@/ui-components'
import { $jazzicon } from '../common/$avatar.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { livePlatformScale, liveFundPool } from '../io/live.js'
import { fundRank } from '../io/matchmaker/reads.js'
import { $tokenIconBySymbol } from './portfolio/$tokenOption.js'

export const readableAccountName = (name?: Hex | null): string | undefined => {
  if (!name || name === BYTES32_ZERO) return undefined
  const decoded = decodeFundName(hexToString(name, { size: 32 })).displayName.trim()
  return decoded.length > 0 ? decoded : undefined
}

export const fundNameTraits = (name: Hex | null | undefined, seed: Address): Record<string, string> => {
  const indices = name && name !== BYTES32_ZERO ? decodeFundName(hexToString(name, { size: 32 })).indices : null
  return roboTraitsFromNameAndAddress(indices, seed)
}

export const fundRankTraits = (
  name: Hex | null | undefined,
  seed: Address,
  rank: IFundRank
): Record<string, string> => {
  const indices = name && name !== BYTES32_ZERO ? decodeFundName(hexToString(name, { size: 32 })).indices : null
  return roboTraitsFromRank(indices, seed, rank)
}

export const accountNameToHex = (name: string): Hex => {
  const encoder = new TextEncoder()
  let byteCount = 0
  let truncated = ''
  for (const codePoint of name) {
    const size = encoder.encode(codePoint).length
    if (byteCount + size > 32) break
    byteCount += size
    truncated += codePoint
  }
  return toHex(truncated, { size: 32 })
}

export const $profileDisplay = ({
  $container = $row,
  address,
  name,
  ensName,
  showAddress = true,
  profileSize = 45,
  isFund = true,
  user,
  $avatar,
  $labelContainer
}: {
  $container?: INodeCompose
  address: Address
  name?: Hex | null
  ensName?: string | null
  showAddress?: boolean
  profileSize?: number
  isFund?: boolean
  user?: Address
  $avatar?: I$Node
  $labelContainer?: INodeCompose
}) => {
  const $fundAvatar = switchLatest(
    map(
      ({ scale, pool }) =>
        $roboAvatar(
          address,
          profileSize,
          fundRankTraits(name, address, fundRank(pool ? { navPerShare: pool.navPerShare, realisedPnlUsd: 0n } : null, scale))
        ),
      combine({ scale: livePlatformScale, pool: liveFundPool(address) })
    )
  )
  return $container(spacing.small, style({ alignItems: 'center', textDecoration: 'none' }))(
    $avatar ?? (isFund ? $fundAvatar : $jazzicon(user ?? address, profileSize)),
    showAddress
      ? $accountLabel({
          address: isFund ? address : (user ?? address),
          ensName: readableAccountName(name) ?? ensName,
          $container: $labelContainer
        })
      : empty
  )
}

// THE fund identity display: rounded robo avatar seeded by the predicted ShareToken,
// the base-token icon floated into its corner, and the fund name as the label. A fund's
// identity IS its ShareToken (master + base token + name), so this takes the init params.
export const $fundProfile = (share: IFundAccountLib__FundAccountInitParams, size = 36): I$Node => {
  const shareToken = predictShareToken(share)
  const traits = fundNameTraits(share.name, shareToken)
  const symbol = symbolForBaseTokenId(share.baseToken)
  const px = isDesktopScreen ? size : Math.round(size * 0.78)
  const $avatar = switchLatest(
    map(
      ({ scale, pool }) =>
        $roboAvatar(
          shareToken,
          px,
          fundRankTraits(
            share.name,
            shareToken,
            fundRank(pool ? { navPerShare: pool.navPerShare, realisedPnlUsd: 0n } : null, scale)
          )
        ),
      combine({ scale: livePlatformScale, pool: liveFundPool(predictFundAccount(share)) })
    )
  )
  return $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $node(
      style({
        width: `${px}px`,
        height: `${px}px`,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: '0'
      })
    )($avatar),
    $column(style({ minWidth: '0', gap: '2px' }))(
      $node(
        style({
          fontWeight: '600',
          fontSize: isDesktopScreen ? text.lg : text.base,
          color: palette.message,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        })
      )($text(readableAccountName(share.name) ?? roboAvatarNameFromTraits(traits))),
      $row(style({ alignItems: 'center', gap: '4px' }))(
        symbol ? $tokenIconBySymbol(symbol, '16px') : empty,
        $accountLabel({ address: predictFundAccount(share), primarySize: 1 })
      )
    )
  )
}

export const $accountLabel = ({
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
    return $container(style({ alignItems: 'baseline', flexDirection: 'row', minWidth: '0' }))(
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

  return $container(style({ alignItems: 'baseline', flexDirection: 'row' }))(
    $node(style({ fontSize: `${secondarySize}rem`, color: palette.foreground }))($text(`${address.slice(0, 6)}…`)),
    $node(style({ fontSize: `${primarySize}rem` }))($text(address.slice(-4)))
  )
}
