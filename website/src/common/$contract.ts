import DEPLOYMENTS from '@puppet/contracts/deployments'
import { CHAIN_MAP, HUB_CHAIN } from '@puppet/sdk/const'
import { getAccountExplorerUrl, readableAddress } from '@puppet/sdk/core'
import { $node, $text, attr, type I$Node, style } from 'aelea/ui'
import { palette } from 'aelea/ui-components-theme'
import { getAddress } from 'viem'
import type { Address } from 'viem/accounts'
import { $anchor, text } from '@/ui-components'

const CONTRACT_NAME_BY_ADDRESS: Record<string, string> = Object.fromEntries(
  Object.entries(DEPLOYMENTS).map(([key, value]) => [getAddress(value.address), key.split(':')[0]!])
)

export const contractNameFor = (address: Address): string | undefined => CONTRACT_NAME_BY_ADDRESS[getAddress(address)]

export const chainFor = (chainId: number) => CHAIN_MAP[chainId as keyof typeof CHAIN_MAP] ?? HUB_CHAIN

export const $contractIdentity = ({
  address,
  chainId,
  name,
  showAddress = false
}: {
  address: Address
  chainId: number
  name?: string
  showAddress?: boolean
}): I$Node => {
  const label = name ?? contractNameFor(address)
  const short = readableAddress(address)
  return $anchor(
    attr({
      href: getAccountExplorerUrl(address, chainFor(chainId)),
      target: '_blank'
    }),
    style({ display: 'inline-flex', alignItems: 'baseline', gap: '4px', minWidth: '0' })
  )(
    $text(label ?? short),
    ...(showAddress && label ? [$node(style({ color: palette.foreground, fontSize: text.xs }))($text(short))] : [])
  )
}
