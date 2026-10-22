
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { isNativeToken, readableTokenAmount, readableTokenAmountLabel } from '@puppet/sdk/core'
import { USD_PRICE_DECIMALS } from '@puppet/sdk/evaluate'
import { symbolOf, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { combine, combineMap, constant, filter, type IStream, just, map, merge, op, skipRepeatsWith, start, switchLatest, switchMap, take } from 'aelea/stream'
import { type IBehavior, multicast, PromiseStatus, type PromiseStateDone, state } from 'aelea/stream-extended'
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
  fadeInX,
  $icon,
  $labeledDivider,
  $intermediateText,
  intermediateState,
  maskBalance,
  text
} from '@/ui-components'
import { $chainIcon, $tokenWithChainBadge, chainName } from '../../common/$chain.js'
import { $tokenIcon, $tokenProfile, $intermediateTokenProfile } from '../../common/$common.js'
import { formatUsd, usdOf } from '../../io/price.js'
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
  shown?: IStream<Promise<bigint>>
  decimals: number
  price?: IStream<Promise<bigint | null>>
  disabled?: boolean
  selected?: boolean
  caption?: string
}

export interface ITokenRowDisplay {
  symbol: string
  title?: string
  chainId?: number
  amount: IStream<Promise<string> | string> | string
  hideBalances: IStream<boolean>
  usd?: IStream<Promise<string> | string>
  subtitle?: string | I$Node
  subtitleColor?: string
}

export const $tokenBalanceRow = (r: ITokenRowDisplay): I$Node => {
  const size = 40
  const $symbolIcon = $tokenIcon(r.symbol, `${size}px`)
  return $row(
    spacing.default,
    style({ alignItems: 'center', justifyContent: 'space-between', flex: 1, minWidth: '0' })
  )(
    $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
      r.chainId === undefined
        ? $symbolIcon
        : $tokenWithChainBadge($symbolIcon, r.chainId, size, Math.round(size * 0.45)),
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
      : $node(style({ fontSize: text.sm, color: palette.foreground }))(typeof r.amount === 'string' ? $text(r.amount) : $intermediateText(maskBalance(r.amount, r.hideBalances)))
  )
}

export const $optionRow = (hideBalances: IStream<boolean>, opt: ITokenInputOption, display: { title: string; subtitle: string }, usd: IStream<Promise<string> | string>): I$Node => {
  const hasBalance = opt.balance !== null && opt.balance > 0n
  const unit = { decimals: opt.decimals, symbol: opt.symbol }
  const balanceText =
    opt.shown !== undefined
      ? map(shown => shown.then(balance => readableTokenAmountLabel(unit, balance)), opt.shown)
      : opt.balance === null
        ? '-'
        : readableTokenAmountLabel(unit, opt.balance)
  return $row(
    spacing.small,
    style({
      padding: '8px',
      borderRadius: '10px',
      flex: 1,
      alignItems: 'center',
      opacity: opt.disabled ? '0.4' : hasBalance || (opt.shown !== undefined && opt.balance === null) ? '1' : '0.5',
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
      usd: (opt.shown !== undefined || opt.balance !== null) && opt.price !== undefined ? usd : undefined
    }),
    ...(opt.selected ? [$icon({ $content: $check, viewBox: '0 0 24 24', fill: palette.primary, size: '14px' })] : [])
  )
}

export const $swapGroupDivider = (label: string): I$Node =>
  $node(style({ padding: '6px 8px 2px' }))(
    $labeledDivider($node(style({ fontSize: text.xs }))($text(label)))
  )

const optionKey = (o: ITokenInputOption): string => `${o.chainId}:${o.address}`

export interface ITokenSymbolGroup {
  symbol: string
  options: ITokenInputOption[]
  balance: bigint | null
  selected: boolean
  disabled: boolean
}

export const aggregateBySymbol = (list: readonly ITokenInputOption[], ranks: ReadonlyMap<string, number>): ITokenSymbolGroup[] => {
  const bySymbol = new Map<string, ITokenInputOption[]>()
  for (const opt of list) {
    const asset = symbolOf(opt.chainId, opt.token)
    const group = bySymbol.get(asset)
    if (group) group.push(opt)
    else bySymbol.set(asset, [opt])
  }
  const rankOf = (g: ITokenSymbolGroup): number => g.options.reduce((sum, o) => sum + (ranks.get(optionKey(o)) ?? 0), 0)
  return [...bySymbol.entries()]
    .map(([symbol, options]): ITokenSymbolGroup => ({
      symbol,
      options,
      balance: options.reduce<bigint | null>((sum, o) => (sum === null || o.balance === null ? null : sum + o.balance), 0n),
      selected: options.some(o => o.selected),
      disabled: options.every(o => o.disabled)
    }))
    .sort((a, b) => rankOf(b) - rankOf(a) || Number(a.disabled) - Number(b.disabled))
}

const optionUsd = (o: ITokenInputOption): IStream<Promise<string> | string> => {
  const balance = o.balance
  if (o.price === undefined) return just('-')
  if (o.shown !== undefined) return combineMap((shown, at) => shown.then(held => usdOf(held, at)), o.shown, o.price)
  return balance === null ? just('-') : map(at => usdOf(balance, at), o.price)
}

const shownOf = (g: ITokenSymbolGroup): IStream<Promise<bigint>>[] | null =>
  g.options.every(o => o.shown !== undefined) ? g.options.map(o => o.shown!) : null

const groupUsd = (g: ITokenSymbolGroup): IStream<Promise<string> | string> => {
  const shown = shownOf(g)
  if (shown !== null) {
    const prices = g.options.flatMap(o => (o.price === undefined ? [] : [o.price]))
    if (prices.length < g.options.length) return just('-')
    return combineMap(
      (...answers: Promise<bigint | null>[]) =>
        Promise.all(answers).then(values => {
          const at = values.slice(shown.length)
          const sum = values
            .slice(0, shown.length)
            .reduce<bigint | null>((total, held, i) => (total === null || held === 0n ? total : held === null || at[i] === null ? null : total + held * at[i]!), 0n)
          return sum === null ? '-' : formatUsd(sum, 1n)
        }),
      ...shown,
      ...prices
    )
  }
  const held = g.options.filter(o => o.balance !== 0n)
  const priced = held.flatMap(o => (o.balance === null || o.price === undefined ? [] : [{ balance: o.balance, price: o.price }]))
  if (priced.length < held.length) return just('-')
  if (priced.length === 0) return just(formatUsd(0n, 1n))
  return combineMap(
    (...ats: Promise<bigint | null>[]) =>
      Promise.all(ats.map((at, i) => at.then(known => (known === null ? null : priced[i]!.balance * known)))).then(values => {
        const sum = values.reduce<bigint | null>((total, v) => (total === null || v === null ? null : total + v), 0n)
        return sum === null ? '-' : formatUsd(sum, 1n)
      }),
    ...priced.map(each => each.price)
  )
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

const groupBalanceText = (g: ITokenSymbolGroup, balances: readonly (bigint | null)[]): string => {
  const held = new Map<string, { decimals: number; amount: bigint }>()
  g.options.forEach((o, i) => {
    const balance = balances[i]
    if (balance !== undefined && balance !== null && balance > 0n) held.set(o.symbol, { decimals: o.decimals, amount: (held.get(o.symbol)?.amount ?? 0n) + balance })
  })
  const parts = [...held]
    .sort(([a], [b]) => Number(b === g.symbol) - Number(a === g.symbol))
    .map(([symbol, h]) => readableTokenAmountLabel({ decimals: h.decimals, symbol }, h.amount))
  return parts.length === 0 ? readableTokenAmountLabel({ decimals: g.options[0].decimals, symbol: g.symbol }, 0n) : parts.join(' + ')
}

export const $symbolGroupRow = (hideBalances: IStream<boolean>, g: ITokenSymbolGroup, usd: IStream<Promise<string> | string>): I$Node => {
  const hasBalance = fundedOptions(g).length > 0
  const shown = shownOf(g)
  const balanceText =
    shown !== null
      ? combineMap((...answers: Promise<bigint>[]) => Promise.all(answers).then(balances => groupBalanceText(g, balances)), ...shown)
      : g.balance === null
        ? '-'
        : groupBalanceText(g, g.options.map(o => o.balance))
  const $content = $row(
    style({
      padding: '8px',
      borderRadius: '10px',
      flex: 1,
      opacity: g.disabled ? '0.4' : hasBalance || (shown !== null && g.balance === null) ? '1' : '0.5',
      cursor: g.disabled ? 'not-allowed' : 'pointer'
    })
  )(
    $tokenBalanceRow({
      symbol: g.symbol,
      amount: balanceText,
      hideBalances,
      usd: shown !== null || g.balance !== null ? usd : undefined,
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
  value: IStream<ITokenInputOption>
  optionList: IStream<readonly ITokenInputOption[]>
  destinationChainId?: ChainId
  listLabel: string
  $balanceLead: I$Node
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
      const options = op(config.optionList, state())
      const ranks: IStream<ReadonlyMap<string, number>> = op(
        options,
        switchMap(list =>
          combineMap(
            (...ats: Promise<bigint | null>[]) =>
              Promise.allSettled(ats).then(
                settled =>
                  new Map(
                    list.map((o, i) => {
                      const at = settled[i]!
                      return [optionKey(o), o.balance === null || at.status === 'rejected' || at.value === null ? 0 : Number(formatUnits(o.balance * at.value, USD_PRICE_DECIMALS))]
                    })
                  )
              ),
            ...list.map(o => o.price ?? just(Promise.resolve(null)))
          )
        ),
        intermediateState,
        filter((s): s is PromiseStateDone<Map<string, number>> => s.status === PromiseStatus.DONE),
        map(s => s.value),
        start(new Map<string, number>()),
        state()
      )
      const select: IStream<ITokenInputOption> = op(
        merge(
          op(pickSymbol, map(directPick), filter((o): o is ITokenInputOption => o !== null)),
          pickChain
        ),
        filter(o => !o.disabled),
        multicast
      )

      const $listContent = (): I$Node => {
        const step: IStream<IListStep> = state(
          { step: 'symbols' } as IListStep,
          merge(
            op(
              pickSymbol,
              filter(g => !g.disabled && g.options.length > 1 && directPick(g) === null),
              map((g): IListStep => ({ step: 'chains', symbol: g.symbol }))
            ),
            constant({ step: 'symbols' } as IListStep, goBack)
          )
        )
        const query: IStream<string> = state('', merge(searchInput, constant('', step)))
        const groupList = op(combine({ list: options, ranks: op(ranks, take(1)) }), map(p => aggregateBySymbol(p.list, p.ranks)), state())
        return switchMap(m => {
          const chains = m.step === 'chains'
          const $header = $breadcrumbSearchHeader(
            chains ? [{ label: m.symbol, $lead: $tokenIcon(m.symbol, '16px'), op: goBackTether(nodeEvent('click')) }] : [],
            $listSearchInput(
              chains ? 'Select chain' : config.listLabel,
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
          const $rowList = chains
            ? op(
                combine({ list: options, query }),
                map(p =>
                  p.list
                    .filter(o => symbolOf(o.chainId, o.token) === m.symbol)
                    .map(o => ({
                      opt: o,
                      variant: isNativeToken(o.address)
                        ? 'Native'
                        : isAddressEqual(o.address, wrappedNativeAddressOf(o.chainId))
                          ? 'Native + Wrapped'
                          : o.symbol
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
                    .map((x, i, all) => {
                      const divider =
                        config.destinationChainId !== undefined &&
                        x.opt.chainId !== config.destinationChainId &&
                        (i === 0 || all[i - 1]!.opt.chainId === config.destinationChainId) &&
                        p.query.trim() === ''
                      const o = x.opt
                      return { ...x, divider, key: [divider, o.chainId, o.address, x.variant, o.caption, o.balance, o.decimals, o.disabled, o.selected, o.price === undefined].join(':') }
                    })
                ),
                skipRepeatsWith((a, b) => a.length === b.length && a.every((row, i) => row.key === b[i]!.key)),
                map(rows =>
                  $rowsContainer(
                    ...rows.flatMap(x => [
                      ...(x.divider ? [$swapGroupDivider('Crosschain')] : []),
                      $pressableRow(pickChainTether(nodeEvent('click'), constant(x.opt)))(
                        $optionRow(
                          config.hideBalances,
                          x.opt,
                          { title: chainName(x.opt.chainId), subtitle: x.opt.caption ?? x.variant },
                          op(
                            options,
                            map(list => list.find(o => o.chainId === x.opt.chainId && isAddressEqual(o.address, x.opt.address))),
                            filter((o): o is ITokenInputOption => o !== undefined),
                            switchMap(optionUsd)
                          )
                        )
                      )
                    ])
                  )
                ),
                switchLatest
              )
            : op(
                combine({ list: groupList, query }),
                map(p =>
                  p.list
                    .filter(g => matchesSearch(p.query, [g.symbol, ...g.options.map(o => o.symbol)]))
                    .map(g => ({ g, key: [g.symbol, ...g.options.map(o => [o.chainId, o.address, o.symbol, o.balance, o.decimals, o.disabled].join(':'))].join('|') }))
                ),
                skipRepeatsWith((a, b) => a.length === b.length && a.every((row, i) => row.key === b[i]!.key)),
                map(rows =>
                  $rowsContainer(
                    ...rows.map(({ g }) =>
                      $pressableRow(pickSymbolTether(nodeEvent('click'), constant(g)))(
                        $symbolGroupRow(
                          config.hideBalances,
                          g,
                          op(
                            groupList,
                            map(list => list.find(each => each.symbol === g.symbol)),
                            filter((each): each is ITokenSymbolGroup => each !== undefined),
                            switchMap(groupUsd)
                          )
                        )
                      )
                    )
                  )
                ),
                switchLatest
              )
          return fadeInX(
            $column(style({ flex: '1', minWidth: '0', gap: '6px' }))($header, $rowList),
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
                config.$balanceLead,
                $text('Balance:'),
                $intermediateText(
                  maskBalance(
                    op(
                      config.value,
                      switchMap((opt): IStream<Promise<string> | string> => {
                        const balance = opt.balance
                        if (opt.shown !== undefined) return opt.price !== undefined ? optionUsd(opt) : map(shown => shown.then(held => readableTokenAmount(opt.decimals, held)), opt.shown)
                        if (balance !== null && opt.price !== undefined) return optionUsd(opt)
                        return just(balance === null ? '-' : readableTokenAmount(opt.decimals, balance))
                      })
                    ),
                    config.hideBalances
                  )
                )
              )
            )
          ),
        $anchorContent: op(
          config.selection,
          map(s => $tokenProfile(s.chainId, s.address)),
          start($intermediateTokenProfile()),
          switchLatest
        ),
        $listContent,
        close: merge(closeList, select)
      })({ selecting: selectingTether() })

      return [$view, { select, selecting }]
    }
  )
