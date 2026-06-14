import {
  dustToZeroUsd,
  getMappedValueFallback,
  type ITokenDescription,
  readableDate,
  readableLeverage,
  readablePnl,
  readableUsd
} from '@puppet/sdk/core'
import { getPositionPnlUsd, getTokenDescription } from '@puppet/sdk/gmx'
import { empty, type IStream, map, skipRepeats, toStream } from 'aelea/stream'
import type { IBehavior, IComposeBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type INode, nodeEvent, style, styleInline } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem/accounts'
import {
  $errorCard,
  $icon,
  $infoLabel,
  $Link,
  $labeledDivider,
  $labeledValue,
  $Tooltip,
  $tokenIconMap,
  $unknown,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $accountLabel } from '../components/$AccountProfile.js'
import { latestPriceMap } from '../io/gmx/priceFeed.js'
import { $separator2 } from '../pages/common.js'
import type { IPosition } from '../pages/types.js'
import { isPositionSettled } from '../utils/utils.js'
import { $jazzicon } from './$avatar.js'
import { $roboAvatar } from './$roboAvatar.js'

export const $midContainer = $column(
  style({
    margin: '0 auto',
    maxWidth: '820px',
    padding: `0 ${isDesktopScreen ? '12px' : '0'} 26px`,
    gap: isDesktopScreen ? '50px' : '50px',
    width: '100%'
  })
)

// Centered, full-width recovery state for a failed network fetch: the shared $errorCard
// (icon + classified title/detail) stacked above a caller-supplied Retry control, so a
// failed list/table degrades into something the user can recover from with one tap instead
// of the default tiny inline alert pill. The Retry node is built by the caller so it can be
// tethered to re-trigger the specific fetch that failed.
export const $errorWithRetry = (error: unknown, $retry: I$Node): I$Node =>
  $column(
    spacing.default,
    style({ placeSelf: 'center', margin: 'auto', alignItems: 'center', padding: '24px 0', width: '100%' })
  )($errorCard(error), $retry)

export const $size = (size: bigint, collateral: bigint, $divider = $separator2) => {
  return $column(spacing.tiny)($text(readableUsd(size)), $divider, $leverage(size, collateral))
}

export const $entry = (pos: IPosition) => {
  const indexDescription = getTokenDescription(pos.indexToken)
  const collateralTokenDescription = getTokenDescription(pos.collateralToken)

  const $label = $node(style({ width: '125px' }))

  return $row(spacing.small, style({ alignItems: 'center' }))(
    $Tooltip({
      // $dropContainer: $defaultDropContainer,
      $content: $column(spacing.default)(
        $labeledValue($label($text('Market Token')), $tokenLabeled(indexDescription)),
        $labeledValue($label($text('Collateral Token')), $tokenLabeled(collateralTokenDescription)),
        isPositionSettled(pos)
          ? $labeledValue(
              $label($text('Close Time')),
              $node(style({ fontSize: text.sm }))($text(readableDate(pos.lastUpdateTimestamp)))
            )
          : empty
      ),
      $anchor: $route(indexDescription, false)
    })({}),
    $column(spacing.tiny)(
      $infoLabel($text(pos.isLong ? 'LONG' : 'SHORT')),
      $node(style({ fontSize: text.sm }))($text(readableUsd(pos.avgEntryPrice)))
    )
  )
}

export const $route = (collateralTokenDescription: ITokenDescription, displayLabel = true) => {
  return $row(spacing.small, style({ alignItems: 'center', position: 'relative' }))(
    $row(
      // style({
      //   width: '38px', height: '34x'
      // })(
      //   $tokenIcon(indexTokenDescription)
      // ),
      style({
        width: '32px',
        height: '34x'
      })($tokenIcon(collateralTokenDescription))
    ),
    displayLabel ? $column($text(`${collateralTokenDescription.symbol}`)) : empty
  )
}

export const $tokenLabeled = (indexDescription: ITokenDescription) => {
  return $row(spacing.small, style({ alignItems: 'center' }))(
    style({ width: '18px', height: '18px' })($tokenIcon(indexDescription)),
    $text(`${indexDescription.symbol}`)
  )
}

export const $tokenIcon = (tokenDesc: ITokenDescription, size = '32px', color = palette.message) => {
  const $token = getMappedValueFallback($tokenIconMap, tokenDesc.symbol, $unknown)

  if (!$token) {
    throw new Error('Unable to find matched token')
  }

  return $icon({
    $content: $token,
    size,
    fill: color,
    svgOps: style({ borderRadius: '50%' }),
    viewBox: '0 0 32 32'
  })
}

export const $tokenIconByAddress = (tokenAddress: Address, size = '24px') => {
  const tokenDesc = getTokenDescription(tokenAddress)

  if (!tokenDesc) {
    // Fallback to unknown icon if token not found
    return $icon({
      $content: $unknown,
      size,
      fill: palette.message,
      svgOps: style({ backgroundColor: palette.background, borderRadius: '50%' }),
      viewBox: '0 0 32 32'
    })
  }

  return $tokenIcon(tokenDesc, size)
}

export const $puppetList = (puppets?: Address[], click?: IComposeBehavior<INode, string>) => {
  if (!puppets || puppets.length === 0) {
    return $node(style({ fontSize: text.sm, color: palette.foreground }))($text('-'))
  }

  return $row(style({ cursor: 'pointer' }))(
    ...puppets.map(account => {
      if (!click) {
        return style({ marginRight: '-12px', border: '2px solid black' })($jazzicon(account, 25))
      }

      return click(
        nodeEvent('click'),
        map(() => {
          const url = `/position/${account}`

          history.pushState({}, '', url)
          return url
        })
      )(style({ marginRight: '-12px', border: '2px solid black' })($jazzicon(account, 25)))
    })
    // $content
  )
}

export const $leverage = (size: bigint, collateral: bigint) => {
  return $node(style({ fontWeight: 'bold', letterSpacing: '0.05em', fontSize: text.xs }))(
    $text(readableLeverage(size, collateral))
  )
}

export const $pnlDisplay = (pnlSrc: IStream<bigint> | bigint, bold = true) => {
  const pnl = map(dustToZeroUsd, toStream(pnlSrc))
  const display = map(value => readablePnl(value), pnl)
  const displayColor = skipRepeats(
    map(value => {
      return value > 0n ? palette.positive : value === 0n ? palette.foreground : palette.negative
    }, pnl)
  )

  const colorStyle = styleInline(
    map(color => {
      return { color }
    }, displayColor)
  )

  return $node(colorStyle, style({ fontWeight: bold ? 'bold' : 'normal' }))($text(display))
}

export const $drawdownDisplay = (maxDrawdown: bigint) => {
  // maxDrawdown is in basis points (2500 = 25%)
  const percentage = Number(maxDrawdown) / 100
  const color =
    maxDrawdown > 2000n ? palette.negative : maxDrawdown > 1000n ? palette.indeterminate : palette.foreground
  return $node(style({ color }))($text(`${percentage.toFixed(1)}%`))
}

export const $winRateDisplay = (wins: number, losses: number) => {
  const total = wins + losses
  if (total === 0) return $node(style({ color: palette.foreground }))($text('-'))

  const rate = (wins / total) * 100
  const color = rate >= 50 ? palette.positive : palette.negative

  return $column(spacing.tiny)(
    $node(style({ color, fontWeight: 'bold' }))($text(`${rate.toFixed(0)}%`)),
    $node(style({ fontSize: text.xs, color: palette.foreground }))($text(`${wins}W / ${losses}L`))
  )
}

export const $openPositionBreakdown = (pos: IPosition) => {
  const indexToken = pos.indexToken
  const latestPrice = map((pm: any) => {
    const price = pm[indexToken]
    return price && typeof price === 'object' && 'max' in price ? price.max : 0n
  }, latestPriceMap)

  const totalPositionFeeAmount = 0n
  const totalBorrowingFeeAmount = 0n
  const totalFundingFeeAmount = 0n

  const latestUpdate = pos.lastUpdate

  return $column(spacing.small, style({ minWidth: '250px' }))(
    $text('Net breakdown'),

    $row(style({ placeContent: 'space-between' }))(
      $node(style({ color: palette.foreground, flex: 1 }))($text('Collateral')),
      $text(readableUsd(latestUpdate.collateralInTokens * latestUpdate.collateralTokenPriceMax))
    ),
    $row(style({ placeContent: 'space-between' }))(
      $node(style({ color: palette.foreground, flex: 1 }))($text('Open Pnl')),
      $pnlDisplay(
        map(markPrice => {
          return getPositionPnlUsd(pos.isLong, pos.lastUpdate.sizeInUsd, pos.lastUpdate.sizeInTokens, markPrice)
        }, latestPrice)
      )
    ),

    $labeledDivider('Realised'),
    $row(style({ placeContent: 'space-between' }))(
      $node(style({ color: palette.foreground }))($text('Margin Fee')),
      $pnlDisplay(-totalPositionFeeAmount)
    ),
    $row(style({ placeContent: 'space-between' }))(
      $node(style({ color: palette.foreground }))($text('Borrowing Fee')),
      $pnlDisplay(-totalBorrowingFeeAmount)
    ),
    $row(style({ placeContent: 'space-between' }))(
      $node(style({ color: palette.foreground }))($text('Funding Fee')),
      $pnlDisplay(-totalFundingFeeAmount)
    ),
    $row(style({ placeContent: 'space-between' }))(
      $node(style({ color: palette.foreground }))($text('Realised Pnl')),
      $pnlDisplay(pos.realisedPnlUsd)
    )
  )
}

interface I$MasterDisplay {
  address: Address
  ensName?: string | null
  ensNameStream?: IStream<string | null>
  avatarSeed?: Address
  puppetList: Address[]
  labelSize?: number
  profileSize?: number
}
export const $MasterDisplay = (config: I$MasterDisplay) =>
  component(([click, clickTether]: IBehavior<any, Address>) => {
    const { address, ensName, ensNameStream, avatarSeed, puppetList, labelSize, profileSize = 50 } = config

    return [
      $Link({
        $content: $row(spacing.small, style({ alignItems: 'center', textDecoration: 'none', minWidth: '0' }))(
          $roboAvatar(avatarSeed ?? address, profileSize),
          labelSize === undefined || labelSize > 0
            ? $column(style({ gap: '3px', minWidth: '0' }))(
                $accountLabel({
                  address,
                  ensName,
                  primarySize: labelSize
                }),
                puppetList.length > 0
                  ? $row(style({ alignItems: 'center' }))(
                      ...puppetList.map(puppet => {
                        return style({ marginRight: '-12px', border: '2px solid black' })($jazzicon(puppet, 25))
                      }),
                      $node(style({ gap: '8px', marginLeft: '16px', fontSize: text.sm }))($text(`${puppetList.length}`))
                    )
                  : $row(style({ alignItems: 'center' }))(
                      $node(style({ color: palette.foreground, fontSize: text.sm }))($text('0 puppets'))
                    )
              )
            : empty
        ),
        route: routeSchema.fund.detail,
        params: { address }
      })({ click: clickTether() }),

      { click }
    ]
  })
