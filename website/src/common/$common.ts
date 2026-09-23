import { PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { dustToZeroUsd, getAccountExplorerUrl, getTokenDescription, type ITokenDescription, readableAddress, readableLeverage, readablePnl, readableUsd } from '@puppet/sdk/core'
import { type IStream, just, map, skipRepeats, switchMap, toStream } from 'aelea/stream'
import { PromiseStatus, promiseState } from 'aelea/stream-extended'
import { $node, $text, attr, type I$Node, style, styleBehavior } from 'aelea/ui'
import { $column, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import { $anchor, $defaultTooltipDropContainer, $errorLabel, $icon, $inlineSpinner, $Tooltip, $tokenIconMap, $unknown, text } from '@/ui-components'
import context from '../io/context.js'
import { $separator2 } from '../pages/common.js'
import { $chainIcon, $tokenWithChainBadge, chainName } from './$chain.js'
import { chainFor } from './$contract.js'

export const $midContainer = $column(
  style({
    margin: '0 auto',
    maxWidth: '820px',
    padding: `0 ${isDesktopScreen ? '12px' : '0'} 26px`,
    gap: isDesktopScreen ? '50px' : '50px',
    width: '100%'
  })
)

export const $size = (size: bigint, collateral: bigint, $divider = $separator2) => {
  return $column(spacing.tiny)($text(readableUsd(size)), $divider, $leverage(size, collateral))
}

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

export const $tokenProfile = (chainId: ChainId, token: Address, size = 32, badge = true) => {
  const description = getTokenDescription(chainId, token)
  const native = isAddressEqual(token, PROTOCOL.nativeToken)
  const $tip = $Tooltip({
    $dropContainer: $defaultTooltipDropContainer,
    $content: $column(spacing.tiny, style({ fontSize: text.xs, whiteSpace: 'nowrap', color: palette.message }))(
      $detail('Chain', $row(spacing.tiny, style({ alignItems: 'center' }))($chainIcon(chainId, 14), $text(chainName(chainId)))),
      $detail(
        'Risk',
        switchMap(s => {
          if (s.status === PromiseStatus.PENDING) return $inlineSpinner
          if (s.status === PromiseStatus.ERROR) return $errorLabel(s.error)
          const listed = [...(s.value.get(chainId)?.keys() ?? [])].some(listedToken => isAddressEqual(listedToken, token))
          return $node(style({ color: listed ? palette.positive : palette.indeterminate }))($text(listed ? 'Verified' : 'Unverified'))
        }, promiseState(just(context.getTokenRegistry())))
      ),
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
  return $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $tip,
    $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(description.symbol))
  )
}

export const $tokenProfileStub = (size = 32) =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $node(style({ width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: palette.horizon, flexShrink: '0' }))(),
    $node(style({ width: '3em', height: '1.2em', borderRadius: '4px', background: palette.horizon, fontSize: text.base }))()
  )

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

  const colorStyle = styleBehavior(
    map(color => {
      return { color }
    }, displayColor)
  )

  return $node(colorStyle, style({ fontWeight: bold ? 'bold' : 'normal' }))($text(display))
}

