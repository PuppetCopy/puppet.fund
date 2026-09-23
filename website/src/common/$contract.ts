import DEPLOYMENTS from '@puppet/contracts/deployments'
import { CHAIN_MAP, HUB_CHAIN } from '@puppet/sdk/const'
import { getAccountExplorerUrl, readableAddress } from '@puppet/sdk/core'
import { $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { getAddress } from 'viem'
import type { Address } from 'viem/accounts'
import { $anchor, $external, $icon, text } from '@/ui-components'

const CONTRACT_NAME_BY_ADDRESS: Record<string, string> = Object.fromEntries(
  Object.entries(DEPLOYMENTS).map(([key, value]) => [getAddress(value.address), key.split(':')[0]!])
)

export const contractNameFor = (address: Address): string | undefined => CONTRACT_NAME_BY_ADDRESS[getAddress(address)]

export const chainFor = (chainId: number) => CHAIN_MAP[chainId as keyof typeof CHAIN_MAP] ?? HUB_CHAIN

export const $contractIdentity = ({ address, chainId, name }: { address: Address; chainId: number; name?: string }): I$Node => {
  const label = name ?? contractNameFor(address)
  const $explorerLink = $anchor(
    attr({ href: getAccountExplorerUrl(address, chainFor(chainId)), target: '_blank' }),
    style({ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: text.xs, color: palette.foreground })
  )($icon({ $content: $external, width: '10px', viewBox: '0 0 24 24', fill: palette.foreground }), $text(readableAddress(address)))
  return label === undefined
    ? $explorerLink
    : $row(spacing.small, style({ alignItems: 'baseline', minWidth: '0' }))($node(style({ color: palette.message }))($text(label)), $explorerLink)
}
