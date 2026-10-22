import DEPLOYMENTS from '@puppet/contracts/deployments'
import { HUB_CHAIN, VIEM_CHAINS } from '@puppet/sdk/const'
import { getAccountExplorerUrl, readableAddress } from '@puppet/sdk/core'
import { $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { getAddress } from 'viem'
import type { Address } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { $anchor, $defaultTooltipDropContainer, $externalMark, $Tooltip, text } from '@/ui-components'

const CONTRACT_NAME_BY_ADDRESS: Record<string, string> = Object.fromEntries(
  Object.entries(DEPLOYMENTS).map(([key, value]) => [getAddress(value.address), key.split(':')[0]!])
)

export const contractNameFor = (address: Address): string | undefined => CONTRACT_NAME_BY_ADDRESS[getAddress(address)]

export const chainFor = (chainId: number) => [...VIEM_CHAINS, mainnet].find(chain => chain.id === chainId) ?? HUB_CHAIN

export const $contractIdentity = ({ address, chainId, name }: { address: Address; chainId: number; name?: string }): I$Node => {
  const label = name ?? contractNameFor(address)
  const $explorerLink = $anchor(
    attr({ href: getAccountExplorerUrl(address, chainFor(chainId)), target: '_blank' }),
    style({ display: 'inline-flex', alignItems: 'center', fontSize: text.xs, color: palette.foreground })
  )($text(readableAddress(address)), $externalMark())
  return label === undefined
    ? $explorerLink
    : $row(spacing.small, style({ alignItems: 'baseline', minWidth: '0' }))($node(style({ color: palette.message }))($text(label)), $explorerLink)
}

export const $contractPill = ({ address, chainId, name, detail }: { address: Address; chainId: number; name: string; detail: string }): I$Node =>
  $Tooltip({
    $dropContainer: $defaultTooltipDropContainer,
    $content: $column(spacing.tiny, style({ fontSize: text.xs, maxWidth: '260px', color: palette.message }))(
      $node(style({ fontWeight: '600' }))($text(name)),
      $node(style({ color: palette.foreground, lineHeight: '1.4' }))($text(detail)),
      $contractIdentity({ address, chainId })
    ),
    $anchor: $node(
      style({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: text.xs,
        color: palette.message,
        backgroundColor: colorShade(palette.horizon, 25),
        cursor: 'help',
        whiteSpace: 'nowrap'
      })
    )($text(name))
  })({})
