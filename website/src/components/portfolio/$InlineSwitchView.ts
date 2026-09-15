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
  type IStyleCSS,
  nodeEvent,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import {
  $caretDown,
  $defaultDropSelectAnchor,
  $icon,
  $magnifier,
  $xCross,
  keyActivate,
  text
} from '@/ui-components'

export const SELECT_ROW_HEIGHT = '56px'

export const $pressableRow = $node(
  style({ display: 'flex', cursor: 'pointer', borderRadius: '10px' }),
  stylePseudo(':hover', { backgroundColor: palette.horizon }),
  attr({ role: 'button', tabindex: '0' }),
  keyActivate()
)

export interface ICrumb {
  label: string
  $lead?: I$Node
  op?: IOps<INode, unknown>
}

const $crumbSeparator = (): I$Node =>
  $icon({
    $content: $caretDown,
    width: '9px',
    fill: palette.foreground,
    svgOps: style({ transform: 'rotate(-90deg)', opacity: '0.55', minWidth: '9px' })
  })

const CRUMB_STYLE: IStyleCSS = { color: palette.foreground, fontSize: text.sm, fontWeight: '500', whiteSpace: 'nowrap' }

const $crumbFragment = (c: ICrumb): I$Node => {
  const $content = $row(spacing.tiny, style({ alignItems: 'center' }))(...(c.$lead ? [c.$lead] : []), $text(c.label))
  return c.op
    ? $node(
        style({ ...CRUMB_STYLE, cursor: 'pointer' }),
        stylePseudo(':hover', { color: palette.message }),
        attr({ role: 'button', tabindex: '0', 'aria-label': `Back to ${c.label}` }),
        keyActivate(),
        c.op as IOps<INode, INode>
      )($content)
    : $node(style(CRUMB_STYLE))($content)
}

export const $crumbTrail = (trail: ICrumb[]): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
    ...trail.flatMap((c, i) => (i === 0 ? [$crumbFragment(c)] : [$crumbSeparator(), $crumbFragment(c)]))
  )

export const $breadcrumbSearchHeader = (trail: ICrumb[], $search: I$Node, $close: I$Node, fixed?: ICrumb): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', minHeight: '30px', minWidth: '0' }))(
    ...trail.flatMap(c => [$crumbFragment(c), $crumbSeparator()]),
    $search,
    ...(fixed ? [$crumbSeparator(), $crumbFragment(fixed)] : []),
    $close
  )

export const $closeButton = (closeOp: IOps<INode, unknown>): I$Node =>
  $node(
    style({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: palette.foreground,
      width: '30px',
      height: '30px',
      borderRadius: '50%',
      margin: '-4px'
    }),
    stylePseudo(':hover', { backgroundColor: palette.horizon, color: palette.message }),
    attr({ role: 'button', tabindex: '0', 'aria-label': 'Close selection' }),
    keyActivate(),
    closeOp as IOps<INode, INode>
  )($icon({ $content: $xCross, width: '13px', fill: 'currentColor' }))

export const SELECT_LIST_HEIGHT = '320px'

export const $rowsContainer = $column(
  style({
    gap: '2px',
    margin: '0 -20px',
    height: SELECT_LIST_HEIGHT,
    overflowY: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: `${palette.foreground} transparent`
  })
)

export const $listSearchInput = (
  placeholder: string,
  searchOp: IOps<INode<HTMLInputElement>, unknown>,
  autoFocus = true
): I$Node =>
  $row(spacing.small, style({ alignItems: 'center', flex: '1', minWidth: '0' }))(
    $icon({
      $content: $magnifier,
      viewBox: '0 0 24 24',
      width: '16px',
      fill: palette.foreground,
      svgOps: style({ minWidth: '16px' })
    }),
    $element('input')(
      attr({ type: 'text', size: '1', placeholder, 'aria-label': placeholder }),
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
      ...(autoFocus
        ? [
            effectRun(el => {
              const id = window.setTimeout(() => (el as HTMLInputElement).focus(), 50)
              return {
                [Symbol.dispose]() {
                  window.clearTimeout(id)
                }
              }
            })
          ]
        : []),
      searchOp as IOps<INode<HTMLInputElement>, INode<HTMLInputElement>>
    )()
  )

export const searchInputValue = (ev: Event): string =>
  ev.target instanceof HTMLInputElement ? ev.target.value : ''

export const matchesSearch = (query: string, terms: string[]): boolean => {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return terms.some(t => t.toLowerCase().includes(q))
}

export interface I$InlineSwitchView {
  $container: INodeCompose
  $inputContent: ($anchor: I$Node) => I$Node
  $anchorContent: I$Node
  $listContent: (open: IStream<PointerEvent>) => I$Node
  close: IStream<unknown>
}

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
        styleBehavior(
          map(s => (s ? { margin: '-28px', borderRadius: '24px', width: 'auto', overflowX: 'hidden' } : null), selecting)
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
