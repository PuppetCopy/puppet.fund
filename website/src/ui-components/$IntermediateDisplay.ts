import { disposeBoth, disposeWith, type Fn, filterNull, type IStream, map, op, reduce, skipRepeats, switchLatest, tryEvent } from 'aelea/stream'
import { type PromiseState, PromiseStatus, state } from 'aelea/stream-extended'
import { $element, $node, $text, attrBehavior, type I$Node, type I$Slottable, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $Tooltip, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
import { $alertTooltip } from './$alert.js'
import { $icon } from './$common.js'
import { $alertIcon } from './$icons.js'
import { INTERMEDIATE_FILL } from './$intermediate.js'

export const $inlineSpinner: I$Node = $node(
  style({
    display: 'inline-block',
    verticalAlign: 'middle',
    width: '15px',
    height: '15px',
    flexShrink: '0',
    boxSizing: 'border-box',
    borderStyle: 'dotted',
    borderWidth: '2px',
    borderColor: `${palette.foreground} transparent ${colorShade(palette.foreground, 30)} transparent`,
    borderRadius: '50%',
    transformOrigin: '50% 50%',
    willChange: 'transform',
    animation: 'rotate 0.7s cubic-bezier(0.68, -0.35, 0.265, 1.35) infinite'
  })
)()

export const $spinner = $node(
  style({
    margin: 'auto',
    placeSelf: 'center',
    alignSelf: 'center',
    animation: 'rotate 0.7s cubic-bezier(0.68, -0.35, 0.265, 1.35) infinite',
    borderStyle: 'dotted',
    borderWidth: '3px',
    borderColor: `${palette.foreground} transparent ${colorShade(palette.foreground, 30)} transparent`,
    borderRadius: '50%',
    aspectRatio: '1 / 1',
    minHeight: '40px',
    minWidth: '40px',
    height: '40px',
    boxSizing: 'border-box',
    display: 'inline-block',
    transformOrigin: '50% 50%',
    lineHeight: 0,
    flexShrink: 0,
    willChange: 'transform'
  })
)()

const REFRESHING = { animation: INTERMEDIATE_FILL.animation, textDecoration: 'none', cursor: 'inherit' }
const STALE = { animation: 'none', textDecoration: `underline dotted ${palette.indeterminate}`, textUnderlineOffset: '3px', cursor: 'help' }

export const $tooltipDropContainer = $column(
  style({
    whiteSpace: 'pre-wrap',
    maxWidth: '600px',
    lineHeight: '1.5',
    fontSize: text.base,
    fontWeight: 'normal',
    userSelect: 'text',
    background: colorShade(palette.foreground, 14),
    boxShadow: `${palette.shadow} 0px 4px 20px 8px, ${palette.shadow} 0px 1px 3px 1px`,
    padding: '16px',
    minWidth: '300px',
    borderRadius: '8px'
  })
)

const PENDING_STATE = { status: PromiseStatus.PENDING } as const

export const intermediateState = <T>(source: IStream<Promise<T>>): IStream<PromiseState<T>> => ({
  run(sink, scheduler) {
    let arrived = 0
    let shown = 0
    let ended = false
    let disposed = false
    const settle = (order: number, result: PromiseState<T>) => {
      if (disposed || order <= shown) return
      shown = order
      const time = scheduler.time()
      tryEvent(sink, time, result)
      if (order < arrived) tryEvent(sink, time, PENDING_STATE)
      else if (ended) sink.end(time)
    }
    return disposeBoth(
      source.run(
        {
          event(time, promise) {
            const order = ++arrived
            if (order === shown + 1) sink.event(time, PENDING_STATE)
            promise.then(
              value => settle(order, { status: PromiseStatus.DONE, value }),
              (error: unknown) => settle(order, { status: PromiseStatus.ERROR, error })
            )
          },
          error: (time, error) => sink.error(time, error),
          end(time) {
            ended = true
            if (shown === arrived) sink.end(time)
          }
        },
        scheduler
      ),
      disposeWith(() => {
        disposed = true
      })
    )
  }
})

export const $intermediateText = (valueSrc: IStream<Promise<string> | string>): I$Node => {
  const shown = op(
    intermediateState(map(v => Promise.resolve(v), valueSrc)),
    reduce(
      (last: { text: string; pending: boolean; failure: { error: unknown } | null }, s: PromiseState<string>) =>
        s.status === PromiseStatus.PENDING
          ? { text: last.text, pending: true, failure: null }
          : s.status === PromiseStatus.ERROR
            ? { text: last.text, pending: false, failure: { error: s.error } }
            : { text: s.value, pending: false, failure: null },
      { text: '-', pending: true, failure: null }
    ),
    state()
  )
  const $value = $element('span')(styleBehavior(map(s => (s.pending ? REFRESHING : s.failure !== null ? STALE : null), shown)))($text(map(s => s.text, shown)))
  return switchLatest(
    map(
      reason =>
        reason === null ? $value : $Tooltip({ $dropContainer: $tooltipDropContainer, $content: $node($text(reason)), $anchor: $value })({}),
      op(
        shown,
        map(s => (s.failure === null ? null : `${s.text === '-' ? 'Could not load' : 'Could not refresh'}: ${classifyError(s.failure.error).detail}`)),
        skipRepeats
      )
    )
  )
}

export const $intermediateFailure = (error: unknown, $anchor: I$Slottable, known: boolean): I$Node =>
  $Tooltip({
    $dropContainer: $tooltipDropContainer,
    $content: $node($text(`${known ? 'Could not refresh' : 'Could not load'}: ${classifyError(error).detail}`)),
    $anchor: $node(style({ display: 'inline-flex', alignItems: 'center', borderBottom: `1px dotted ${palette.indeterminate}`, cursor: 'help' }))($anchor)
  })({})

export interface I$IntermediatPromise<_T> {
  $display: IStream<Promise<I$Node>>
  $$fail?: Fn<unknown, I$Node>

  $loader?: I$Node
}

interface ClassifiedError {
  title: string
  detail: string
}

function classifyError(res: unknown): ClassifiedError {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { title: 'Offline', detail: "You're offline" }
  const err = res && typeof res === 'object' ? (res as { name?: string; message?: string }) : null

  const raw =
    typeof res === 'string'
      ? res
      : err?.message
        ? String(err.message)
        : (() => {
            try {
              return JSON.stringify(res)
            } catch {
              return 'Unknown error'
            }
          })()

  if (raw.includes('<html') || raw.includes('<!DOCTYPE')) {
    const titleMatch = raw.match(/<title>([^<]+)<\/title>/i)
    const h1Match = raw.match(/<h1>([^<]+)<\/h1>/i)
    const extracted = titleMatch?.[1] || h1Match?.[1] || 'Service Unavailable'
    return { title: 'Service unavailable', detail: extracted.trim() }
  }

  return { title: 'Could not load', detail: raw }
}

export const $errorCard = (res: unknown): I$Node => {
  const { title, detail } = classifyError(res)
  return $column(
    spacing.small,
    style({
      placeSelf: 'center',
      margin: 'auto',
      maxWidth: '420px',
      padding: '20px 24px',
      borderRadius: '12px',
      backgroundColor: palette.background,
      border: `1px solid ${colorShade(palette.negative, 35)}`,
      boxShadow: `0 4px 20px ${palette.shadow}`,
      alignItems: 'center',
      textAlign: 'center'
    })
  )(
    $icon({
      $content: $alertIcon,
      viewBox: '0 0 24 24',
      width: '28px',
      fill: palette.negative,
      svgOps: style({ minWidth: '28px' })
    }),
    $node(style({ fontWeight: '600', fontSize: text.base, color: palette.message }))($text(title)),
    $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: 1.4, overflowWrap: 'anywhere' }))($text(detail))
  )
}

export const $errorLabel = (res: unknown): I$Node => {
  const { detail } = classifyError(res)
  return $alertTooltip($text(detail))
}

export const $intermediatePromise = <T>({
  $loader = $spinner,
  $$fail = res => style({ placeSelf: 'center', margin: 'auto' })($errorLabel(res)),
  $display
}: I$IntermediatPromise<T>) => {
  return op(
    intermediateState($display),
    reduce(
      (last: { node: I$Node | null; settled: boolean }, next: PromiseState<I$Node>) => {
        if (next.status === PromiseStatus.PENDING) return { node: last.settled ? null : $loader, settled: last.settled }
        if (next.status === PromiseStatus.ERROR) {
          console.error(next.error)
          return { node: $$fail(next.error), settled: false }
        }
        return { node: next.value, settled: true }
      },
      { node: null, settled: false }
    ),
    map(s => s.node),
    filterNull,
    switchLatest
  )
}

export const $intermediatePulse = (refreshing: IStream<boolean>) =>
  $node(style({ display: 'contents' }), attrBehavior(map(on => ({ 'data-refreshing': on ? '' : null }), refreshing)), stylePseudo('[data-refreshing] > *', REFRESHING))
