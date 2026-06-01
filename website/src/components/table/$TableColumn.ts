import { getMappedValueFallback, getTimeAgo, readableDate, readablePercentage, toBasisPoints } from '@puppet/sdk/core'
import { getPositionPnlUsd } from '@puppet/sdk/gmx'
import { empty, filterNull, map, skipRepeats, switchMap, toStream } from 'aelea/stream'
import { $node, $text, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { getAddress } from 'viem'
import type { Address } from 'viem/accounts'
import { $defaultTableCell, $infoTooltip, type TableColumn, text } from '@/ui-components'
import { $entry, $openPositionBreakdown, $pnlDisplay, $puppetList, $size } from '../../common/$common.js'
import { latestPriceMap } from '../../io/gmx/priceFeed.js'
import { $separator2 } from '../../pages/common.js'
import type { IPosition } from '../../pages/types.js'
import { isPositionSettled } from '../../utils/utils.js'

export const $tableHeader = (primaryLabel: string, secondaryLabel: string) =>
  $column(style({ whiteSpace: 'nowrap' }))(
    $node(style({ fontWeight: 'bold' }))($text(primaryLabel)),
    $node(style({ fontSize: text.sm }))($text(secondaryLabel))
  )

export const sizeColumn = (): TableColumn<IPosition> => ({
  $head: $tableHeader('Max Size', 'Leverage'),
  gridTemplate: '78px',
  $bodyCallback: map(mp => {
    return $size(mp.maxSizeInUsd, mp.maxCollateralInUsd)
  })
})

export const entryColumn: TableColumn<IPosition> = {
  $head: $text('Entry'),
  $bodyCallback: map(pos => {
    return $entry(pos)
  })
}

export const puppetsColumn: TableColumn<IPosition> = {
  $head: $text('Puppets'),
  gridTemplate: '90px',
  $bodyCallback: map(pos => {
    return $puppetList(pos.puppetList)
  })
}

export const pnlColumn = (_puppet?: Address): TableColumn<IPosition> => ({
  $head: $tableHeader('PnL $', 'ROI'),
  gridTemplate: '100px',
  $bodyCellContainer: $defaultTableCell(style({ placeContent: 'flex-start' })),
  $bodyCallback: map(pos => {
    const latestPrice = filterNull(
      map(pm => {
        const oraclePrice = getMappedValueFallback(pm, getAddress(pos.indexToken), null)

        if (oraclePrice === null) {
          return null
        }
        return oraclePrice.price
      }, latestPriceMap)
    )
    const isSettled = isPositionSettled(pos)

    const totalFeesUsd = 0n

    const pnl = isSettled
      ? pos.realisedPnlUsd
      : map(price => {
          return (
            pos.realisedPnlUsd +
            getPositionPnlUsd(pos.isLong, pos.lastUpdate.sizeInUsd, pos.lastUpdate.sizeInTokens, price) -
            totalFeesUsd
          )
        }, latestPrice)

    const displayColor = skipRepeats(
      map(value => {
        return value > 0n ? palette.positive : value === 0n ? palette.foreground : palette.negative
      }, toStream(pnl))
    )

    return isSettled
      ? $pnlDisplay(pnl)
      : $column(spacing.tiny)(
          $row(style({ alignItems: 'center' }))(
            switchMap(color => {
              return style({ backgroundColor: colorShade(color, 10), borderRadius: '50%' })(
                $infoTooltip($openPositionBreakdown(pos), color, '18px')
              )
            }, displayColor),
            $pnlDisplay(pnl)
          ),
          $separator2,
          // $liquidationSeparator(pos.isLong, pos.lastUpdate.sizeInUsd, pos.lastUpdate.sizeInTokens, pos.lastUpdate.collateralAmount, latestPrice),
          $node(style({ fontSize: text.sm }))(
            $text(
              map(value => {
                return readablePercentage(toBasisPoints(value, pos.maxCollateralInUsd))
              }, toStream(pnl))
            )
          )
        )
  })
})

export const timeColumn: TableColumn<IPosition> = {
  $head: $text('Settle Timestamp'),
  gridTemplate: 'minmax(110px, 120px)',
  // sortBy: 'openTimestamp',
  $bodyCallback: map(pos => {
    return pos.lastUpdate.sizeInUsd === 0n
      ? $column(spacing.tiny)(
          $text(getTimeAgo(pos.lastUpdateTimestamp)),
          $row(spacing.small)($node(style({ fontSize: text.sm }))($text(readableDate(pos.lastUpdateTimestamp))))
        )
      : empty
  })
}
