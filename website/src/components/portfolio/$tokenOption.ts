import { getMappedValueFallback, readableTokenAmount } from '@puppet/sdk/core'
import type { IStream } from 'aelea/stream'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address, Hex } from 'viem'
import { $amountDisplay, $icon, $labeledDivider, $tokenIconMap, $unknown, text } from '@/ui-components'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'

export interface ITokenInputOption {
  symbol: string
  chainId: number
  address: Address
  tokenId: Hex
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

export const $optionRow = (opt: ITokenInputOption): I$Node => {
  const hasBalance = opt.balance !== null && opt.balance > 0n
  const balanceText = opt.balance === null ? '-' : readableTokenAmount(opt.decimals, opt.balance)
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
      ? $amountDisplay({ usd: opt.usdValue, amount: balanceText, align: 'flex-end', usdFontSize: text.sm })
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
  baseTokenId: Hex
): ITokenInputOption[] => {
  const usdOf = (opt: ITokenInputOption): number => {
    if (opt.balance === null || opt.balance === 0n) return 0
    const price = priceOf(opt)
    if (price === null) return Number(opt.balance) / 10 ** opt.decimals
    return Number(opt.balance * price)
  }
  const isSwap = (opt: ITokenInputOption): number => Number(opt.tokenId !== baseTokenId)
  options.sort(
    (a, b) => isSwap(a) - isSwap(b) || usdOf(b) - usdOf(a) || Number(a.disabled ?? false) - Number(b.disabled ?? false)
  )
  return options.map((opt, i) => ({
    ...opt,
    selected: opt.chainId === selected.chainId && opt.address === selected.address,
    swapGroupStart: isSwap(opt) === 1 && (i === 0 || isSwap(options[i - 1]) === 0)
  }))
}
