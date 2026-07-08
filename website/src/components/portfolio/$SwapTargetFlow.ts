import { isNativeToken } from '@puppet/sdk/core'
import { combine, constant, filter, type IStream, map, merge, op, switchMap } from 'aelea/stream'
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
import type { Hex } from 'viem'
import { fadeIn, keyActivate, text } from '@/ui-components'
import { $chainLabel, $tokenWithChainBadge, chainName } from '../../common/$chain.js'
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
import { $tokenIconBySymbol, assetSymbolOf } from './$tokenOption.js'

// A receivable target: a registered token id on a specific destination chain, with its per-chain display symbol
// (the native marker resolves to that chain's gas coin).
export interface ISwapTargetOption {
  chainId: number
  id: Hex
  symbol: string
}

export interface I$SwapTargetFlow {
  value: IStream<ISwapTargetOption | null>
  optionList: IStream<readonly ISwapTargetOption[]>
  $container: INodeCompose
  $inputContent: ($anchor: I$Node) => I$Node
}

interface ITargetGroup {
  symbol: string
  targets: ISwapTargetOption[]
}

// Groups key on the priced ASSET (wrapped variants fold into their underlying: ETH+WETH -> ETH); the chain step then
// offers each chain+variant pair, so the wrap choice lives where it is signal, not on the first-step list.
const groupTargets = (list: readonly ISwapTargetOption[]): ITargetGroup[] => {
  const bySymbol = new Map<string, ISwapTargetOption[]>()
  for (const t of list) {
    const asset = assetSymbolOf(t.chainId, t.id, t.symbol)
    const group = bySymbol.get(asset)
    if (group) group.push(t)
    else bySymbol.set(asset, [t])
  }
  return [...bySymbol.entries()].map(([symbol, targets]) => ({ symbol, targets }))
}

// Availability, not holdings: a swap target is something to RECEIVE, so the label reads where the asset can land.
const availabilityLabel = (g: ITargetGroup): string => {
  const chains = [...new Set(g.targets.map(t => t.chainId))]
  if (chains.length === 1) return `On ${chainName(chains[0])}`
  if (chains.length === 2) return `On ${chainName(chains[0])} & ${chainName(chains[1])}`
  return `On ${chains.length} chains`
}

type IListStep = { step: 'symbols' } | { step: 'chains'; symbol: string }

// Two-step inline receive selection for the swap editor: pick the target asset (grouped by symbol across every
// destination chain it is registered on), then the chain to receive it on — single-chain assets select directly.
// Replaces the separate chain + token dropdowns; a pick carries BOTH the destination chain and the target id.
export const $SwapTargetFlow = (config: I$SwapTargetFlow) =>
  component(
    (
      [pickGroup, pickGroupTether]: IBehavior<INode, ITargetGroup>,
      [pickTarget, pickTargetTether]: IBehavior<INode, ISwapTargetOption>,
      [goBack, goBackTether]: IBehavior<INode, PointerEvent>,
      [closeList, closeListTether]: IBehavior<INode, PointerEvent>,
      [searchInput, searchInputTether]: IBehavior<INode<HTMLInputElement>, string>,
      [selecting, selectingTether]: IBehavior<boolean>
    ) => {
      const select: IStream<ISwapTargetOption> = op(
        merge(
          op(pickGroup, filter(g => g.targets.length === 1), map(g => g.targets[0])),
          pickTarget
        ),
        multicast
      )

      const $listContent = (open: IStream<PointerEvent>): I$Node => {
        const step: IStream<IListStep> = state(
          { step: 'symbols' } as IListStep,
          merge(
            constant({ step: 'symbols' } as IListStep, open),
            op(
              pickGroup,
              filter(g => g.targets.length > 1),
              map((g): IListStep => ({ step: 'chains', symbol: g.symbol }))
            ),
            constant({ step: 'symbols' } as IListStep, goBack)
          )
        )
        // A fresh (remounted) search field starts empty on every step transition, so the filter state resets with it.
        const query: IStream<string> = state('', merge(searchInput, constant('', step)))
        // Fade keys on the STEP alone: option-list/value re-emissions re-render only the rows without re-fading.
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
                  $node(style({ fontSize: text.xs }))($text('receive on'))
                )
              : $listSearchInput('Receive', searchInputTether(nodeEvent('input'), map(searchInputValue))),
            $closeButton(closeListTether(nodeEvent('click')))
          )
          const $rows = switchMap(
            p =>
              $rowsContainer(
                ...(m.step === 'chains'
                  ? p.list
                      .filter(t => assetSymbolOf(t.chainId, t.id, t.symbol) === m.symbol)
                      .map(t =>
                        $pressableRow(pickTargetTether(nodeEvent('click'), constant(t)))(
                          $row(
                            style({
                              padding: '10px',
                              flex: 1,
                              alignItems: 'center',
                              borderRadius: '10px',
                              ...(p.value !== null && p.value.chainId === t.chainId && p.value.id === t.id
                                ? { backgroundColor: palette.horizon }
                                : {})
                            })
                          )(
                            $chainLabel(t.chainId, 24),
                            $node(style({ flex: '1' }))(),
                            ...(isNativeToken(t.id)
                              ? []
                              : [
                                  $node(
                                    style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' })
                                  )($text('Wrapped'))
                                ])
                          )
                        )
                      )
                  : groupTargets(p.list)
                      .filter(g =>
                        matchesSearch(p.query, [
                          g.symbol,
                          ...g.targets.map(t => t.symbol),
                          ...g.targets.map(t => chainName(t.chainId))
                        ])
                      )
                      .map(g =>
                      $pressableRow(pickGroupTether(nodeEvent('click'), constant(g)))(
                        $row(
                          spacing.default,
                          style({
                            padding: '8px',
                            borderRadius: '10px',
                            flex: 1,
                            alignItems: 'center'
                          })
                        )(
                          $tokenIconBySymbol(g.symbol, '40px'),
                          $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))(
                            $text(g.symbol)
                          ),
                          $node(style({ flex: '1' }))(),
                          $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
                            $text(availabilityLabel(g))
                          )
                        )
                      )
                    ))
              ),
            combine({ list: config.optionList, value: config.value, query })
          )
          return fadeIn($column(style({ flex: '1', minWidth: '0', gap: '6px' }))($header, $rows))
        }, step)
      }

      const $view = $InlineSwitchView({
        $container: config.$container,
        $inputContent: config.$inputContent,
        $anchorContent: switchMap(
          v =>
            v === null
              ? $node(style({ color: palette.foreground }))($text('Select token'))
              : $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                  $tokenWithChainBadge($tokenIconBySymbol(v.symbol, '28px'), v.chainId, 28, 13),
                  $column(style({ gap: '1px', minWidth: '0' }))(
                    $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(v.symbol)),
                    $node(style({ color: palette.foreground, fontSize: text.xs }))(
                      $text(`To ${chainName(v.chainId)}`)
                    )
                  )
                ),
          config.value
        ),
        $listContent,
        close: merge(closeList, select)
      })({ selecting: selectingTether() })

      return [$view, { select, selecting }]
    }
  )
