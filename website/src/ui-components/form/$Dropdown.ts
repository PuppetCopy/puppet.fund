import {
  combine,
  constant,
  empty,
  type IOps,
  type IStream,
  just,
  map,
  merge,
  never,
  nowWith,
  op,
  reduce,
  skip,
  start,
  switchLatest,
  switchMap,
  take,
  toStream
} from 'aelea/stream'
import { animationFrame, type IBehavior } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  effectProp,
  effectRun,
  fromEventTarget,
  type I$Node,
  type I$Slottable,
  type INode,
  type INodeCompose,
  nodeEvent,
  style,
  styleInline,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, designSheet, disabledOp, observer, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'

export const $defaultOptionContainer = $row(
  spacing.small,
  style({
    alignItems: 'center',
    cursor: 'pointer',
    padding: '12px 20px',
    width: '100%'
  }),
  stylePseudo(':not(:last-child)', { borderBottom: `1px solid ${palette.horizon}` }),
  stylePseudo(':hover', { backgroundColor: palette.horizon })
)

export const $defaultDropListContainer = $column(
  style({
    whiteSpace: 'pre-wrap',
    maxWidth: '600px',
    userSelect: 'text',
    background: palette.background,
    boxShadow: `${palette.shadow} 0px 4px 20px 8px, ${palette.shadow} 0px 1px 3px 1px`,
    // Explicit border: the panel is a native [popover], and without an author value the
    // UA default border renders (the panel keeps its container border, see $list below).
    border: `1px solid ${colorShade(palette.foreground, 60)}`,
    borderRadius: '0 0 8px 8px',
    fontWeight: 'normal',
    overflow: 'hidden'
  })
)

export const $defaultDropdownContainer = $node(
  style({
    cursor: 'pointer',
    position: 'relative',
    alignItems: 'center',
    display: 'grid',
    gridAutoFlow: 'column'
  })
)

export interface I$Dropdown<T> {
  optionList: IStream<readonly T[]> | readonly T[]
  $anchor: I$Node
  disabled?: IStream<boolean>
  closeOnSelect?: boolean
  $$option?: IOps<T, I$Slottable>
  $container?: INodeCompose
  $dropListContainer?: INodeCompose
  $optionContainer?: INodeCompose
}

const stopPropagation = (ev: MouseEvent) => ev.stopPropagation()

const showPopover = (el: unknown): void => {
  if (el instanceof HTMLElement && typeof el.showPopover === 'function') el.showPopover()
}

// Drained from aelea's $Dropdown with two deliberate changes: the panel ALWAYS opens
// below the anchor (no viewport flip, so the anchor/panel join is predictable), and the
// panel keeps its container-defined border instead of the forced inline `border: none`.
// It sits flush at rect.bottom - 1 so its top border overlaps the anchor's bottom border.
export function $Dropdown<T>({
  $anchor,
  optionList,
  disabled = never,
  closeOnSelect = true,
  $container = $defaultDropdownContainer,
  $dropListContainer = $defaultDropListContainer,
  $$option = map((o: T) => $node($text(String(o)))),
  $optionContainer = $defaultOptionContainer
}: I$Dropdown<T>) {
  return component(
    (
      [select, selectTether]: IBehavior<INode<HTMLElement>, T>,
      [openMenu, openMenuTether]: IBehavior<INode<HTMLElement>, PointerEvent>,
      [anchorEntry, anchorTether]: IBehavior<INode<HTMLElement>, IntersectionObserverEntry[]>,
      [contentEntry, contentTether]: IBehavior<INode<HTMLElement>, IntersectionObserverEntry[]>
    ) => {
      const toggle = constant<'toggle'>('toggle', openMenu)
      const outsideClose = switchLatest(map(() => take(1, skip(1, fromEventTarget(window, 'click'))), openMenu))
      const close = constant<false>(false, closeOnSelect ? merge(outsideClose, select) : outsideClose)
      const isOpen: IStream<boolean> = reduce((open, ev) => (ev === 'toggle' ? !open : ev), false, merge(toggle, close))

      const reposition = merge(
        fromEventTarget(window, 'scroll', { capture: true }),
        fromEventTarget(window, 'resize'),
        animationFrame()
      )

      const $observedAnchor = op(
        $anchor,
        anchorTether(observer.intersection() as IOps<INode<HTMLElement>, IntersectionObserverEntry[]>)
      )

      const $list = switchMap(open => {
        if (!open) return empty
        return $dropListContainer(
          attr({ popover: 'manual' }),
          designSheet.customScroll,
          stylePseudo('::-webkit-scrollbar-track', { background: 'transparent' }),
          stylePseudo('::-webkit-scrollbar-corner', { background: 'transparent' }),
          style({
            position: 'fixed',
            visibility: 'hidden',
            margin: '0',
            color: 'inherit',
            scrollbarWidth: 'thin',
            scrollbarColor: `${colorShade(palette.foreground, 50)} transparent`
          }),
          effectProp(
            'onclick',
            nowWith(() => stopPropagation)
          ),
          effectRun(showPopover),
          contentTether(observer.intersection() as IOps<INode<HTMLElement>, IntersectionObserverEntry[]>),
          styleInline(
            map(
              ({ aEntry, cEntry }) => {
                const aEl = aEntry[0]?.target as HTMLElement | undefined
                const cEl = cEntry[0]?.target as HTMLElement | undefined
                if (!aEl || !cEl) return {}
                const rect = aEl.getBoundingClientRect()
                return {
                  top: `${rect.bottom - 1}px`,
                  left: `${rect.left}px`,
                  minWidth: `${rect.width}px`,
                  maxHeight: `${Math.max(120, window.innerHeight - rect.bottom - 20)}px`,
                  overflowY: 'auto',
                  visibility: 'visible'
                }
              },
              combine({ aEntry: anchorEntry, cEntry: contentEntry, _: start(null, reposition) })
            )
          )
        )(
          switchMap(
            list =>
              $node(
                ...list.map(opt =>
                  $optionContainer(selectTether(nodeEvent('click'), constant(opt)))(switchLatest($$option(just(opt))))
                )
              ),
            toStream(optionList)
          )
        )
      }, isOpen)

      const $dropdownContainer = $container(disabledOp(disabled), openMenuTether(nodeEvent('click')))

      return [$dropdownContainer($observedAnchor, $list), { select, isOpen }]
    }
  )
}
