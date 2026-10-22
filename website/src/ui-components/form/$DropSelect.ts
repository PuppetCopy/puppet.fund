import { empty, type IOps, type IStream, just, map, switchLatest, toStream } from 'aelea/stream'
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
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette, text } from 'aelea/ui-components-theme'
import { $icon, dropAnchorKeyNav, keyActivate, listboxKeyNav } from '../$common.js'
import { $caretDown } from '../$icons.js'
import { $infoLabel } from '../$info.js'
import { $defaultMiniButtonSecondary } from './$Button.js'
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
    boxShadow: `0 8px 24px ${palette.shadow}`
  })
)

export const $defaultDropSelectOptionContainer = $node(
  style({ cursor: 'pointer', padding: '0 2px', display: 'block' }),
  stylePseudo(':not(:last-child)', { borderBottom: `1px solid ${colorShade(palette.foreground, 15)}` }),
  stylePseudo(':hover', { backgroundColor: palette.horizon })
)

export interface I$DropSelect<T, V = T> {
  value: IStream<V>
  optionList: IStream<readonly T[]> | readonly T[]
  label?: string | IStream<string> | I$Node
  align?: 'start' | 'end'
  $anchor?: INodeCompose
  $container?: INodeCompose
  $valueContainer?: INodeCompose
  $dropListContainer?: INodeCompose
  $optionContainer?: INodeCompose
  $valueLabel?: IOps<V, I$Node>
  $$option?: IOps<T, I$Node>
  closeOnSelect?: boolean
}

const $stringRender = <T>(): IOps<T, I$Node> => map((val: T) => $node($text(String(val))))

const labelToNode = (label: string | IStream<string> | I$Node | undefined): I$Node => {
  if (label === undefined) return empty
  if (typeof label === 'string') return $infoLabel($text(label))
  return switchLatest(map(v => (typeof v === 'string' ? $infoLabel($text(v)) : v), label as IStream<string | INode>))
}

export const $DropSelect = <T, V = T>({
  value,
  optionList,
  label,
  align,
  $anchor = $defaultDropSelectAnchor,
  $container,
  $valueContainer = $row(spacing.default, style({ justifyContent: 'space-between', flex: 1 })),
  $dropListContainer = $dropSelectJoinedListContainer,
  $optionContainer = $defaultDropSelectOptionContainer,
  $$option = $stringRender<T>(),
  $valueLabel = $stringRender<V>(),
  closeOnSelect
}: I$DropSelect<T, V>) =>
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
        align,
        $anchor: $anchor(
          attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'listbox' }),
          attrBehavior(map(open => ({ 'aria-expanded': open ? 'true' : 'false' }), isOpen)),
          effectRun((el: unknown) => {
            anchorEl = el as HTMLElement
          }),
          dropAnchorKeyNav(() => listEl)
        )(
          labelToNode(label),
          $valueContainer(
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

export interface IDropMenuItem {
  label: string
  description: string | null
}

export interface I$DropMenu<T extends IDropMenuItem> {
  label: string
  optionList: readonly T[]
}

export const $DropMenu = <T extends IDropMenuItem>({ label, optionList }: I$DropMenu<T>) =>
  $DropSelect<T, string>({
    value: just(label),
    optionList,
    align: 'end',
    $anchor: $defaultMiniButtonSecondary,
    $valueContainer: $row(spacing.tiny, style({ alignItems: 'center' })),
    $valueLabel: map(shown => $node($text(shown))),
    $dropListContainer: $node(
      style({
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        maxWidth: '260px',
        padding: '4px',
        borderRadius: '10px',
        border: `1px solid ${colorShade(palette.foreground, 25)}`,
        background: palette.background,
        boxShadow: `0 8px 24px ${palette.shadow}`,
        transform: 'translateY(4px)'
      })
    ),
    $optionContainer: $node(
      style({ cursor: 'pointer', padding: '8px 10px', borderRadius: '8px', outline: 'none' }),
      stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 12) }),
      stylePseudo(':focus-visible', { backgroundColor: colorShade(palette.foreground, 12) })
    ),
    $$option: map(item =>
      $column(style({ gap: '2px' }))(
        $node(style({ fontSize: text.sm, color: palette.message, whiteSpace: 'nowrap' }))($text(item.label)),
        ...(item.description === null ? [] : [$node(style({ fontSize: text.xs, lineHeight: '1.4', color: palette.foreground, whiteSpace: 'normal' }))($text(item.description))])
      )
    )
  })
