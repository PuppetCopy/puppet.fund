import type { ICells } from '@puppet/sdk/ui-components'
import { $svg, attr, type I$Node, style } from 'aelea/ui'
import { AVATAR_SIZE } from './$avatar.js'

export const $fundAvatar = (cells: ICells, size = AVATAR_SIZE): I$Node => {
  const side = Math.sqrt(cells.length)
  return $svg('svg')(
    attr({ viewBox: `0 0 ${side} ${side}`, 'shape-rendering': 'crispEdges', width: `${size}`, height: `${size}` }),
    style({ borderRadius: '50%', flexShrink: '0' })
  )(
    ...cells.map((colour, i) =>
      $svg('rect')(attr({ x: `${i % side}`, y: `${Math.floor(i / side)}`, width: '1', height: '1', fill: colour }))()
    )
  )
}
