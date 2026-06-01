import type { IMatchmakerStatus } from '@puppet/sdk/compact'
import { HUB_CHAIN_NETWORK } from '@puppet/sdk/const'
import { getTimeAgo, readableUnitAmount } from '@puppet/sdk/core'
import type { IndexerHealth, LagSeverity } from '@puppet/sdk/state'
import {
  combine,
  empty,
  type IStream,
  map,
  merge,
  op,
  periodic,
  start,
  switchLatest,
  switchMap,
  take
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type I$Slottable, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Tooltip, text } from '@/ui-components'
import * as context from '../io/context.js'

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
      $node(style({ fontSize: text.xs, color: palette.foreground }))($desc)
    ),
    $servicePill(health)
  )

const indexerHealthToService: Record<LagSeverity, ServiceHealth> = {
  healthy: 'ok',
  lagging: 'degraded',
  stale: 'down',
  unreachable: 'down'
}

const $indexerServiceLine = (health: IndexerHealth | null) => {
  if (!health?.reachable) return $serviceLine('Indexer', $text('Not reachable: queries may fail'), 'down')
  const home = health.chains[HUB_CHAIN_NETWORK]
  if (!home) return $serviceLine('Indexer', $text('Home chain missing from status'), 'down')
  const liveText: IStream<string> = map(
    () => `Block ${readableUnitAmount(home.block.number)} · ${getTimeAgo(home.block.timestamp)}`,
    start(0, periodic(1000))
  )
  return $serviceLine('Indexer', $text(liveText), indexerHealthToService[home.severity])
}

const isIndexerHealthy = (health: IndexerHealth | null): boolean => {
  if (!health?.reachable) return false
  const home = health.chains[HUB_CHAIN_NETWORK]
  return !!home && home.severity === 'healthy'
}

const $matchmakerServiceLine = (status: IMatchmakerStatus) => {
  if (status === 'open') return $serviceLine('Matchmaker', $text('Connected · ready to relay'), 'ok')
  return $serviceLine('Matchmaker', $text('Disconnected · submissions paused'), 'down')
}

interface I$ServicesConnectivity {
  matchmaker: IStream<IMatchmakerStatus>
}

export const $ServicesConnectivity = ({ matchmaker }: I$ServicesConnectivity) =>
  component(([hover, hoverTether]: IBehavior<boolean>) => {
    const hoverState: IStream<boolean> = state(false, hover)
    const oneShot: IStream<IndexerHealth> = take(1, context.indexerHealth)
    const onHover: IStream<IndexerHealth> = switchMap(h => (h ? context.indexerHealth : empty), hoverState)
    const indexer: IStream<IndexerHealth> = state()(merge(oneShot, onHover))

    const $tooltip: I$Node = op(
      combine({ indexer, matchmaker }),
      map(p =>
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $node(style({ fontSize: text.sm, lineHeight: '1.4' }))(
            $text('Backend services powering queries and submissions.')
          ),
          $column(spacing.default, style({ paddingTop: '8px', borderTop: `1px solid ${palette.horizon}` }))(
            $indexerServiceLine(p.indexer),
            $matchmakerServiceLine(p.matchmaker)
          )
        )
      ),
      start(
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $node(style({ fontSize: text.sm, lineHeight: '1.4' }))(
            $text('Backend services powering queries and submissions.')
          ),
          $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Connecting…'))
        )
      ),
      switchLatest
    )

    const color: IStream<string> = start(
      palette.foreground,
      map(
        p => (isIndexerHealthy(p.indexer) && p.matchmaker === 'open' ? palette.positive : palette.negative),
        combine({ indexer, matchmaker })
      )
    )
    const pulsing: IStream<boolean> = start(
      true,
      map(p => !isIndexerHealthy(p.indexer) || p.matchmaker !== 'open', combine({ indexer, matchmaker }))
    )

    return [
      $Tooltip({
        $content: $tooltip,
        $anchor: switchMap(
          params =>
            $row(
              style({
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                padding: '6px',
                backgroundColor: colorShade(params.color, 50)
              })
            )(
              $node(
                style({
                  position: 'absolute',
                  top: 'calc(50% - 20px)',
                  left: 'calc(50% - 20px)',
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  border: '1px solid rgba(74, 180, 240, 0.12)',
                  opacity: 0,
                  backgroundColor: colorShade(params.color, 50),
                  animationName: 'signal',
                  animationDuration: '2s',
                  animationTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  animationIterationCount: params.pulsing ? 'infinite' : '1'
                })
              )()
            ),
          combine({ color, pulsing })
        )
      })({ hover: hoverTether() }),
      { hover }
    ]
  })
