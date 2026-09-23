import { CHAIN_META, CHAIN_TOKEN_MAP } from '@puppet/contracts/const'
import { CHAIN_ID_LIST, type ChainId } from '@puppet/sdk/const'
import { isNativeToken } from '@puppet/sdk/core'
import { type ITokenRegistryMap, symbolOf, tokenKeyOf, wrappedNativeAddressOf } from '@puppet/sdk/state'
import { combine, constant, filter, type IStream, map, merge, op, start, switchLatest, switchMap } from 'aelea/stream'
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
import { type Address, type Hex, isAddressEqual } from 'viem'
import { $check, $icon, fadeInX, text } from '@/ui-components'
import { $chainLabel, chainName } from '../../common/$chain.js'
import { $tokenIcon, $tokenProfile, $tokenProfileStub } from '../../common/$common.js'
import {
  $breadcrumbSearchHeader,
  $closeButton,
  $InlineSwitchView,
  $listSearchInput,
  $pressableRow,
  $rowsContainer,
  matchesSearch,
  SELECT_ROW_HEIGHT,
  searchInputValue
} from './$InlineSwitchView.js'
import { $swapGroupDivider } from './$tokenOption.js'

export interface ISwapTargetOption {
  chainId: ChainId
  id: Hex
  symbol: string
}

export const withdrawTargetOptions = (
  tokenRegistry: ITokenRegistryMap,
  sourceChainId: ChainId,
  token: Address
): readonly ISwapTargetOption[] => {
  const tokenKey = tokenKeyOf(sourceChainId, token)
  const registeredIds = (chainId: ChainId): Hex[] =>
    [...(tokenRegistry.get(chainId)?.keys() ?? [])].filter(id => {
      if (chainId === sourceChainId && isAddressEqual(id, token)) return true
      return (
        !isAddressEqual(id, wrappedNativeAddressOf(chainId)) ||
        tokenKeyOf(chainId, id) !== CHAIN_META[sourceChainId].wnt
      )
    }) as Hex[]
  const twinOf = (chainId: ChainId): Hex | null => {
    const twin = (CHAIN_TOKEN_MAP[chainId] as Record<string, Address>)[tokenKey]
    return twin === undefined ? null : (twin as Hex)
  }
  const sourceIds: Hex[] = [
    token as Hex,
    ...registeredIds(sourceChainId).filter(id => !isAddressEqual(id, token))
  ]
  return [
    ...sourceIds.map(id => ({ chainId: sourceChainId, id, symbol: tokenKeyOf(sourceChainId, id) })),
    ...CHAIN_ID_LIST.filter(id => id !== sourceChainId && (tokenRegistry.get(id)?.size ?? 0) > 0).flatMap(chainId => {
      const twin = twinOf(chainId)
      const ids = registeredIds(chainId)
      const ordered = twin !== null ? [...ids].sort((a, b) => Number(isAddressEqual(b, twin)) - Number(isAddressEqual(a, twin))) : ids
      return ordered.map(id => ({ chainId, id, symbol: tokenKeyOf(chainId, id) }))
    })
  ]
}

export interface I$SwapTargetFlow {
  value: IStream<ISwapTargetOption | null>
  optionList: IStream<readonly ISwapTargetOption[]>
  source: IStream<{ chainId: ChainId; symbol: string } | null>
  $container: INodeCompose
  $inputContent: ($anchor: I$Node) => I$Node
}

interface ITargetGroup {
  symbol: string
  targets: ISwapTargetOption[]
}

const groupTargets = (list: readonly ISwapTargetOption[]): ITargetGroup[] => {
  const bySymbol = new Map<string, ISwapTargetOption[]>()
  for (const t of list) {
    const asset = symbolOf(t.chainId, t.id)
    const group = bySymbol.get(asset)
    if (group) group.push(t)
    else bySymbol.set(asset, [t])
  }
  return [...bySymbol.entries()].map(([symbol, targets]) => ({ symbol, targets }))
}

const $availabilityLabel = (g: ITargetGroup): I$Node => {
  const $label = $row(
    spacing.tiny,
    style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap', alignItems: 'center' })
  )
  const chains = [...new Set(g.targets.map(t => t.chainId))]
  if (g.targets.length === 1) {
    return $label($text('On'), $node(style({ color: palette.primary }))($text(chainName(chains[0]))))
  }
  if (chains.length === 1) return $label($text(`On ${chainName(chains[0])}`))
  if (chains.length === 2) return $label($text(`On ${chainName(chains[0])} & ${chainName(chains[1])}`))
  return $label($text(`On ${chains.length} chains`))
}

type IListStep = { step: 'symbols' } | { step: 'chains'; symbol: string }

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
        const query: IStream<string> = state('', merge(searchInput, constant('', step)))
        return switchMap(m => {
          const chains = m.step === 'chains'
          const $header = $breadcrumbSearchHeader(
            chains ? [{ label: m.symbol, op: goBackTether(nodeEvent('click')) }] : [],
            $listSearchInput(
              chains ? 'Select destination chain' : 'Select destination token',
              searchInputTether(nodeEvent('input'), map(searchInputValue)),
              !chains
            ),
            $closeButton(closeListTether(nodeEvent('click')))
          )
          const $rows = switchMap(
            p =>
              $rowsContainer(
                ...(chains
                  ? p.list
                      .filter(t => symbolOf(t.chainId, t.id) === m.symbol)
                      .filter(t => matchesSearch(p.query, [chainName(t.chainId), t.symbol]))
                      .sort((a, b) =>
                        p.source === null ? 0 : Number(a.chainId !== p.source.chainId) - Number(b.chainId !== p.source.chainId)
                      )
                      .flatMap((t, i, all) => [
                        ...(p.source !== null &&
                        t.chainId !== p.source.chainId &&
                        (i === 0 || all[i - 1]!.chainId === p.source.chainId) &&
                        p.query.trim() === ''
                          ? [$swapGroupDivider('Crosschain')]
                          : []),
                        $pressableRow(pickTargetTether(nodeEvent('click'), constant(t)))(
                          $row(
                            spacing.small,
                            style({ padding: '8px', minHeight: SELECT_ROW_HEIGHT, flex: 1, alignItems: 'center', borderRadius: '10px' })
                          )(
                            $chainLabel(t.chainId, 24),
                            $node(style({ flex: '1' }))(),
                            $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))(
                              $text(isNativeToken(t.id) ? 'Native' : isAddressEqual(t.id, wrappedNativeAddressOf(t.chainId)) ? 'Wrapped' : t.symbol)
                            ),
                            ...(p.value !== null && p.value.chainId === t.chainId && isAddressEqual(p.value.id, t.id)
                              ? [$icon({ $content: $check, viewBox: '0 0 24 24', fill: palette.primary, size: '14px' })]
                              : [])
                          )
                        )
                      ])
                  : (() => {
                      const groups = groupTargets(p.list).filter(g =>
                        matchesSearch(p.query, [g.symbol, ...g.targets.map(t => t.symbol)])
                      )
                      const sameAsset = (g: ITargetGroup): boolean => p.source !== null && g.symbol === p.source.symbol
                      groups.sort((a, b) => Number(sameAsset(b)) - Number(sameAsset(a)))
                      return groups.flatMap((g, i) => [
                        ...(p.query.trim() === '' && i > 0 && !sameAsset(g) && sameAsset(groups[i - 1]!)
                          ? [$swapGroupDivider('Swap')]
                          : []),
                        $pressableRow(pickGroupTether(nodeEvent('click'), constant(g)))(
                          $row(
                            spacing.default,
                            style({
                              padding: '8px',
                              minHeight: SELECT_ROW_HEIGHT,
                              borderRadius: '10px',
                              flex: 1,
                              alignItems: 'center'
                            })
                          )(
                            $tokenIcon(g.symbol, '40px'),
                            $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))(
                              $text(g.targets.length === 1 ? g.targets[0]!.symbol : g.symbol)
                            ),
                            $node(style({ flex: '1' }))(),
                            $availabilityLabel(g)
                          )
                        )
                      ])
                    })())
              ),
            combine({ list: config.optionList, value: config.value, source: config.source, query })
          )
          return fadeInX(
            $column(style({ flex: '1', minWidth: '0', gap: '6px' }))($header, $rows),
            chains ? 20 : -20
          )
        }, step)
      }

      const $view = $InlineSwitchView({
        $container: config.$container,
        $inputContent: config.$inputContent,
        $anchorContent: op(
          config.value,
          map(v => (v === null ? $node(style({ color: palette.foreground }))($text('Select destination')) : $tokenProfile(v.chainId, v.id, 28))),
          start($tokenProfileStub(28)),
          switchLatest
        ),
        $listContent,
        close: merge(closeList, select)
      })({ selecting: selectingTether() })

      return [$view, { select, selecting }]
    }
  )
