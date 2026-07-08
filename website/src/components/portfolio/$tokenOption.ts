import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getMappedValueFallback, isNativeToken, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { nativeSymbolOf, tokenMetaByAddress, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { combine, constant, filter, type IStream, just, map, merge, op, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  type I$Node,
  type INode,
  type INodeCompose,
  nodeEvent,
  style
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, getAddress, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $icon,
  $labeledDivider,
  $loadingValue,
  $tokenIconMap,
  $unknown,
  $wallet,
  fadeIn,
  type I$AmountDisplay,
  keyActivate,
  text
} from '@/ui-components'
import { $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { formatUsd } from '../../io/price.js'
import {
  $closeButton,
  $InlineSwitchView,
  $listHeader,
  $listSearchInput,
  $pressableRow,
  $rowsContainer,
  matchesSearch,
  searchInputValue
} from './$InlineSwitchView.js'

export interface ITokenInputOption {
  symbol: string
  chainId: number
  address: Address
  token: Hex
  balance: bigint | null
  decimals: number
  usdValue?: IStream<string>
  // Raw USD value (balance * relay price, USD_PRICE_DECIMALS scale) and swap-group membership, both stamped by
  // decorateOptionList so the picker can aggregate symbol groups without re-deriving prices.
  usd?: bigint | null
  isSwap?: boolean
  disabled?: boolean
  selected?: boolean
}

// The priced ASSET a registered token resolves to (WETH/WMON -> ETH/MON), the key the pickers aggregate on: wrapped
// and native variants of one asset collapse to a single first-step row, and the variant choice lives in the chain
// step. The native marker is the same address everywhere, so it must resolve per-chain, never by address; a token
// missing from the static meta stays its own group under its display symbol instead of killing the list.
export const assetSymbolOf = (chainId: number, token: Address, displaySymbol: string): string => {
  if (isNativeToken(token)) return nativeSymbolOf(chainId as ChainId)
  return tokenMetaByAddress.get(getAddress(token))?.symbol ?? displaySymbol
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
// for a plain amount. Omit `chainId` for a chain-agnostic row (a symbol aggregated across networks): plain icon, no
// badge. Keep this the single source for token-row layout so balances, option lists, and pickers stay in sync.
export interface ITokenRowDisplay extends Pick<I$AmountDisplay, 'change' | 'color' | 'amountColor'> {
  symbol: string
  chainId?: number
  amount: string
  hideBalances: IStream<boolean>
  usd?: IStream<string>
  subtitle?: string
  iconSize?: number
  // Rendered inline next to the token identity (e.g. a Swap button). The value stack stays on the far right.
  $action?: I$Node
  // Rendered right-aligned, immediately BEFORE the value stack (e.g. a chain-presence label).
  $valueLeading?: I$Node
}

export const $tokenBalanceRow = (r: ITokenRowDisplay): I$Node => {
  const size = r.iconSize ?? 40
  const $tokenIcon = $tokenIconBySymbol(r.symbol, `${size}px`)
  return $row(
    spacing.default,
    style({ alignItems: 'center', justifyContent: 'space-between', gap: '16px', flex: 1, minWidth: '0' })
  )(
    $row(spacing.default, style({ alignItems: 'center', minWidth: '0' }))(
      $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
        r.chainId === undefined
          ? $tokenIcon
          : $tokenWithChainBadge($tokenIcon, r.chainId, size, Math.round(size * 0.45)),
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
          ...(() => {
            const subtitle = r.subtitle ?? (r.chainId === undefined ? '' : chainName(r.chainId))
            return subtitle === ''
              ? []
              : [$node(style({ fontSize: text.xs, color: palette.foreground }))($text(subtitle))]
          })()
        )
      ),
      ...(r.$action ? [r.$action] : [])
    ),
    $row(spacing.default, style({ alignItems: 'center', minWidth: '0' }))(
      ...(r.$valueLeading ? [r.$valueLeading] : []),
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
  return $content
}

// Rendered as a SIBLING of the group-opening row, never inside it: the rows are hover/press surfaces and the divider
// must not light up with them.
export const $swapGroupDivider = (): I$Node =>
  $node(style({ padding: '6px 8px 2px' }))(
    $labeledDivider($node(style({ fontSize: text.xs }))($text('Swap & Deposit')))
  )

// Same-token sources lead (a plain deposit or same-asset bridge is the simple, cheap
// path); cross-asset swap sources follow under a labeled divider. USD value descending
// within each group.
export const decorateOptionList = (
  options: ITokenInputOption[],
  selected: { chainId: number; address: Address },
  priceOf: (opt: ITokenInputOption) => bigint | null,
  baseToken: Address
): ITokenInputOption[] => {
  const usdRaw = (opt: ITokenInputOption): bigint | null => {
    if (opt.balance === null) return null
    const price = priceOf(opt)
    if (price === null) return null
    return opt.balance * price
  }
  // Rank on a single consistent USD scale: the relay price is decimals-adjusted (scale 30 - decimals), so
  // balance * price is uniformly usd * 1e30 across tokens. An unpriceable token has no comparable USD value, so it
  // sorts last (0) rather than on a different (token-amount) magnitude that would jumble the order.
  const usdOf = (opt: ITokenInputOption): number => {
    const usd = usdRaw(opt)
    return usd === null ? 0 : Number(formatUnits(usd, USD_PRICE_DECIMALS))
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
  return options.map(opt => ({
    ...opt,
    usd: usdRaw(opt),
    isSwap: isSwap(opt) === 1,
    selected: opt.chainId === selected.chainId && opt.address === selected.address
  }))
}

export interface ITokenSymbolGroup {
  symbol: string
  options: ITokenInputOption[]
  funded: number
  usd: bigint | null
  balance: bigint | null
  decimals: number
  selected: boolean
  disabled: boolean
  isSwap: boolean
  swapGroupStart: boolean
}

// Step-1 aggregation: one row per priced ASSET (wrapped variants fold into their underlying: ETH+WETH -> ETH), totals
// summed across every chain and variant. Group order mirrors the flat list's contract: base-convertible symbols lead,
// swap symbols follow, USD descending within each.
export const aggregateBySymbol = (list: readonly ITokenInputOption[]): ITokenSymbolGroup[] => {
  const bySymbol = new Map<string, ITokenInputOption[]>()
  for (const opt of list) {
    const asset = assetSymbolOf(opt.chainId, opt.token as Address, opt.symbol)
    const group = bySymbol.get(asset)
    if (group) group.push(opt)
    else bySymbol.set(asset, [opt])
  }
  const groups = [...bySymbol.entries()].map(([symbol, options]): Omit<ITokenSymbolGroup, 'swapGroupStart'> => {
    const priced = options.filter(o => o.usd !== null && o.usd !== undefined)
    const funded = options.filter(o => (o.balance ?? 0n) > 0n).length
    const known = options.filter(o => o.balance !== null)
    return {
      symbol,
      options,
      funded,
      usd: priced.length === 0 ? null : priced.reduce((sum, o) => sum + (o.usd as bigint), 0n),
      balance: known.length === 0 ? null : known.reduce((sum, o) => sum + (o.balance as bigint), 0n),
      decimals: options[0].decimals,
      selected: options.some(o => o.selected),
      disabled: options.every(o => o.disabled),
      isSwap: options.every(o => o.isSwap)
    }
  })
  groups.sort((a, b) => {
    const usdNum = (g: (typeof groups)[number]) => (g.usd === null ? 0 : Number(formatUnits(g.usd, USD_PRICE_DECIMALS)))
    return Number(a.isSwap) - Number(b.isSwap) || usdNum(b) - usdNum(a)
  })
  return groups.map((g, i) => ({ ...g, swapGroupStart: g.isSwap && (i === 0 || !groups[i - 1].isSwap) }))
}

const fundedOptions = (g: ITokenSymbolGroup): ITokenInputOption[] => g.options.filter(o => (o.balance ?? 0n) > 0n)

const presenceLabel = (g: ITokenSymbolGroup): string => {
  const funded = fundedOptions(g)
  if (funded.length === 0) return ''
  const chains = [...new Set(funded.map(o => o.chainId))]
  if (chains.length === 1) return `On ${chainName(chains[0])}`
  if (chains.length === 2) return `On ${chainName(chains[0])} & ${chainName(chains[1])}`
  return `On ${chains.length} chains`
}

// A symbol click resolves WITHOUT the chain step when only one pick makes sense: the symbol lives on a single chain,
// or it is funded on exactly one (an unfunded source is no deposit origin).
const directPick = (g: ITokenSymbolGroup): ITokenInputOption | null => {
  if (g.options.length === 1) return g.options[0]
  const funded = fundedOptions(g)
  return funded.length === 1 && !funded[0].disabled ? funded[0] : null
}

export const $symbolGroupRow = (hideBalances: IStream<boolean>, g: ITokenSymbolGroup): I$Node => {
  const hasBalance = g.balance !== null && g.balance > 0n
  const balanceText =
    g.balance === null ? '-' : readableTokenAmountLabel({ decimals: g.decimals, symbol: g.symbol }, g.balance)
  // No selected-highlight here: the asset step is NAVIGATIONAL, and marking the group holding the editor's DEFAULT
  // source reads as an active pick the user never made. The chain step marks the concrete selected option.
  const $content = $row(
    style({
      padding: '8px',
      borderRadius: '10px',
      flex: 1,
      opacity: g.disabled ? '0.4' : hasBalance ? '1' : '0.5',
      cursor: g.disabled ? 'not-allowed' : 'pointer'
    })
  )(
    $tokenBalanceRow({
      symbol: g.symbol,
      amount: balanceText,
      hideBalances,
      usd: g.balance === null ? undefined : just(g.usd === null ? '-' : formatUsd(g.usd, 1n)),
      $valueLeading:
        presenceLabel(g) === ''
          ? undefined
          : $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
              $text(presenceLabel(g))
            )
    })
  )
  return $content
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

type IListStep = { step: 'symbols' } | { step: 'chains'; symbol: string }

export interface I$TokenSelectFlow {
  hideBalances: IStream<boolean>
  value: IStream<ITokenInputOption>
  optionList: IStream<readonly ITokenInputOption[]>
  // The editor's styled top-section box; the flow swaps its CONTENT between the input layout and the selection list.
  $container: INodeCompose
  // The editor's input layout, handed the token anchor to place (clicking the anchor opens the selection list).
  $inputContent: ($anchor: I$Node) => I$Node
}

// Two-step inline token selection: the editor's top section switches from its input layout to a symbol-aggregated
// asset list (one row per symbol, totals across chains), drills into a per-chain list for multi-chain symbols, and
// returns to the input layout once a source is picked. The input layout is only ever HIDDEN, never unmounted — its
// tethered field/alert streams must survive the trip through the list views.
export const $TokenSelectFlow = (config: I$TokenSelectFlow) =>
  component(
    (
      [pickSymbol, pickSymbolTether]: IBehavior<INode, ITokenSymbolGroup>,
      [pickChain, pickChainTether]: IBehavior<INode, ITokenInputOption>,
      [goBack, goBackTether]: IBehavior<INode, PointerEvent>,
      [closeList, closeListTether]: IBehavior<INode, PointerEvent>,
      [searchInput, searchInputTether]: IBehavior<INode<HTMLInputElement>, string>,
      [selecting, selectingTether]: IBehavior<boolean>
    ) => {
      const select: IStream<ITokenInputOption> = op(
        merge(
          op(pickSymbol, map(directPick), filter((o): o is ITokenInputOption => o !== null)),
          pickChain
        ),
        filter(o => !o.disabled),
        multicast
      )

      const $listContent = (open: IStream<PointerEvent>): I$Node => {
        const step: IStream<IListStep> = state(
          { step: 'symbols' } as IListStep,
          merge(
            constant({ step: 'symbols' } as IListStep, open),
            op(
              pickSymbol,
              filter(g => !g.disabled && g.options.length > 1 && directPick(g) === null),
              map((g): IListStep => ({ step: 'chains', symbol: g.symbol }))
            ),
            constant({ step: 'symbols' } as IListStep, goBack)
          )
        )
        // A fresh (remounted) search field starts empty on every step transition, so the filter state resets with it.
        const query: IStream<string> = state('', merge(searchInput, constant('', step)))
        // Fade keys on the STEP alone: background option-list refreshes (balances/prices re-emitting) re-render only
        // the rows, so the view never re-fades mid-look.
        return switchMap(m => {
          const $header = $listHeader(
            m.step === 'chains'
              ? $node(
                  style({ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: palette.foreground }),
                  attr({ role: 'button', tabindex: '0', 'aria-label': 'Back to assets' }),
                  keyActivate(),
                  goBackTether(nodeEvent('click'))
                )(
                  $node(style({ fontSize: text.base }))($text('‹')),
                  $tokenIconBySymbol(m.symbol, '22px'),
                  $node(style({ fontWeight: '600', color: palette.message }))($text(m.symbol)),
                  $node(style({ fontSize: text.xs }))($text('select source'))
                )
              : $listSearchInput('Deposit asset', searchInputTether(nodeEvent('input'), map(searchInputValue))),
            $closeButton(closeListTether(nodeEvent('click')))
          )
          const $rows = switchMap(
            p =>
              $rowsContainer(
                ...(m.step === 'chains'
                  ? p.list
                      .filter(o => assetSymbolOf(o.chainId, o.token as Address, o.symbol) === m.symbol)
                      .map(opt =>
                        $pressableRow(pickChainTether(nodeEvent('click'), constant(opt)))(
                          $optionRow(config.hideBalances, opt)
                        )
                      )
                  : aggregateBySymbol(p.list)
                      .filter(g =>
                        matchesSearch(p.query, [
                          g.symbol,
                          ...g.options.map(o => o.symbol),
                          ...g.options.map(o => chainName(o.chainId))
                        ])
                      )
                      .flatMap(g => [
                        // Dividers group the unfiltered list; under an active query they would strand mid-list.
                        ...(g.swapGroupStart && p.query.trim() === '' ? [$swapGroupDivider()] : []),
                        $pressableRow(pickSymbolTether(nodeEvent('click'), constant(g)))(
                          $symbolGroupRow(config.hideBalances, g)
                        )
                      ]))
              ),
            combine({ list: config.optionList, query })
          )
          return fadeIn($column(style({ flex: '1', minWidth: '0', gap: '6px' }))($header, $rows))
        }, step)
      }

      const $view = $InlineSwitchView({
        $container: config.$container,
        $inputContent: config.$inputContent,
        $anchorContent: switchMap($tokenOptionValueLabel, config.value),
        $listContent,
        close: merge(closeList, select)
      })({ selecting: selectingTether() })

      return [$view, { select, selecting }]
    }
  )
