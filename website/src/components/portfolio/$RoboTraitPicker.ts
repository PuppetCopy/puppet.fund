import {
  ROBO_LAYER_KEYS,
  ROBO_LAYER_NAMES,
  ROLLED_CATEGORIES,
  roboPreviewTraits,
  traitRollOdds
} from '@puppet/sdk/ui-components'
import {
  aggregate,
  combine,
  constant,
  empty,
  type IStream,
  just,
  map,
  merge,
  op,
  sample,
  start,
  switchLatest
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import {
  $ButtonPrimaryOutline,
  $ButtonSecondary,
  $DropSelect,
  $defaultDropSelectAnchor,
  $defaultMiniButtonSecondary,
  $dropSelectJoinedListContainer,
  $icon,
  $infoLabel,
  text
} from '@/ui-components'
import { $roboAvatar } from '../../common/$roboAvatar.js'
import { $bagOfCoins, $trophy } from '../../common/elements/$icons.js'

interface I$RoboTraitPicker {
  initial: number[]
  auto: number[]
  initialTouched?: boolean
  size?: number
}

type IPickerEvent =
  | { kind: 'set'; layer: number; index: number }
  | { kind: 'random' }
  | { kind: 'reset' }

interface IPickerState {
  indices: number[]
  touched: boolean
}

type IHover = { layer: number; index: number } | null

const PREVIEW_SEED = '0x0000000000000000000000000000000000000001' as Address

const randomIndices = (): number[] => ROBO_LAYER_KEYS.map(keys => Math.floor(Math.random() * keys.length))

const pretty = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)

export const $RoboTraitPicker = ({ initial, auto, initialTouched = false, size = 96 }: I$RoboTraitPicker) =>
  component(
    (
      [selectTrait, selectTraitTether]: IBehavior<number, { layer: number; index: number }>,
      [hover, hoverTether]: IBehavior<INode, IHover>,
      [randomize, randomizeTether]: IBehavior<PointerEvent>,
      [reset, resetTether]: IBehavior<PointerEvent>,
      [save, saveTether]: IBehavior<PointerEvent>
    ) => {
      const reduceState = (s: IPickerState, e: IPickerEvent): { seed: IPickerState; value: IPickerState } => {
        let next: IPickerState
        if (e.kind === 'reset') next = { indices: auto, touched: false }
        else if (e.kind === 'random') next = { indices: randomIndices(), touched: true }
        else next = { indices: s.indices.map((v, layer) => (layer === e.layer ? e.index : v)), touched: true }
        return { seed: next, value: next }
      }

      const events: IStream<IPickerEvent> = merge(
        map(s => ({ kind: 'set' as const, layer: s.layer, index: s.index }), selectTrait),
        constant({ kind: 'random' as const }, randomize),
        constant({ kind: 'reset' as const }, reset)
      )

      const pickerState = op(
        events,
        aggregate(reduceState, { indices: initial, touched: initialTouched }),
        start({ indices: initial, touched: initialTouched } as IPickerState),
        state()
      )
      const indices: IStream<number[]> = map(s => s.indices, pickerState)
      const changeTraits: IStream<number[] | null> = sample(map(s => (s.touched ? s.indices : null), pickerState), save)

      const hoverState: IStream<IHover> = state(null, merge(hover, constant(null, selectTrait)))

      const $preview = switchLatest(
        map(({ committed, hov }) => {
          const traits = roboPreviewTraits(committed)
          if (hov) traits[ROBO_LAYER_NAMES[hov.layer]] = ROBO_LAYER_KEYS[hov.layer][hov.index]
          return $roboAvatar(PREVIEW_SEED, size, traits)
        }, combine({ committed: indices, hov: hoverState }))
      )

      const $optionSwatch = (layer: number, key: string) =>
        switchLatest(
          map(committed => {
            const traits = roboPreviewTraits(committed)
            traits[ROBO_LAYER_NAMES[layer]] = key
            return $roboAvatar(PREVIEW_SEED, 44, traits)
          }, indices)
        )

      const $traitSelect = (layer: number) => {
        const name = ROBO_LAYER_NAMES[layer]
        const isRolled = ROLLED_CATEGORIES.has(name)
        const rolledOdds = isRolled ? traitRollOdds(name) : null
        const tierByKey = rolledOdds ? new Map(rolledOdds.map((o, tier) => [o.key, tier])) : null
        const tierGate = (key: string): string => {
          if (!tierByKey || !rolledOdds) return ''
          const tier = tierByKey.get(key) ?? 0
          return tier <= 0 ? 'Base' : `Top ${Math.max(1, Math.round((1 - tier / rolledOdds.length) * 100))}%`
        }
        const rankLabel = name === 'skin' ? 'By PnL rank' : 'By ROI rank'
        const $option = (i: number) => {
          const key = ROBO_LAYER_KEYS[layer][i]
          return $row(
            spacing.small,
            style({ alignItems: 'center', minWidth: '0' }),
            hoverTether(nodeEvent('pointerenter'), constant({ layer, index: i }))
          )(
            $optionSwatch(layer, key),
            $node(style({ flex: '1' }))($text(pretty(key))),
            tierByKey
              ? $node(style({ fontSize: text.xs, color: colorShade(palette.message, 70), flexShrink: '0' }))(
                  $text(tierGate(key))
                )
              : empty
          )
        }
        return $row(spacing.small, style({ alignItems: 'center' }))(
          $infoLabel(style({ width: '96px', flexShrink: '0' }))($text(pretty(name))),
          style({ flex: '1' })(
            $DropSelect<number>({
              value: isRolled ? just(0) : map(idx => idx[layer], indices),
              optionList: rolledOdds
                ? rolledOdds.map(o => ROBO_LAYER_KEYS[layer].indexOf(o.key))
                : ROBO_LAYER_KEYS[layer].map((_, i) => i),
              $anchor: isRolled
                ? $defaultDropSelectAnchor(style({ borderStyle: 'dashed' }))
                : $defaultDropSelectAnchor,
              $valueLabel: isRolled
                ? map((_: number) =>
                    $row(spacing.small, style({ alignItems: 'center', color: palette.foreground, whiteSpace: 'nowrap' }))(
                      $icon({ $content: name === 'skin' ? $bagOfCoins : $trophy, width: '15px', viewBox: '0 0 32 32' }),
                      $node(style({ fontStyle: 'italic' }))($text(rankLabel))
                    )
                  )
                : map((i: number) => $node($text(pretty(ROBO_LAYER_KEYS[layer][i])))),
              $$option: map((i: number) => $option(i)),
              $dropListContainer: $dropSelectJoinedListContainer(hoverTether(nodeEvent('pointerleave'), constant(null))),
              closeOnSelect: true
            })(isRolled ? {} : { select: selectTraitTether(map((i: number) => ({ layer, index: i }))) })
          )
        )
      }

      return [
        $row(spacing.big, style({ alignItems: 'flex-start', maxWidth: 'calc(100vw - 48px)' }))(
          $column(spacing.default, style({ alignItems: 'center', flexShrink: '0' }))(
            $node(style({ border: `1px solid ${colorShade(palette.foreground, 25)}`, borderRadius: '50%' }))($preview),
            $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Randomize') })({
              click: randomizeTether()
            }),
            $ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Reset') })({
              click: resetTether()
            })
          ),
          $column(spacing.small, style({ width: '300px', maxWidth: '100%' }))(
            ...ROBO_LAYER_NAMES.map((_, layer) => $traitSelect(layer)),
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
              $text('Skin reflects your PnL rank and headwear your ROI rank. Climb the leaderboard to unlock rarer traits.')
            ),
            $ButtonPrimaryOutline({ $content: $text('Done') })({ click: saveTether() })
          )
        ),
        { changeTraits }
      ]
    }
  )
