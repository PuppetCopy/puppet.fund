import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { getMappedValueFallback, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { wrappedNativeAddressOf } from '@puppet/sdk/state'
import type { IStream } from 'aelea/stream'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, type Hex, isAddressEqual } from 'viem'
import { $amountDisplay, $icon, $labeledDivider, $tokenIconMap, $unknown, text } from '@/ui-components'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'

export interface ITokenInputOption {
  symbol: string
  chainId: number
  address: Address
  token: Hex
  balance: bigint | null
  decimals: number
  usdValue?: IStream<string>
  disabled?: boolean
  selected?: boolean
  swapGroupStart?: boolean
}

export const $tokenIconBySymbol = (sym: string, size = '28px'): I$Node =>
  $icon({
    $content: getMappedValueFallback($tokenIconMap, sym, $unknown),
    size,
    fill: palette.message,
    svgOps: style({ borderRadius: '50%' }),
    viewBox: '0 0 32 32'
  })

export const $optionRow = (hideBalances: IStream<boolean>, opt: ITokenInputOption): I$Node => {
  const hasBalance = opt.balance !== null && opt.balance > 0n
  const balanceText =
    opt.balance === null ? '-' : readableTokenAmountLabel({ decimals: opt.decimals, symbol: opt.symbol }, opt.balance)
  const $content = $row(
    spacing.default,
    style({
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
      padding: '8px',
      gap: '16px',
      borderRadius: '10px',
      opacity: opt.disabled ? '0.4' : hasBalance ? '1' : '0.5',
      cursor: opt.disabled ? 'not-allowed' : 'pointer',
      ...(opt.selected ? { backgroundColor: palette.horizon } : {})
    })
  )(
    $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
      $tokenWithChainBadge($tokenIconBySymbol(opt.symbol, '40px'), opt.chainId, 40, 18),
      $column(style({ gap: '1px', minWidth: '0' }))(
        $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(opt.symbol)),
        $node(style({ fontSize: text.xs, color: palette.foreground }))($text(chainName(opt.chainId)))
      )
    ),
    opt.balance !== null && opt.usdValue
      ? $amountDisplay({
          hideBalances,
          usd: opt.usdValue,
          amount: balanceText,
          align: 'flex-end',
          usdFontSize: text.sm
        })
      : $node(style({ fontSize: text.sm, color: palette.foreground }))($text(balanceText))
  )
  return opt.swapGroupStart
    ? $column(style({ flex: 1 }))(
        $node(style({ padding: '6px 8px 2px' }))(
          $labeledDivider($node(style({ fontSize: text.xs }))($text('Swap & Deposit')))
        ),
        $content
      )
    : $content
}

// Same-token sources lead (a plain deposit or same-asset bridge is the simple, cheap
// path); cross-asset swap sources follow under a labeled divider. USD value descending
// within each group.
export const decorateOptionList = (
  options: ITokenInputOption[],
  selected: { chainId: number; address: Address },
  priceOf: (opt: ITokenInputOption) => bigint | null,
  baseToken: Address
): ITokenInputOption[] => {
  // Rank on a single consistent USD scale: the relay price is decimals-adjusted (scale 30 - decimals), so
  // balance * price is uniformly usd * 1e30 across tokens. An unpriceable token has no comparable USD value, so it
  // sorts last (0) rather than on a different (token-amount) magnitude that would jumble the order.
  const usdOf = (opt: ITokenInputOption): number => {
    if (opt.balance === null || opt.balance === 0n) return 0
    const price = priceOf(opt)
    if (price === null) return 0
    return Number(formatUnits(opt.balance * price, USD_PRICE_DECIMALS))
  }
  // A native source on the hub whose base IS the hub wrapped-native deposits DIRECTLY (wrap via depositWnt), so it
  // belongs in the base group, not under "Swap & Deposit" — same condition the editors use to skip the swap route.
  const hubWnt = wrappedNativeAddressOf(HUB_CHAIN_ID)
  const isSwap = (opt: ITokenInputOption): number =>
    Number(
      opt.token !== baseToken &&
        !(opt.token === PROTOCOL.nativeToken && opt.chainId === HUB_CHAIN_ID && isAddressEqual(baseToken, hubWnt))
    )
  options.sort(
    (a, b) => isSwap(a) - isSwap(b) || usdOf(b) - usdOf(a) || Number(a.disabled ?? false) - Number(b.disabled ?? false)
  )
  return options.map((opt, i) => ({
    ...opt,
    selected: opt.chainId === selected.chainId && opt.address === selected.address,
    swapGroupStart: isSwap(opt) === 1 && (i === 0 || isSwap(options[i - 1]) === 0)
  }))
}
