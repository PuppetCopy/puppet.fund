import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { CHAIN_ID_LIST, type ChainId } from '@puppet/sdk/const'
import { getAccountExplorerUrl, getTokenDescription, type ITokenProfile, readableAddress } from '@puppet/sdk/core'
import { listedTokensOf } from '@puppet/sdk/state'
import { type IStream, map } from 'aelea/stream'
import { $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { $anchor, $defaultTooltipDropContainer, $icon, $intermediateCircle, $intermediateLine, $Tooltip, $tokenIconMap, $unknown, text } from '@/ui-components'
import { priceFor, usdOf } from '../io/price.js'
import { $chainIcon, $tokenWithChainBadge, chainName } from './$chain.js'
import { chainFor } from './$contract.js'

export const $midContainer = $column(
  style({
    margin: '0 auto',
    maxWidth: '860px',
    padding: `0 ${isDesktopScreen ? '12px' : '0'} 26px`,
    gap: isDesktopScreen ? '50px' : '50px',
    width: '100%'
  })
)

export const ethPrice = (): IStream<Promise<bigint | null>> => priceFor(HUB_CHAIN_ID as ChainId, HUB_CANONICAL_TOKEN.WETH)

export const ethUsd = (value: bigint): IStream<Promise<string>> => map(price => usdOf(value, price), ethPrice())

export const $tokenIcon = (symbol: string, size = '28px'): I$Node =>
  $icon({
    $content: $tokenIconMap[symbol] ?? $unknown,
    size,
    fill: palette.message,
    svgOps: style({ borderRadius: '50%' }),
    viewBox: '0 0 32 32'
  })

const $detail = (label: string, $value: I$Node) =>
  $row(spacing.small, style({ alignItems: 'center' }))($node(style({ color: palette.foreground, minWidth: '56px' }))($text(label)), $value)

export const $tokenMark = (chainId: number, token: Address, description: ITokenProfile, size: number, badge: boolean) => {
  const native = isAddressEqual(token, PROTOCOL.nativeToken)
  const registry = CHAIN_ID_LIST.find(id => id === chainId)
  const listed = registry === undefined ? null : listedTokensOf(registry).some(listedToken => isAddressEqual(listedToken, token))
  return $Tooltip({
    $dropContainer: $defaultTooltipDropContainer,
    $content: $column(spacing.tiny, style({ fontSize: text.xs, whiteSpace: 'nowrap', color: palette.message }))(
      $detail(
        'Token',
        $row(spacing.small, style({ alignItems: 'center' }))(
          $node($text(description.symbol)),
          ...(listed === null ? [] : [$node(style({ color: listed ? palette.positive : palette.indeterminate }))($text(listed ? 'Verified' : 'Unverified'))])
        )
      ),
      $detail('Chain', $row(spacing.tiny, style({ alignItems: 'center' }))($chainIcon(chainId, 14), $text(chainName(chainId)))),
      $detail(
        'Contract',
        native
          ? $node(style({ color: palette.foreground }))($text('Native token'))
          : $anchor(attr({ href: getAccountExplorerUrl(token, chainFor(chainId)), target: '_blank' }))($text(readableAddress(token)))
      )
    ),
    $anchor: $node(style({ display: 'flex', cursor: 'help' }))(
      badge ? $tokenWithChainBadge($tokenIcon(description.symbol, `${size}px`), chainId, size, Math.round(size * 0.45)) : $tokenIcon(description.symbol, `${size}px`)
    )
  })({})
}

export const $tokenProfile = (
  chainId: ChainId,
  token: Address,
  size = 28,
  badge = true,
  caption: string | I$Node | null = null,
  description: ITokenProfile = getTokenDescription(chainId, token)
) =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $tokenMark(chainId, token, description, size, badge),
    caption !== null
      ? $column(style({ minWidth: '0', lineHeight: '1.2' }))(
          $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(description.symbol)),
          $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(typeof caption === 'string' ? $text(caption) : caption)
        )
      : $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(description.symbol))
  )

export const $intermediateTokenProfile = (size = 28) =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))($intermediateCircle(size), $intermediateLine('3em', text.base))
