import { constant, empty, type IOps, type IStream, map, merge, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  attr,
  component,
  effectRun,
  type I$Node,
  type INode,
  type INodeCompose,
  nodeEvent,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $caretDown, $defaultDropSelectAnchor, $icon, keyActivate, text } from '@/ui-components'

// Shared chrome for the inline selection flows ($TokenSelectFlow / $SwapTargetFlow): a hoverable,
// keyboard-activatable row shell, the header bar with a far-right slot, and the edge-bleeding scroll container.
export const $pressableRow = $node(
  style({ display: 'flex', cursor: 'pointer', borderRadius: '10px' }),
  stylePseudo(':hover', { backgroundColor: palette.horizon }),
  attr({ role: 'button', tabindex: '0' }),
  keyActivate()
)

export const $listHeader = ($leading: I$Node, $trailing: I$Node): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minHeight: '28px' }))(
    $leading,
    $node(style({ flex: '1' }))(),
    $trailing
  )

export const $listHeaderTitle = (label: string): I$Node =>
  $node(style({ fontSize: text.sm, fontWeight: '500', color: palette.foreground }))($text(label))

export const $closeButton = (closeOp: IOps<INode, unknown>): I$Node =>
  $node(
    style({ cursor: 'pointer', color: palette.foreground, fontSize: text.base, padding: '2px 6px' }),
    attr({ role: 'button', tabindex: '0', 'aria-label': 'Close selection' }),
    keyActivate(),
    closeOp as IOps<INode, INode>
  )($text('✕'))

// Rows bleed past the section's horizontal padding (28px, minus the rows' own 8px) so the list reads
// near-edge-to-edge while the header keeps the section's text inset. No inner scroller: the list flows at full
// height and overflow rides the popover's own scroll, so there is exactly ONE scrollbar.
export const $rowsContainer = $column(style({ gap: '2px', margin: '0 -20px' }))

// Type-to-filter field doubling as the list TITLE: transparent and borderless, it sits in the header's leading slot
// with the title text as its placeholder. Grabs focus on mount so the list is searchable the instant it opens; the
// delayed focus() clears the popover's own focus handoff first (same idiom as $TokenAmountInput).
export const $listSearchInput = (placeholder: string, searchOp: IOps<INode<HTMLInputElement>, unknown>): I$Node =>
  $element('input')(
    attr({ type: 'text', placeholder, 'aria-label': placeholder }),
    style({
      background: 'transparent',
      border: 'none',
      outline: 'none',
      fontFamily: 'inherit',
      fontSize: text.base,
      color: palette.message,
      flex: '1',
      minWidth: '0',
      padding: '4px 0'
    }),
    stylePseudo('::placeholder', { color: palette.foreground }),
    effectRun(el => {
      const id = window.setTimeout(() => (el as HTMLInputElement).focus(), 50)
      return {
        [Symbol.dispose]() {
          window.clearTimeout(id)
        }
      }
    }),
    searchOp as IOps<INode<HTMLInputElement>, INode<HTMLInputElement>>
  )()

export const searchInputValue = (ev: Event): string =>
  ev.target instanceof HTMLInputElement ? ev.target.value : ''

export const matchesSearch = (query: string, terms: string[]): boolean => {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return terms.some(t => t.toLowerCase().includes(q))
}

export interface I$InlineSwitchView {
  // The editor's styled top-section box; the shell swaps its CONTENT between the input layout and the list view.
  $container: INodeCompose
  // The editor's input layout, handed the anchor to place (clicking the anchor opens the list view).
  $inputContent: ($anchor: I$Node) => I$Node
  // Identity shown inside the anchor pill, next to the caret.
  $anchorContent: I$Node
  // The list view; receives the shell's open events so multi-step consumers can reset their step on each open.
  $listContent: (open: IStream<PointerEvent>) => I$Node
  // Consumer signal that selection is over (a final pick or an explicit close): the shell returns to the input view.
  close: IStream<unknown>
}

// The switch-view mechanic every inline selection flow composes: an anchor pill in the editor's input layout that
// swaps the section content to a list view and back on `close`. The input layout is only ever HIDDEN, never
// unmounted — its tethered field/alert streams must survive the trip through the list view.
export const $InlineSwitchView = (config: I$InlineSwitchView) =>
  component(([openList, openListTether]: IBehavior<INode, PointerEvent>) => {
    const selecting: IStream<boolean> = state(
      false,
      merge(constant(true, openList), constant(false, config.close))
    )

    const $anchor = $defaultDropSelectAnchor(
      attr({ role: 'button', tabindex: '0' }),
      keyActivate(),
      openListTether(nodeEvent('click'))
    )(
      config.$anchorContent,
      $icon({
        $content: $caretDown,
        width: '12px',
        fill: palette.foreground,
        svgOps: style({ minWidth: '12px' }),
        viewBox: '0 0 32 32'
      })
    )

    const $list = config.$listContent(openList)

    return [
      config.$container(
        // While selecting, the section swallows the popover chrome entirely (28px padding / 24px radius, the shared
        // editor-popover constants) so no host background peeks around the list; null restores the editor's statics.
        styleBehavior(
          map(s => (s ? { margin: '-28px', borderRadius: '24px', width: 'auto' } : null), selecting)
        )
      )(
        $node(
          style({ display: 'contents' }),
          styleBehavior(map(s => (s ? { display: 'none' } : { display: 'contents' }), selecting))
        )(config.$inputContent($anchor)),
        switchMap(s => (s ? $list : empty), selecting)
      ),
      { selecting }
    ]
  })
