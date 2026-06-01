import { HUB_CHAIN } from '@puppet/sdk/const'
import { getExplorerUrl, readableAddress, readableHash } from '@puppet/sdk/core'
import { type IOps, type IStream, isStream, map, o } from 'aelea/stream'
import {
  $element,
  $node,
  $svg,
  $text,
  attr,
  type I$Node,
  type I$Text,
  type INode,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Chain } from 'viem/chains'

export const $elipsisTextWrapper = $node(
  style({ overflow: 'hidden', minHeight: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' })
)

export const $anchor = $element('a')(
  spacing.tiny,
  attr({ target: '_blank' }),
  stylePseudo(':hover', {
    color: `${colorShade(palette.primary, 50)}!important`,
    fill: colorShade(palette.primary, 50)
  }),
  style({
    cursor: 'pointer',
    color: palette.message,
    alignItems: 'center',
    display: 'inline-flex'
  })
)

export const $label = $element('label')(
  spacing.small,
  style({ color: palette.foreground, cursor: 'pointer', display: 'flex' })
)

export const $fromText = (text: string | I$Text): I$Text => (isStream(text) ? text : $text(text))

interface Icon {
  $content: I$Node
  size?: string
  width?: string
  height?: string
  viewBox?: string
  fill?: string | IStream<string>
  svgOps?: IOps<INode<SVGSVGElement>, INode<SVGSVGElement>>
}

export const $icon = ({
  $content,
  size,
  width = size ?? '24px',
  height = size,
  viewBox = '0 0 32 32',
  fill = 'inherit',
  svgOps = o()
}: Icon) =>
  $svg('svg')(
    attr({ viewBox }),
    style({ width, ...(height ? { height } : { aspectRatio: '1 / 1' }) }),
    isStream(fill) ? styleBehavior(map(f => ({ fill: f }), fill)) : style({ fill }),
    svgOps
  )($content)

export function $txHashRef(txHash: string, chain: Chain = HUB_CHAIN) {
  const href = `${getExplorerUrl(chain)}/tx/${txHash}`
  return $anchor(attr({ href }))($text(readableHash(txHash)))
}

export function $addressRef(addr: string, chain: Chain = HUB_CHAIN) {
  const href = `${getExplorerUrl(chain)}/address/${addr}`
  return $anchor(attr({ href }))($text(readableAddress(addr)))
}
