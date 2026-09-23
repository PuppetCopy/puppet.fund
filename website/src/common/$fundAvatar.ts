import { GRID, type ICells } from '@puppet/sdk/ui-components'
import { $svg, attr, type I$Node, style } from 'aelea/ui'

export const $fundAvatar = (cells: ICells, size = 48): I$Node =>
  $svg('svg')(
    attr({ viewBox: `0 0 ${GRID} ${GRID}`, 'shape-rendering': 'crispEdges', width: `${size}`, height: `${size}` }),
    style({ borderRadius: '50%', flexShrink: '0' })
  )(
    ...cells.map((colour, i) =>
      $svg('rect')(attr({ x: `${i % GRID}`, y: `${Math.floor(i / GRID)}`, width: '1', height: '1', fill: colour }))()
    )
  )
