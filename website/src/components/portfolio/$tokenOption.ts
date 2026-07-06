import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { getMappedValueFallback, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { wrappedNativeAddressOf } from '@puppet/sdk/state'
import { type IStream, map } from 'aelea/stream'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $DropSelect,
  $icon,
  $labeledDivider,
  $loadingValue,
  $tokenIconMap,
  $unknown,
  $wallet,
  type I$AmountDisplay,
  text
} from '@/ui-components'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { $editorDropdownContainer } from './editorUtils.js'

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

// The canonical asset row, reused everywhere a token is shown next to its value: [icon + chain badge] [symbol / chain
// name] … [USD / amount]. `amount` is the token-amount label; pass `usd` for the stacked USD-over-amount display, omit it
// for a plain amount. Keep this the single source for token-row layout so balances, option lists, and pickers stay in
// sync.
export interface ITokenRowDisplay extends Pick<I$AmountDisplay, 'change' | 'color' | 'amountColor'> {
  symbol: string
  chainId: number
  amount: string
  hideBalances: IStream<boolean>
  usd?: IStream<string>
  subtitle?: string
  iconSize?: number
  // Rendered inline next to the token identity (e.g. a Swap button). The value stack stays on the far right.
  $action?: I$Node
}

export const $tokenBalanceRow = (r: ITokenRowDisplay): I$Node => {
  const size = r.iconSize ?? 40
  return $row(
    spacing.default,
    style({ alignItems: 'center', justifyContent: 'space-between', gap: '16px', flex: 1, minWidth: '0' })
  )(
    $row(spacing.default, style({ alignItems: 'center', minWidth: '0' }))(
      $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
        $tokenWithChainBadge($tokenIconBySymbol(r.symbol, `${size}px`), r.chainId, size, Math.round(size * 0.45)),
        $column(style({ gap: '1px', minWidth: '0' }))(
          $node(
            style({
              fontWeight: '600',
              fontSize: text.base,
              color: palette.message,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            })
          )($text(r.symbol)),
          $node(style({ fontSize: text.xs, color: palette.foreground }))($text(r.subtitle ?? chainName(r.chainId)))
        )
      ),
      ...(r.$action ? [r.$action] : [])
    ),
    r.usd
      ? $amountDisplay({
          hideBalances: r.hideBalances,
          usd: r.usd,
          amount: r.amount,
          align: 'flex-end',
          usdFontSize: text.sm,
          change: r.change,
          color: r.color,
          amountColor: r.amountColor
        })
      : $node(style({ fontSize: text.sm, color: palette.foreground }))($text(r.amount))
  )
}

export const $optionRow = (hideBalances: IStream<boolean>, opt: ITokenInputOption): I$Node => {
  const hasBalance = opt.balance !== null && opt.balance > 0n
  const balanceText =
    opt.balance === null ? '-' : readableTokenAmountLabel({ decimals: opt.decimals, symbol: opt.symbol }, opt.balance)
  const $content = $row(
    style({
      padding: '8px',
      borderRadius: '10px',
      flex: 1,
      opacity: opt.disabled ? '0.4' : hasBalance ? '1' : '0.5',
      cursor: opt.disabled ? 'not-allowed' : 'pointer',
      ...(opt.selected ? { backgroundColor: palette.horizon } : {})
    })
  )(
    $tokenBalanceRow({
      symbol: opt.symbol,
      chainId: opt.chainId,
      amount: balanceText,
      hideBalances,
      usd: opt.balance !== null ? opt.usdValue : undefined
    })
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

export const $tokenOptionValueLabel = (opt: ITokenInputOption): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    $tokenWithChainBadge($tokenIconBySymbol(opt.symbol, '32px'), opt.chainId, 32, 14),
    $column(style({ gap: '1px', minWidth: '0' }))(
      $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(opt.symbol)),
      $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
        $icon({
          $content: $wallet,
          viewBox: '0 0 32 32',
          fill: palette.foreground,
          size: '12px',
          svgOps: style({ display: 'block' })
        }),
        opt.usdValue
          ? $loadingValue(opt.usdValue)
          : $text(opt.balance === null ? '-' : readableTokenAmount(opt.decimals, opt.balance))
      )
    )
  )

export const $tokenSourcePicker = (config: {
  hideBalances: IStream<boolean>
  value: IStream<ITokenInputOption>
  optionList: IStream<readonly ITokenInputOption[]>
}) =>
  $DropSelect({
    $container: $editorDropdownContainer,
    value: config.value,
    optionList: config.optionList,
    $valueLabel: map($tokenOptionValueLabel),
    $$option: map((opt: ITokenInputOption) => $optionRow(config.hideBalances, opt))
  })
