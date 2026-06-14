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
import { $node, $text, component, type I$Node, type I$Slottable, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $Tooltip, text } from '@/ui-components'
import * as context from '../io/context.js'
import { puppetConnectedOrigins, puppetExtensionInstalled, puppetExtensionOutdated } from '../wallet/index.js'

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
  if (status === 'open') return $serviceLine('Attestor', $text('Connected · ready to relay'), 'ok')
  return $serviceLine('Attestor', $text('Disconnected · submissions paused'), 'down')
}

function originHost(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

// The browser extension is OPTIONAL — it lets dApps use your fund as a wallet. Its status
// is informational only; it never drives the overall connectivity indicator.
const $extensionServiceLine = (installed: boolean, outdated: boolean, origins: string[]) => {
  if (outdated)
    return $serviceLine('Puppet Wallet', $text('Update needed · the installed extension is out of date'), 'degraded')
  if (origins.length > 0) {
    const $desc = $column(style({ gap: '2px' }))(
      $text(origins.length === 1 ? 'Connected to' : `Connected to ${origins.length} sites`),
      ...origins.map(o => $node(style({ color: palette.message }))($text(originHost(o))))
    )
    return $serviceLine('Puppet Wallet', $desc, 'ok')
  }
  if (installed) return $serviceLine('Puppet Wallet', $text('Installed · no dApp connected'), 'degraded')
  return $serviceLine('Puppet Wallet', $text('Extension not installed · optional'), 'down')
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
      combine({
        indexer,
        matchmaker
        // Browser extension status sunset for now; revive with the $extensionServiceLine below.
        // extensionInstalled: puppetExtensionInstalled,
        // extensionOutdated: puppetExtensionOutdated,
        // origins: puppetConnectedOrigins
      }),
      map(p =>
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.base, fontWeight: 'bold', color: palette.message }))($text('Connections')),
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
              $text('Your live status of the protocol operations.')
            )
          ),
          $column(spacing.default, style({ paddingTop: '8px', borderTop: `1px solid ${palette.horizon}` }))(
            $indexerServiceLine(p.indexer),
            $matchmakerServiceLine(p.matchmaker)
            // $extensionServiceLine(p.extensionInstalled, p.extensionOutdated, p.origins)
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
      map(p => {
        if (isIndexerHealthy(p.indexer) && p.matchmaker === 'open') return palette.positive
        return palette.negative
      }, combine({ indexer, matchmaker }))
    )
    const pulsing: IStream<boolean> = start(
      true,
      map(p => !isIndexerHealthy(p.indexer) || p.matchmaker !== 'open', combine({ indexer, matchmaker }))
    )

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
