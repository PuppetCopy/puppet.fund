import { empty, type IOps, type IStream, map, switchLatest, toStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type INode, type INodeCompose, style } from 'aelea/ui'
import { $Dropdown, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $icon } from '../$common.js'
import { $caretDown } from '../$icons.js'
import { $infoLabel } from '../$info.js'
export const $defaultDropSelectAnchor = $row(
  spacing.tiny,
  style({
    alignItems: 'center',
    cursor: 'pointer',
    placeContent: 'space-between',
    padding: '8px 12px',
    gap: '10px',
    borderRadius: '14px',
    border: `1px solid ${colorShade(palette.foreground, 15)}`
  })
)

// Back-compat alias — `$container` was the historical name; `$anchor` describes
// what it actually wraps (the clickable button visual, not the outer dropdown box).
export const $defaultDropSelectContainer = $defaultDropSelectAnchor

export interface I$DropSelect<T> {
  value: IStream<T>
  optionList: IStream<readonly T[]> | readonly T[]
  label?: string | IStream<string> | I$Node
  $anchor?: INodeCompose
  $container?: INodeCompose
  $dropListContainer?: INodeCompose
  $optionContainer?: INodeCompose
  $valueLabel?: IOps<T, I$Node>
  $$option?: IOps<T, I$Node>
  closeOnSelect?: boolean
}

const $stringRender = <T>(): IOps<T, I$Node> => map((val: T) => $node($text(String(val))))

const labelToNode = (label: string | IStream<string> | I$Node | undefined): I$Node => {
  if (label === undefined) return empty
  if (typeof label === 'string') return $infoLabel($text(label))
  // Stream of either strings (wrap in $infoLabel) or pre-rendered nodes (passthrough).
  return switchLatest(map(v => (typeof v === 'string' ? $infoLabel($text(v)) : v), label as IStream<string | INode>))
}

export const $DropSelect = <T>({
  value,
  optionList,
  label,
  $anchor = $defaultDropSelectAnchor,
  $container,
  $dropListContainer,
  $optionContainer,
  $$option = $stringRender<T>(),
  $valueLabel = $stringRender<T>(),
  closeOnSelect
}: I$DropSelect<T>) =>
  component(([select, selectTether]: IBehavior<T>) => {
    return [
      $Dropdown({
        optionList,
        $$option,
        $container,
        $dropListContainer,
        $optionContainer,
        closeOnSelect,
        $anchor: $anchor(
          labelToNode(label),
          $row(spacing.default, style({ justifyContent: 'space-between', flex: 1 }))(
            switchLatest($valueLabel(toStream(value))),
            $icon({
              $content: $caretDown,
              width: '12px',
              fill: palette.foreground,
              svgOps: style({ minWidth: '12px' }),
              viewBox: '0 0 32 32'
            })
          )
        )
      })({
        select: selectTether()
      }),
      { select }
    ]
  })
