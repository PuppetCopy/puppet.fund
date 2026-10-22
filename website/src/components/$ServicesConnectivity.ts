import { combine, empty, fromPromise, type IStream, just, map, merge, nowWith, op, start, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, effectProp, type I$Node, type I$Slottable, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $intermediateText, $Link, $Tooltip, text } from '@/ui-components'
import { changelogOf } from '../app/changelog.js'
import { ENDPOINTS } from '../app/endpoints.js'
import { routeSchema } from '../app/routeSchema.js'
import { chainName } from '../common/$chain.js'
import { matchmakerUrl } from '../io/matchmaker/index.js'

type ServiceHealth = 'ok' | 'degraded' | 'down' | 'unchecked'

const serviceColor: Record<ServiceHealth, string> = {
  ok: palette.positive,
  degraded: palette.indeterminate,
  down: palette.negative,
  unchecked: palette.foreground
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
type IStatusView = { chain: ILivenessView; chronicle: ILivenessView }

const PROBE_TIMEOUT_MS = 5000
const PROBE_AFTER_PAINT_MS = 2_000

const probeChronicle = (): Promise<IStatusView> =>
  Promise.race([
    fetch(`${ENDPOINTS.chronicle}/status`).then(async (res): Promise<IStatusView> => {
      if (!res.ok) {
        return {
          chain: { detail: 'Unknown · reported by the chronicle', service: 'unchecked' },
          chronicle: { detail: `Unavailable (${res.status}) · data may be out of date`, service: 'down' }
        }
      }
      const report = (await res.json()) as { chains: { chainId: number; halted: string | null; lastError: string | null }[] }
      const frozen = report.chains.filter(chain => chain.halted !== null)
      const failing = report.chains.filter(chain => chain.halted === null && chain.lastError !== null)
      return {
        chain:
          failing.length === 0
            ? { detail: 'Reachable · new activity is recorded as it lands', service: 'ok' }
            : { detail: `Reads failing on ${failing.map(chain => chainName(chain.chainId)).join(', ')} · activity there shows late`, service: 'degraded' },
        chronicle:
          frozen.length === 0
            ? { detail: 'Reachable · funds and valuations are current', service: 'ok' }
            : { detail: `Halted on ${frozen.map(chain => chainName(chain.chainId)).join(', ')} · records there stop updating until it is repaired`, service: 'down' }
      }
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS))
  ]).catch(
    (): IStatusView => ({
      chain: { detail: 'Unknown · reported by the chronicle', service: 'unchecked' },
      chronicle: { detail: 'Unavailable · data may be out of date', service: 'down' }
    })
  )

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
    const painted = new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, PROBE_AFTER_PAINT_MS)))
    const status = state()(
      merge(
        fromPromise(painted.then(probeChronicle)),
        switchMap(h => (h ? fromPromise(probeChronicle()) : empty), hoverState)
      )
    )
    const matchmakerView: IStream<ILivenessView> = state()(
      merge(
        fromPromise(painted.then(probeMatchmaker)),
        switchMap(h => (h ? fromPromise(probeMatchmaker()) : empty), hoverState)
      )
    )
    const worst: IStream<ServiceHealth> = map(p => {
      const all = [p.status.chain.service, p.status.chronicle.service, p.matchmakerView.service]
      return all.includes('down') ? 'down' : all.includes('degraded') ? 'degraded' : 'ok'
    }, combine({ status, matchmakerView }))

    const $version: I$Node[] = [
      $row(
        spacing.small,
        style({ alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: `1px solid ${palette.horizon}` }),
        effectProp('onpointerdown', nowWith(() => (ev: PointerEvent) => ev.stopPropagation()))
      )(
        $column(style({ gap: '2px', minWidth: '0' }))(
          $node(style({ fontSize: text.sm }))($text('Version')),
          $node(style({ fontSize: text.xs, color: palette.foreground }))(
            $intermediateText(
              op(
                just(null),
                map(() =>
                  fetch('/changelog.json')
                    .then(response => {
                      if (!response.ok) throw new Error(`the release log could not be read (HTTP ${response.status})`)
                      return response.json()
                    })
                    .then(raw => {
                      const [top] = changelogOf(raw)
                      if (top === undefined) throw new Error('the release log lists no release')
                      return top.title
                    })
                )
              )
            )
          )
        ),
        $Link({ route: routeSchema.changelog, $content: $node(style({ fontSize: text.sm, whiteSpace: 'nowrap' }))($text('Release log')) })({})
      )
    ]

    const $tooltip: I$Node = op(
      combine({ status, matchmakerView }),
      map(p =>
        $column(spacing.default, style({ minWidth: '280px', maxWidth: '320px' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.base, color: palette.message }))($text('Connections')),
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))(
              $text('Your live status of the protocol operations.')
            )
          ),
          $column(spacing.default, style({ paddingTop: '8px', borderTop: `1px solid ${palette.horizon}` }))(
            $serviceLine('Chain', $text(p.status.chain.detail), p.status.chain.service),
            $serviceLine('Chronicle', $text(p.status.chronicle.detail), p.status.chronicle.service),
            $serviceLine('Attestor', $text(p.matchmakerView.detail), p.matchmakerView.service)
          ),
          ...$version
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
          $node(style({ color: palette.foreground, fontSize: text.sm }))($text('Connecting…')),
          ...$version
        )
      ),
      switchLatest
    )

    const color: IStream<string> = start(
      palette.foreground,
      map(health => serviceColor[health], worst)
    )
    const pulsing: IStream<boolean> = start(true, map(health => health !== 'ok', worst))

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
