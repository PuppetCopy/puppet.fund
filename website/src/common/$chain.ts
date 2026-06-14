import { VIEM_CHAINS } from '@puppet/sdk/const'
import { $element, $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'

export const chainName = (id: number): string => VIEM_CHAINS.find(c => c.id === id)?.name ?? `Chain ${id}`

const BLOCKSCOUT_BASE: Record<number, string> = {
  1: 'https://eth.blockscout.com',
  10: 'https://optimism.blockscout.com',
  56: 'https://bsc.blockscout.com',
  100: 'https://gnosis.blockscout.com',
  130: 'https://unichain.blockscout.com',
  137: 'https://polygon.blockscout.com',
  324: 'https://zksync.blockscout.com',
  480: 'https://worldchain-mainnet.explorer.alchemy.com',
  1101: 'https://zkevm.blockscout.com',
  5000: 'https://mantle.blockscout.com',
  8453: 'https://base.blockscout.com',
  34443: 'https://explorer.mode.network',
  42161: 'https://arbitrum.blockscout.com',
  42170: 'https://arbitrum-nova.blockscout.com',
  43114: 'https://avalanche.blockscout.com',
  59144: 'https://explorer.linea.build',
  81457: 'https://blast.blockscout.com',
  534352: 'https://scroll.blockscout.com',
  7777777: 'https://explorer.zora.energy',
  11155111: 'https://eth-sepolia.blockscout.com',
  84532: 'https://base-sepolia.blockscout.com',
  421614: 'https://arbitrum-sepolia.blockscout.com',
  11155420: 'https://optimism-sepolia.blockscout.com'
}

export const chainExplorerAddressUrl = (chainId: number, address: string): string => {
  const explorerBase = BLOCKSCOUT_BASE[chainId] ?? VIEM_CHAINS.find(c => c.id === chainId)?.blockExplorers?.default.url
  return explorerBase ? `${explorerBase}/address/${address}` : `https://blockscout.com/address/${address}`
}

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
