
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getMappedValueFallback, isNativeToken, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { symbolOf, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { combine, constant, filter, type IStream, just, map, merge, op, switchMap } from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import {
  $node,
  $text,
  component,
  type I$Node,
  type INode,
  type INodeCompose,
  nodeEvent,
  style
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, formatUnits, type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $check,
  $icon,
  $inlineSpinner,
  $intermediatePromise,
  $labeledDivider,
  $loadingValue,
  $spinner,
  $tokenIconMap,
  $unknown,
  $wallet,
  fadeInX,
  text
} from '@/ui-components'
import { $chainIcon, $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { $tokenProfile } from '../../common/$common.js'
import { formatUsd } from '../../io/price.js'
import {
  $breadcrumbSearchHeader,
  $closeButton,
  $InlineSwitchView,
  $listSearchInput,
  $pressableRow,
  $rowsContainer,
  matchesSearch,
  searchInputValue
} from './$InlineSwitchView.js'

export interface ITokenInputOption {
  symbol: string
  chainId: ChainId
  address: Address
  token: Hex
  balance: bigint | null
  decimals: number
  usdValue?: IStream<string>
  usd?: bigint | null
  disabled?: boolean
  selected?: boolean
}

export const $tokenIconBySymbol = (sym: string, size = '28px'): I$Node =>
  $icon({
    $content: getMappedValueFallback($tokenIconMap, sym, $unknown),
    size,
    fill: palette.message,
    svgOps: style({ borderRadius: '50%' }),
    viewBox: '0 0 32 32'
  })

export interface ITokenRowDisplay {
  symbol: string
  title?: string
  chainId?: number
  amount: string
  hideBalances: IStream<boolean>
  usd?: IStream<string>
  subtitle?: string | I$Node
  subtitleColor?: string
}

export const $tokenBalanceRow = (r: ITokenRowDisplay): I$Node => {
  const size = 40
  const $tokenIcon = $tokenIconBySymbol(r.symbol, `${size}px`)
  return $row(
    spacing.default,
    style({ alignItems: 'center', justifyContent: 'space-between', flex: 1, minWidth: '0' })
  )(
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
        )($text(r.title ?? r.symbol)),
        ...(r.subtitle === undefined
          ? []
          : [
              $node(style({ fontSize: text.xs, color: r.subtitleColor ?? palette.foreground }))(
                typeof r.subtitle === 'string' ? $text(r.subtitle) : r.subtitle
              )
            ])
      )
    ),
    r.usd
      ? $amountDisplay({
          hideBalances: r.hideBalances,
          usd: r.usd,
          amount: r.amount,
          align: 'flex-end',
          usdFontSize: text.sm
        })
      : $node(style({ fontSize: text.sm, color: palette.foreground }))($text(r.amount))
  )
}

export const $optionRow = (hideBalances: IStream<boolean>, opt: ITokenInputOption, display: { title: string; subtitle: string }): I$Node => {
  const hasBalance = opt.balance !== null && opt.balance > 0n
  const balanceText =
    opt.balance === null ? '-' : readableTokenAmountLabel({ decimals: opt.decimals, symbol: opt.symbol }, opt.balance)
  return $row(
    spacing.small,
    style({
      padding: '8px',
      borderRadius: '10px',
      flex: 1,
      alignItems: 'center',
      opacity: opt.disabled ? '0.4' : hasBalance ? '1' : '0.5',
      cursor: opt.disabled ? 'not-allowed' : 'pointer'
    })
  )(
    $tokenBalanceRow({
      symbol: opt.symbol,
      title: display.title,
      subtitle: display.subtitle,
      chainId: opt.chainId,
      amount: balanceText,
      hideBalances,
      subtitleColor: hasBalance && !opt.disabled ? palette.primary : undefined,
      usd: opt.balance !== null ? opt.usdValue : undefined
    }),
    ...(opt.selected ? [$icon({ $content: $check, viewBox: '0 0 24 24', fill: palette.primary, size: '14px' })] : [])
  )
}

export const $swapGroupDivider = (label: string): I$Node =>
  $node(style({ padding: '6px 8px 2px' }))(
    $labeledDivider($node(style({ fontSize: text.xs }))($text(label)))
  )

export const decorateOptionList = (
  options: ITokenInputOption[],
  selected: { chainId: ChainId; address: Address },
  priceOf: (opt: ITokenInputOption) => bigint | null,
): ITokenInputOption[] => {
  const usdRaw = (opt: ITokenInputOption): bigint | null => {
    if (opt.balance === null) return null
    const price = priceOf(opt)
    if (price === null) return null
    return opt.balance * price
  }
  const usdOf = (opt: ITokenInputOption): number => {
    const usd = usdRaw(opt)
    return usd === null ? 0 : Number(formatUnits(usd, USD_PRICE_DECIMALS))
  }
  options.sort(
    (a, b) => usdOf(b) - usdOf(a) || Number(a.disabled ?? false) - Number(b.disabled ?? false)
  )
  return options.map(opt => ({
    ...opt,
    usd: usdRaw(opt),
    selected: opt.chainId === selected.chainId && isAddressEqual(opt.address, selected.address)
  }))
}

export interface ITokenSymbolGroup {
  symbol: string
  options: ITokenInputOption[]
  usd: bigint | null
  balance: bigint | null
  selected: boolean
  disabled: boolean
}

export const aggregateBySymbol = (list: readonly ITokenInputOption[]): ITokenSymbolGroup[] => {
  const bySymbol = new Map<string, ITokenInputOption[]>()
  for (const opt of list) {
    const asset = symbolOf(opt.chainId, opt.token)
    const group = bySymbol.get(asset)
    if (group) group.push(opt)
    else bySymbol.set(asset, [opt])
  }
  const groups = [...bySymbol.entries()].map(([symbol, options]): ITokenSymbolGroup => ({
    symbol,
    options,
    usd: options.reduce<bigint | null>((sum, o) => {
      if (sum === null || o.balance === null) return null
      if (o.balance === 0n) return sum
      return o.usd === null || o.usd === undefined ? null : sum + o.usd
    }, 0n),
    balance: options.reduce<bigint | null>((sum, o) => (sum === null || o.balance === null ? null : sum + o.balance), 0n),
    selected: options.some(o => o.selected),
    disabled: options.every(o => o.disabled)
  }))
  groups.sort((a, b) => {
    const usdNum = (g: (typeof groups)[number]) => (g.usd === null ? 0 : Number(formatUnits(g.usd, USD_PRICE_DECIMALS)))
    return usdNum(b) - usdNum(a)
  })
  return groups
}

const fundedOptions = (g: ITokenSymbolGroup): ITokenInputOption[] => g.options.filter(o => o.balance !== null && o.balance > 0n)

const $presence = (g: ITokenSymbolGroup): I$Node | undefined => {
  const chains = [...new Set(fundedOptions(g).map(o => o.chainId))]
  if (chains.length === 0) return undefined
  return $row(spacing.tiny, style({ alignItems: 'center', minWidth: '0' }))(
    ...chains.map(id => $chainIcon(id, 14)),
    $node(style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))(
      $text(chains.length > 2 ? `${chains.length} chains` : chains.map(chainName).join(' & '))
    )
  )
}

const directPick = (g: ITokenSymbolGroup): ITokenInputOption | null => {
  if (g.options.length === 1) return g.options[0]
  if (g.balance === null) return null
  const funded = fundedOptions(g)
  return funded.length === 1 && !funded[0].disabled ? funded[0] : null
}

export const $symbolGroupRow = (hideBalances: IStream<boolean>, g: ITokenSymbolGroup): I$Node => {
  const hasBalance = fundedOptions(g).length > 0
  const held = new Map<string, { decimals: number; amount: bigint }>()
  for (const o of g.options) {
    if (o.balance !== null && o.balance > 0n) {
      held.set(o.symbol, { decimals: o.decimals, amount: (held.get(o.symbol)?.amount ?? 0n) + o.balance })
    }
  }
  const parts = [...held]
    .sort(([a], [b]) => Number(b === g.symbol) - Number(a === g.symbol))
    .map(([symbol, h]) => readableTokenAmountLabel({ decimals: h.decimals, symbol }, h.amount))
  const balanceText =
    g.balance === null
      ? '-'
      : parts.length === 0
        ? readableTokenAmountLabel({ decimals: g.options[0].decimals, symbol: g.symbol }, g.balance)
        : parts.join(' + ')
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
      subtitle: $presence(g),
      subtitleColor: directPick(g) !== null ? palette.primary : undefined
    })
  )
  return $content
}

type IListStep = { step: 'symbols' } | { step: 'chains'; symbol: string }

export interface I$TokenSelectFlow {
  hideBalances: IStream<boolean>
  selection: IStream<{ chainId: ChainId; address: Address }>
  balanceQuery: IStream<Promise<unknown>>
  value: IStream<ITokenInputOption>
  optionList: IStream<readonly ITokenInputOption[]>
  destinationChainId?: ChainId
  $container: INodeCompose
  $inputContent: ($anchor: I$Node) => I$Node
}

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
        const query: IStream<string> = state('', merge(searchInput, constant('', step)))
        return switchMap(m => {
          const chains = m.step === 'chains'
          const $header = $breadcrumbSearchHeader(
            chains ? [{ label: m.symbol, $lead: $tokenIconBySymbol(m.symbol, '16px'), op: goBackTether(nodeEvent('click')) }] : [],
            $listSearchInput(
              chains ? 'Select chain' : 'Search tokens',
              searchInputTether(nodeEvent('input'), map(searchInputValue)),
              !chains
            ),
            $closeButton(closeListTether(nodeEvent('click'))),
            config.destinationChainId === undefined
              ? undefined
              : {
                  label: chainName(config.destinationChainId),
                  $lead: $chainIcon(config.destinationChainId, 16)
                }
          )
          const $rowList = switchMap(
            p =>
              $rowsContainer(
                ...(chains
                  ? p.list
                      .filter(o => symbolOf(o.chainId, o.token) === m.symbol)
                      .map(o => ({
                        opt: o,
                        variant: isNativeToken(o.address)
                          ? 'Native'
                          : isAddressEqual(o.address, wrappedNativeAddressOf(o.chainId))
                            ? 'Native + Wrapped'
                            : symbolOf(o.chainId, o.token)
                      }))
                      .filter(x => matchesSearch(p.query, [chainName(x.opt.chainId), x.opt.symbol, x.variant]))
                      .sort(
                        (a, b) =>
                          Number(a.opt.chainId !== config.destinationChainId) -
                            Number(b.opt.chainId !== config.destinationChainId) ||
                          Number(b.opt.chainId === HUB_CHAIN_ID) - Number(a.opt.chainId === HUB_CHAIN_ID) ||
                          a.opt.chainId - b.opt.chainId ||
                          Number(b.variant === 'Native') - Number(a.variant === 'Native')
                      )
                      .flatMap((x, i, all) => [
                        ...(config.destinationChainId !== undefined &&
                        x.opt.chainId !== config.destinationChainId &&
                        (i === 0 || all[i - 1]!.opt.chainId === config.destinationChainId) &&
                        p.query.trim() === ''
                          ? [$swapGroupDivider('Crosschain')]
                          : []),
                        $pressableRow(pickChainTether(nodeEvent('click'), constant(x.opt)))(
                          $optionRow(config.hideBalances, x.opt, { title: chainName(x.opt.chainId), subtitle: x.variant })
                        )
                      ])
                  : aggregateBySymbol(p.list)
                      .filter(g => matchesSearch(p.query, [g.symbol, ...g.options.map(o => o.symbol)]))
                      .flatMap(g => [
                        $pressableRow(pickSymbolTether(nodeEvent('click'), constant(g)))(
                          $symbolGroupRow(config.hideBalances, g)
                        )
                      ]))
              ),
            combine({ list: config.optionList, query })
          )
          const $rows = $intermediatePromise({
            $loader: $rowsContainer($spinner),
            $display: map(async loaded => {
              await loaded
              return $rowList
            }, config.balanceQuery)
          })
          return fadeInX(
            $column(style({ flex: '1', minWidth: '0', gap: '6px' }))($header, $rows),
            m.step === 'symbols' ? -20 : 20
          )
        }, step)
      }

      const $view = $InlineSwitchView({
        $container: config.$container,
        $inputContent: $anchor =>
          config.$inputContent(
            $column(spacing.tiny, style({ alignItems: 'flex-end' }))(
              $anchor,
              $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground, fontSize: text.xs }))(
                $icon({ $content: $wallet, viewBox: '0 0 32 32', fill: palette.foreground, size: '12px', svgOps: style({ display: 'block' }) }),
                $text('Balance:'),
                $intermediatePromise({
                  $loader: $inlineSpinner,
                  $display: map(async loaded => {
                    await loaded
                    return switchMap(
                      opt =>
                        opt.usdValue
                          ? $loadingValue(opt.usdValue)
                          : $node($text(opt.balance === null ? '-' : readableTokenAmount(opt.decimals, opt.balance))),
                      config.value
                    )
                  }, config.balanceQuery)
                })
              )
            )
          ),
        $anchorContent: switchMap(s => $tokenProfile(s.chainId, s.address), config.selection),
        $listContent,
        close: merge(closeList, select)
      })({ selecting: selectingTether() })

      return [$view, { select, selecting }]
    }
  )
