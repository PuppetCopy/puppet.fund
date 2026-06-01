import { VIEM_CHAINS } from '@puppet/sdk/const'
import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'

export const chainName = (id: number): string => VIEM_CHAINS.find(c => c.id === id)?.name ?? `Chain ${id}`

const chainAssetSrc = (chainId: number): string => `/assets/chain/${chainId}.svg`

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

// Small chain badge anchored flush to the bottom-right of a token glyph. The
// caller wraps the token icon in `$tokenWithChainBadge` (or any
// position:relative container) and appends this.
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

// Token icon (SVG glyph or other I$Node) with the chain badge tucked into the
// bottom-right corner. Caller passes the rendered token node so this stays
// agnostic of token-icon source.
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
