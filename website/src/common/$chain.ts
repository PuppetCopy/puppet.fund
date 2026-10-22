import { chainNameOf } from '@puppet/sdk/const'
import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import chain1 from '../assets/chain/1.svg'
import chain10 from '../assets/chain/10.svg'
import chain137 from '../assets/chain/137.svg'
import chain42161 from '../assets/chain/42161.svg'
import chain43114 from '../assets/chain/43114.svg'
import chain4326 from '../assets/chain/4326.svg'
import chain4663 from '../assets/chain/4663.svg'
import chain8453 from '../assets/chain/8453.svg'

export const chainName = (id: number): string => chainNameOf(id) ?? `Chain ${id}`

const CHAIN_ICON: Record<number, string> = {
  1: chain1,
  10: chain10,
  137: chain137,
  4326: chain4326,
  4663: chain4663,
  8453: chain8453,
  42161: chain42161,
  43114: chain43114
}

const chainAssetSrc = (chainId: number): string | undefined => CHAIN_ICON[chainId]

const px = (size: number | string): string => (typeof size === 'number' ? `${size}px` : size)

export const $chainIcon = (chainId: number, size: number | string = 20): I$Node =>
  $element('img')(
    attr({ src: chainAssetSrc(chainId), width: px(size), height: px(size) }),
    style({ borderRadius: '50%', flexShrink: '0' })
  )()

export const $chainLabel = (chainId: number, iconSize: number | string = 20): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $chainIcon(chainId, iconSize),
    $node(style({ color: palette.message }))($text(chainName(chainId)))
  )

export const $chainBadge = (chainId: number, badgeSize: number | string = 12): I$Node =>
  $element('img')(
    attr({ src: chainAssetSrc(chainId) }),
    style({
      position: 'absolute',
      right: '0',
      bottom: '0',
      width: px(badgeSize),
      height: px(badgeSize),
      borderRadius: '50%',
      boxShadow: `0 0 0 2px ${palette.background}`,
      background: palette.background
    })
  )()

export const $tokenWithChainBadge = (
  $tokenIcon: I$Node,
  chainId: number,
  size: number | string = 28,
  badgeSize: number | string = 12
): I$Node =>
  $node(
    style({
      position: 'relative',
      width: px(size),
      height: px(size),
      flexShrink: '0',
      lineHeight: '0'
    })
  )($tokenIcon, $chainBadge(chainId, badgeSize))
