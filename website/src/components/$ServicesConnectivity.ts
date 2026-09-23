import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IChainLiveness } from '@puppet/sdk/state'
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
import { chainName } from '../common/$chain.js'
import context from '../io/context.js'
import { matchmakerUrl } from '../io/matchmaker/index.js'

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

type ILivenessView = { detail: string; service: ServiceHealth }

const livenessView = (liveness: IChainLiveness): ILivenessView => {
  if (!liveness.reachable) return { detail: 'Unavailable · account state may be stale', service: 'down' }
  if (!liveness.chains[HUB_CHAIN_ID]) return { detail: 'Unavailable · hub status missing', service: 'down' }
  return { detail: 'Reachable · account state is current', service: 'ok' }
}

const PROBE_TIMEOUT_MS = 5000
const probeChronicle = (): Promise<ILivenessView> =>
  Promise.race([
    fetch('/api/chronicle/status').then(async (res): Promise<ILivenessView> => {
      if (!res.ok) return { detail: `Unavailable (${res.status}) · data may be out of date`, service: 'down' }
      const report = (await res.json()) as { chains: { chainId: number; halted: string | null }[] }
      const frozen = report.chains.filter(chain => chain.halted !== null)
      return frozen.length === 0
        ? { detail: 'Reachable · funds and valuations are current', service: 'ok' }
        : { detail: `Halted on ${frozen.map(chain => chainName(chain.chainId)).join(', ')} · funds and valuations there are frozen until it is repaired`, service: 'down' }
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS))
  ]).catch((): ILivenessView => ({ detail: 'Unavailable · data may be out of date', service: 'down' }))

const probeMatchmaker = (): Promise<ILivenessView> =>
  Promise.race([
    fetch(`${matchmakerUrl}/status`).then((res): ILivenessView =>
      res.ok
        ? { detail: 'Reachable · actions co-sign, accounts create, dApps sign', service: 'ok' }
        : { detail: `Unavailable (${res.status}) · no action, account creation or dApp signing`, service: 'down' }
    ),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS))
  ]).catch((): ILivenessView => ({ detail: 'Unavailable · no action, account creation or dApp signing', service: 'down' }))

export const $ServicesConnectivity = () =>
  component(([hover, hoverTether]: IBehavior<boolean>) => {
    const hoverState: IStream<boolean> = state(false, hover)
    const liveness: IStream<IChainLiveness> = state()(
      merge(
        fromPromise(context.getChainLiveness()),
        switchMap(h => (h ? fromPromise(context.getChainLiveness()) : empty), hoverState)
      )
    )
    const view: IStream<ILivenessView> = map(livenessView, liveness)
    const chronicleView: IStream<ILivenessView> = state()(
      merge(
        fromPromise(probeChronicle()),
        switchMap(h => (h ? fromPromise(probeChronicle()) : empty), hoverState)
      )
    )
    const matchmakerView: IStream<ILivenessView> = state()(
      merge(
        fromPromise(probeMatchmaker()),
        switchMap(h => (h ? fromPromise(probeMatchmaker()) : empty), hoverState)
      )
    )
    const anyDown: IStream<boolean> = map(
      p => p.view.service !== 'ok' || p.chronicleView.service !== 'ok' || p.matchmakerView.service !== 'ok',
      combine({ view, chronicleView, matchmakerView })
    )

    const $tooltip: I$Node = op(
      combine({ view, chronicleView, matchmakerView }),
      map(p =>
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.base, color: palette.message }))($text('Connections')),
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
              $text('Your live status of the protocol operations.')
            )
          ),
          $column(spacing.default, style({ paddingTop: '8px', borderTop: `1px solid ${palette.horizon}` }))(
            $serviceLine('Chain', $text(p.view.detail), p.view.service),
            $serviceLine('Chronicle', $text(p.chronicleView.detail), p.chronicleView.service),
            $serviceLine('Matchmaker', $text(p.matchmakerView.detail), p.matchmakerView.service)
          )
        )
      ),
      start(
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.base, color: palette.message }))($text('Connections')),
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
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
