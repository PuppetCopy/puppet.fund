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
    // Visible border consistent with the icon-circular controls (design-system standard).
    border: `1px solid ${colorShade(palette.foreground, 40)}`,
    transition: 'border-color 120ms ease-out'
  }),
  // Hover brightens the border, matching the icon-circular controls / choice cards.
  stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 50) }),
  // While the list is open the anchor joins the panel below it: flattened bottom corners
  // and the same brightened border the panel uses, so the two read as one control.
  stylePseudo('[aria-expanded="true"]', {
    borderColor: colorShade(palette.foreground, 60),
    borderBottomLeftRadius: '0',
    borderBottomRightRadius: '0'
  })
)

// Back-compat alias — `$container` was the historical name; `$anchor` describes
// what it actually wraps (the clickable button visual, not the outer dropdown box).
export const $defaultDropSelectContainer = $defaultDropSelectAnchor

// Panel that joins the open anchor: flush under it (the dropdown positions it overlapping
// the anchor's 1px bottom border), top corners squared, same border as the open anchor.
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
  // Stream of either strings (wrap in $infoLabel) or pre-rendered nodes (passthrough).
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
    // Captured so Escape (the popover list uses popover:'manual', which suppresses native
    // Escape) and focus-return have a handle to the trigger element, and so the anchor's
    // ArrowDown/ArrowUp can move focus into the freshly-mounted list.
    let anchorEl: HTMLElement | null = null
    let listEl: HTMLElement | null = null
    // Re-clicking the open trigger toggles the dropdown closed (isOpen reducer).
    const closeAndFocus = () => {
      anchorEl?.click()
      anchorEl?.focus()
    }

    return [
      $Dropdown({
        optionList,
        $$option,
        $container,
        // role=listbox + roving Arrow focus + Escape close (returns focus to the anchor).
        $dropListContainer: $dropListContainer(
          attr({ role: 'listbox', tabindex: '-1' }),
          effectRun((el: unknown) => {
            listEl = el as HTMLElement
          }),
          listboxKeyNav(closeAndFocus, () => anchorEl)
        ),
        // Each option is keyboard-activatable and announced as an option.
        $optionContainer: $optionContainer(attr({ role: 'option', tabindex: '0' }), keyActivate()),
        closeOnSelect,
        // Decorators (ARIA/keyboard/element-capture) are applied first, then the children —
        // aelea's compose overloads don't allow mixing ops and leaves in a single call.
        $anchor: $anchor(
          // Focusable, announced as a listbox trigger; aria-expanded follows the open stream.
          // Enter/Space toggle it; ArrowDown/ArrowUp open it (if closed) and move focus to the list.
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
        // Capture the dropdown open state to feed aria-expanded on the anchor above.
        isOpen: isOpenTether()
      }),
      { select }
    ]
  })
