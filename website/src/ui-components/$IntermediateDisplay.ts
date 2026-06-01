import {
  constant,
  empty,
  type Fn,
  fromPromise,
  type IOps,
  type IStream,
  just,
  map,
  start,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { multicast, PromiseStatus, promiseState } from 'aelea/stream-extended'
import { $node, $text, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Chain, TransactionReceipt } from 'viem'
import { text } from '@/ui-components'
import { $alert, $alertTooltip } from './$alert.js'
import { $icon, $txHashRef } from './$common.js'
import { $alertIcon } from './$icons.js'

export const intermediateText = (querySrc: IStream<Promise<string>>, hint = '-'): IStream<string> =>
  switchMap(res => start(hint, fromPromise(res)), querySrc)

export const $intermediateText = (querySrc: IStream<Promise<string>>, hint = '-', $display = $text): I$Slottable =>
  $display(intermediateText(querySrc, hint))

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

export interface I$IntermediatPromise<_T> {
  clean?: IStream<any>
  $display: IStream<Promise<I$Node>>
  $$fail?: Fn<unknown, I$Node>

  $loader?: I$Node
}

interface ClassifiedError {
  title: string
  detail: string
}

// Extract a display-friendly (title, detail) from an unknown throwable.
// Title from `error.name` (e.g. "IndexerHttpError"); detail from the message
// or a trimmed HTML body. No editorializing; the throw-site phrasing wins.
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

export const $intermediatePromise = <T>({
  $loader = $spinner,
  $$fail = res => {
    const { detail } = classifyError(res)
    return style({ placeSelf: 'center', margin: 'auto' })($alertTooltip($text(detail)))
  },
  $display
}: I$IntermediatPromise<T>) =>
  switchMap(state => {
    if (state.status === PromiseStatus.PENDING) {
      return $loader
    }

    if (state.status === PromiseStatus.ERROR) {
      console.error(state.error)
      return $$fail(state.error)
    }

    return state.value
  }, promiseState($display))

type IIntermediateTx<TSuccess extends TransactionReceipt> = {
  $$success?: IOps<TSuccess, I$Node>
  chain: Chain
  query: IStream<Promise<TSuccess>>
  clean?: IStream<any>
  showTooltip?: boolean
}

export const $IntermediateTx = <TSuccess extends TransactionReceipt>({
  query,
  chain,
  clean = empty,
  $$success = constant($node(style({ color: palette.positive }))($text('Transaction confirmed'))),
  showTooltip = false
}: IIntermediateTx<TSuccess>) => {
  const multicastQuery = multicast(query)

  return $intermediatePromise<TSuccess>({
    clean,
    $display: map(async query => {
      const res = await query

      return $row(spacing.small, style({ color: palette.positive }))(
        switchLatest($$success(just(res))),
        $txHashRef(res.transactionHash, chain)
      )
    }, multicastQuery),
    $loader: switchLatest(
      map(c => {
        return $row(spacing.small, style({ alignItems: 'center', fontSize: text.sm }))(
          $spinner,
          $text(
            start(
              'Wallet Request...',
              map(() => 'Awaiting confirmation...', fromPromise(c))
            )
          ),
          $node(style({ flex: 1 }))(),
          switchLatest(map(txHash => $txHashRef(txHash.transactionHash, chain), fromPromise(c)))
        )
      }, multicastQuery)
    ),
    $$fail: res => {
      const error = String(res)

      return showTooltip ? $alertTooltip($node($text(error))) : $alert($node($text(error)))
    }
  })
}
