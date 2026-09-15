import { empty, type IOps, type IStream, map, switchLatest, toStream } from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  attrBehavior,
  component,
  effectRun,
  type I$Node,
  type INode,
  type INodeCompose,
  style,
  stylePseudo
} from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $icon, dropAnchorKeyNav, keyActivate, listboxKeyNav } from '../$common.js'
import { $caretDown } from '../$icons.js'
import { $infoLabel } from '../$info.js'
import { $Dropdown } from './$Dropdown.js'

export const $defaultDropSelectAnchor = $row(
  spacing.tiny,
  style({
    alignItems: 'center',
    cursor: 'pointer',
    placeContent: 'space-between',
    padding: '8px 12px',
    gap: '10px',
    borderRadius: '14px',
    border: `1px solid ${colorShade(palette.foreground, 40)}`,
    transition: 'border-color 120ms ease-out'
  }),
  stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 50) }),
  stylePseudo('[aria-expanded="true"]', {
    borderColor: colorShade(palette.foreground, 60),
    borderRadius: '14px 14px 0 0',
    background: palette.background
  })
)

export const $dropSelectJoinedListContainer = $node(
  style({
    display: 'flex',
    flexDirection: 'column',
    background: palette.background,
    border: `1px solid ${colorShade(palette.foreground, 60)}`,
    borderRadius: '0 0 14px 14px',
    padding: '6px',
    gap: '2px',
    boxShadow: `0 8px 24px ${palette.shadow}`
  })
)

export const $defaultDropSelectOptionContainer = $node(
  style({ cursor: 'pointer', padding: '0 2px', borderRadius: '10px', display: 'block' }),
  stylePseudo(':hover', { backgroundColor: palette.horizon })
)

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
  return switchLatest(map(v => (typeof v === 'string' ? $infoLabel($text(v)) : v), label as IStream<string | INode>))
}

export const $DropSelect = <T>({
  value,
  optionList,
  label,
  $anchor = $defaultDropSelectAnchor,
  $container,
  $dropListContainer = $dropSelectJoinedListContainer,
  $optionContainer = $defaultDropSelectOptionContainer,
  $$option = $stringRender<T>(),
  $valueLabel = $stringRender<T>(),
  closeOnSelect
}: I$DropSelect<T>) =>
  component(([select, selectTether]: IBehavior<T>, [isOpen, isOpenTether]: IBehavior<boolean>) => {
    let anchorEl: HTMLElement | null = null
    let listEl: HTMLElement | null = null
    const closeAndFocus = () => {
      anchorEl?.click()
      anchorEl?.focus()
    }

    return [
      $Dropdown({
        optionList,
        $$option,
        $container,
        $dropListContainer: $dropListContainer(
          attr({ role: 'listbox', tabindex: '-1' }),
          effectRun((el: unknown) => {
            listEl = el as HTMLElement
          }),
          listboxKeyNav(closeAndFocus, () => anchorEl)
        ),
        $optionContainer: $optionContainer(attr({ role: 'option', tabindex: '0' }), keyActivate()),
        closeOnSelect,
        $anchor: $anchor(
          attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'listbox' }),
          attrBehavior(map(open => ({ 'aria-expanded': open ? 'true' : 'false' }), isOpen)),
          effectRun((el: unknown) => {
            anchorEl = el as HTMLElement
          }),
          dropAnchorKeyNav(() => listEl)
        )(
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
        select: selectTether(),
        isOpen: isOpenTether()
      }),
      { select }
    ]
  })
