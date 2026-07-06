import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { platformScaleTable } from '@puppet/sdk/schema'
import type { IChainLiveness } from '@puppet/sdk/state'
import { PLATFORM_SCALE_ID } from '@puppet/sdk/state'
import {
  combine,
  empty,
  fromPromise,
  type IStream,
  map,
  merge,
  op,
  start,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type I$Slottable, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Tooltip, text } from '@/ui-components'
import context from '../io/context.js'
import { client } from '../io/datastore/reads.js'

type ServiceHealth = 'ok' | 'degraded' | 'down'

const serviceColor: Record<ServiceHealth, string> = {
  ok: palette.positive,
  degraded: palette.indeterminate,
  down: palette.negative
}

const $servicePill = (health: ServiceHealth) =>
  $node(
    style({
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: serviceColor[health],
      flexShrink: '0'
    })
  )()

const $serviceLine = (label: string, $desc: I$Slottable, health: ServiceHealth) =>
  $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
    $column(style({ gap: '2px' }))(
      $node(style({ fontSize: text.sm }))($text(label)),
      $node(style({ fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap' }))($desc)
    ),
    $servicePill(health)
  )

// The liveness read and an independent live-RPC head read should agree (both hit the chain's RPC). If the second read
// has moved this far past the liveness head, the snapshot is stale, so flag the chain as out of sync.
const FROZEN_AHEAD = 1000n

type ILivenessView = { detail: string; service: ServiceHealth }

const livenessView = (liveness: IChainLiveness | null, rpcHead: bigint | null | undefined): ILivenessView => {
  if (!liveness?.reachable) return { detail: 'Unavailable · account state may be stale', service: 'down' }
  const home = liveness.chains[HUB_CHAIN_ID]
  if (!home?.reachable) return { detail: 'Unavailable · hub status missing', service: 'down' }
  const frozen = typeof rpcHead === 'bigint' && rpcHead - home.block.number > FROZEN_AHEAD
  if (frozen) return { detail: 'Out of sync · activity may be missing', service: 'down' }
  return { detail: 'Reachable · account state is current', service: 'ok' }
}

// The indexer (journal) probe: one cheap single-row query; the client throws on failure, so a downed service lands in
// the catch below. Time-boxed so a hanging transport reads as down rather than pinning the pill on "Connecting". An
// empty result still proves the service answered.
const INDEXER_PROBE_TIMEOUT_MS = 5000
const probeIndexer = (): Promise<ILivenessView> =>
  Promise.race([
    client
      .select(platformScaleTable, { where: { id: PLATFORM_SCALE_ID }, limit: 1 })
      .then((): ILivenessView => ({ detail: 'Reachable · funds and history are current', service: 'ok' })),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), INDEXER_PROBE_TIMEOUT_MS))
  ]).catch((): ILivenessView => ({ detail: 'Unavailable · data may be out of date', service: 'down' }))

export const $ServicesConnectivity = () =>
  component(([hover, hoverTether]: IBehavior<boolean>) => {
    const hoverState: IStream<boolean> = state(false, hover)
    // Fetch chain liveness ONCE on mount so the pill reflects real status on initial page load, then refetch on each
    // tooltip open for freshness. The mount read is merged in unconditionally (not via hoverState) because hoverState
    // emits false right after mount, which would switch away from and cancel an in-flight initial fetch.
    const liveness: IStream<IChainLiveness> = state()(
      merge(
        fromPromise(context.getChainLiveness()),
        switchMap(h => (h ? fromPromise(context.getChainLiveness()) : empty), hoverState)
      )
    )
    // Cross-check the liveness head against a SECOND, independent live-RPC read: a single read that lags or stalls
    // would hide the real gap. Refetch on each liveness emission; `start` seeds the pending state ONCE so a re-poll
    // holds the last head (no placeholder flash) until the new one lands.
    const rpcHead: IStream<bigint | null | undefined> = op(
      liveness,
      switchMap(() => fromPromise(context.getBlockNumber(HUB_CHAIN_ID).catch(() => null))),
      start(undefined as bigint | null | undefined),
      state()
    )

    const view: IStream<ILivenessView> = map(p => livenessView(p.liveness, p.rpcHead), combine({ liveness, rpcHead }))
    // The indexer probe follows the same cadence as liveness: once on mount, refreshed on each tooltip open.
    const indexerView: IStream<ILivenessView> = state()(
      merge(
        fromPromise(probeIndexer()),
        switchMap(h => (h ? fromPromise(probeIndexer()) : empty), hoverState)
      )
    )
    // At least one service down => the whole indicator reads down (red, pulsing).
    const anyDown: IStream<boolean> = map(
      p => p.view.service !== 'ok' || p.indexerView.service !== 'ok',
      combine({ view, indexerView })
    )

    const $tooltip: I$Node = op(
      combine({ view, indexerView }),
      map(p =>
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))($text('Connections')),
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
              $text('Your live status of the protocol operations.')
            )
          ),
          $column(spacing.default, style({ paddingTop: '8px', borderTop: `1px solid ${palette.horizon}` }))(
            $serviceLine('Chain', $text(p.view.detail), p.view.service),
            $serviceLine('Indexer', $text(p.indexerView.detail), p.indexerView.service)
          )
        )
      ),
      start(
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))($text('Connections')),
            $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.4' }))(
              $text('Your live status of the protocol operations.')
            )
          ),
          $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Connecting…'))
        )
      ),
      switchLatest
    )

    const color: IStream<string> = start(
      palette.foreground,
      map(down => (down ? palette.negative : palette.positive), anyDown)
    )
    const pulsing: IStream<boolean> = start(true, anyDown)

    return [
      $Tooltip({
        $content: $tooltip,
        $anchor: $row(
          style({
            position: 'relative',
            width: '32px',
            height: '32px',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: '0'
          })
        )(
          $node(
            style({
              position: 'absolute',
              inset: '0',
              borderRadius: '50%',
              animationDuration: '1.6s',
              animationTimingFunction: 'ease-out',
              animationIterationCount: 'infinite'
            }),
            styleBehavior(
              map(
                p => ({
                  backgroundColor: `color-mix(in srgb, ${p.color} ${p.pulsing ? 35 : 10}%, transparent)`,
                  animationName: p.pulsing ? 'signal' : 'none'
                }),
                combine({ color, pulsing })
              )
            )
          )(),
          $node(
            style({ position: 'relative', width: '10px', height: '10px', borderRadius: '50%' }),
            styleBehavior(map(c => ({ backgroundColor: colorShade(c, 50) }), color))
          )()
        )
      })({ hover: hoverTether() }),
      { hover }
    ]
  })
