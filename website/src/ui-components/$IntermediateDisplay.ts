import { type Fn, filterNull, type IStream, map, op, reduce, switchLatest } from 'aelea/stream'
import { type PromiseState, PromiseStatus, promiseState } from 'aelea/stream-extended'
import { $node, $text, type I$Node, style } from 'aelea/ui'
import { $column, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { text } from '@/ui-components'
import { $alertTooltip } from './$alert.js'
import { $icon } from './$common.js'
import { $alertIcon } from './$icons.js'

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

export const $loadingValue = (valueSrc: IStream<string>): I$Node =>
  switchLatest(map(v => (v === '…' ? $inlineSpinner : $node($text(v))), valueSrc))

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

export const $sectionLoader: I$Node = $column(style({ alignItems: 'center', padding: '48px 0' }))($spinner)

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

  return { title: err?.name ?? 'Error', detail: raw }
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
    $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: 1.4 }))($text(detail))
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
}: I$IntermediatPromise<T>) =>
  op(
    promiseState($display),
    reduce(
      (shown: { node: I$Node | null; settled: boolean }, state: PromiseState<I$Node>) => {
        if (state.status === PromiseStatus.PENDING) return { node: shown.settled ? null : $loader, settled: shown.settled }
        if (state.status === PromiseStatus.ERROR) {
          console.error(state.error)
          return { node: $$fail(state.error), settled: false }
        }
        return { node: state.value, settled: true }
      },
      { node: null, settled: false }
    ),
    map(shown => shown.node),
    filterNull,
    switchLatest
  )
