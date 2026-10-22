import { baselinePlot } from '@puppet/sdk/ui-components'
import { combine, constant, empty, filter, filterNull, type IStream, map, merge, op, skipRepeatsWith, start, switchLatest } from 'aelea/stream'
import { type IBehavior, PromiseStatus, type PromiseStateDone, state } from 'aelea/stream-extended'
import { $node, $svg, $text, attr, attrBehavior, component, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { observer } from 'aelea/ui-components'
import { palette, text } from 'aelea/ui-components-theme'
import { intermediateState } from './$IntermediateDisplay.js'

export interface I$Baseline {
  series: IStream<readonly { time: number; value: number | null }[]>
  baseline: number
  scaleFloor: number
  margin: number
  headroom: string
  lineWidth: number
  tip: boolean
  axis: 'always' | 'hover' | null
  under: string | null
  fadeCenter?: IStream<number>
  events?: IStream<Promise<readonly { time: number; label: string }[]>>
}

const CENTER_FADE_PX = 24
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric' })
const shortMonthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })
const yearFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric' })
const UNIT_ORDER = ['year', 'month', 'day', 'hour', 'minute']
const $dot = $node(
  style({ position: 'absolute', display: 'none', width: '8px', height: '8px', borderRadius: '50%', background: palette.message, boxShadow: `0 0 0 2px ${palette.background}`, transform: 'translate(-50%, -50%)' })
)
const $mark = $node(
  style({ position: 'absolute', width: '9px', height: '9px', borderRadius: '50%', background: palette.message, opacity: '0.5', transform: 'translate(-50%, -50%)' })
)
const $speck = $node(
  style({ position: 'absolute', width: '5px', height: '5px', borderRadius: '50%', background: palette.message, opacity: '0.8', transform: 'translate(-50%, -50%)' })
)

export const $Baseline = ({ series, baseline, scaleFloor, margin, headroom, lineWidth, tip, axis, under, fadeCenter, events }: I$Baseline) =>
  component(([pointer, pointerTether]: IBehavior<INode<HTMLElement>, number | null>, [axisBox, axisBoxTether]: IBehavior<INode<HTMLElement>, { width: number; size: string; family: string }>) => {
    const plot = op(
      series,
      map(points => {
        const span = Math.max(points.length - 1, 1)
        const geometry = baselinePlot(points, baseline, scaleFloor, span, 100, margin)
        const heaviest = Math.min(...geometry.ticks.map(tick => UNIT_ORDER.indexOf(tick.unit)))
        let area = ''
        let edge: number | null = null
        for (const [x, y] of geometry.ys.entries()) {
          if (y === null) {
            if (edge !== null) area += `L${edge},10000Z`
            edge = null
          } else {
            area += edge === null ? `M${x},10000L${x},${y.toFixed(2)}` : `L${x},${y.toFixed(2)}`
            edge = x
          }
        }
        if (edge !== null) area += `L${edge},10000Z`
        return {
          points,
          span,
          area,
          ...geometry,
          marks: geometry.ticks.map(tick => ({
            share: tick.x / span,
            strong: UNIT_ORDER.indexOf(tick.unit) === heaviest,
            label: (tick.unit === 'year' ? yearFormat : tick.unit === 'month' ? shortMonthFormat : tick.unit === 'day' ? dateFormat : clockFormat).format(new Date(tick.time * 1000))
          })),
          mask: {
            maskImage: `linear-gradient(to bottom, rgb(0 0 0 / 0.35) calc(${geometry.base}% - 400px), #000 calc(${geometry.base}% - 40px), #000 calc(${geometry.base}% + 40px), rgb(0 0 0 / 0.35) calc(${geometry.base}% + 400px)), linear-gradient(to bottom, rgb(0 0 0 / 0.3), rgb(0 0 0 / 0.03) ${geometry.base}%, rgb(0 0 0 / 0.3))`
          }
        }
      }),
      state()
    )
    const measure = axis === null ? null : document.createElement('canvas').getContext('2d')
    const labels = op(
      combine({ plot, box: axisBox }),
      map(p => {
        if (measure === null) throw new Error('the chart axis has no 2d canvas to measure its labels')
        const widthOf = (label: string, strong: boolean): number => {
          measure.font = `${strong ? 700 : 400} ${p.box.size} ${p.box.family}`
          return measure.measureText(label).width
        }
        const gap = widthOf('  ', false)
        const kept: { at: number; strong: boolean; label: string }[] = []
        let reach = Number.NEGATIVE_INFINITY
        for (const mark of p.plot.marks) {
          const half = widthOf(mark.label, mark.strong) / 2
          const at = Math.min(Math.max(mark.share * p.box.width, half), p.box.width - half)
          if (at - half < reach + gap) continue
          kept.push({ at, strong: mark.strong, label: mark.label })
          reach = at + half
        }
        return kept
      })
    )
    const hovered = op(
      combine({ plot, at: start(null, pointer) }),
      map(p => (p.at === null || p.plot.points.length === 0 ? null : { plot: p.plot, index: Math.round(p.at * (p.plot.points.length - 1)) })),
      skipRepeatsWith((a, b) => (a === null || b === null ? a === b : a.plot === b.plot && a.index === b.index)),
      state()
    )
    const eventList: IStream<readonly { time: number; label: string }[]> =
      events === undefined
        ? empty
        : op(
            intermediateState(events),
            filter((s): s is PromiseStateDone<readonly { time: number; label: string }[]> => s.status === PromiseStatus.DONE),
            map(s => s.value)
          )
    const pins = op(
      combine({ plot, list: eventList }),
      map(p => {
        const first = p.plot.points[0]
        const last = p.plot.points[p.plot.points.length - 1]
        if (first === undefined || last === undefined) return []
        const placed = new Map<number, string[]>()
        for (const event of p.list) {
          if (event.time < first.time || event.time > last.time) continue
          const index = p.plot.points.findIndex(point => point.time >= event.time)
          if (p.plot.ys[index] == null) continue
          placed.set(index, [...(placed.get(index) ?? []), event.label])
        }
        return [...placed].map(([index, labels]) => ({ index, labels, left: (index / p.plot.span) * 100, top: p.plot.ys[index]! }))
      }),
      state()
    )
    const $plane = $svg('svg')(
      attr({ preserveAspectRatio: 'none' }),
      attrBehavior(map(p => ({ viewBox: `0 0 ${p.span} 100` }), plot)),
      style({ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' })
    )
    const $gridLine = $svg('path')(attr({ fill: 'none', 'vector-effect': 'non-scaling-stroke', 'shape-rendering': 'crispEdges' }), style({ strokeWidth: 'var(--hairline)' }))
    const $stroke = $svg('path')(attr({ fill: 'none', 'stroke-width': String(lineWidth), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }))

    return [
      $node(
        style({ position: 'relative', width: '100%', height: '100%', touchAction: 'pan-y', contain: 'layout style' }),
        pointerTether(
          $root => merge(nodeEvent('pointerdown', $root), nodeEvent('pointermove', $root)),
          map(event => {
            const target = event.currentTarget
            if (!(target instanceof Element)) throw new Error('a chart pointer event lost its element')
            const box = target.getBoundingClientRect()
            return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
          })
        ),
        pointerTether($root => merge(nodeEvent('pointerleave', $root), nodeEvent('pointercancel', $root)), constant(null))
      )(
        ...(under === null
          ? []
          : [
              $node(style({ position: 'absolute', top: headroom, left: 0, right: 0, bottom: axis === null ? 0 : '22px', overflow: 'hidden', pointerEvents: 'none' }))(
                $node(style({ position: 'absolute', top: 0, left: 0, right: 0, bottom: axis === null ? 0 : '2px' }))(
                  $plane($svg('path')(style({ fill: under, stroke: 'none' }), attrBehavior(map(p => ({ d: p.area }), plot)))())
                )
              )
            ]),
        $node(
          style({ position: 'absolute', display: 'none', top: 0, bottom: axis === null ? 0 : '22px', borderLeft: `1px dotted ${palette.foreground}`, pointerEvents: 'none' }),
          styleBehavior(map(h => (h === null ? null : { display: 'block', left: `${(h.index / h.plot.span) * 100}%` }), hovered))
        )(),
        $node(
          style({ position: 'absolute', top: headroom, left: 0, right: 0, bottom: axis === null ? 0 : '24px', pointerEvents: 'none' }),
          ...(fadeCenter === undefined
            ? []
            : [
                style({
                  maskImage: `linear-gradient(black, black), linear-gradient(to right, transparent 0, black ${CENTER_FADE_PX}px, black calc(100% - ${CENTER_FADE_PX}px), transparent 100%)`,
                  maskComposite: 'subtract',
                  maskRepeat: 'no-repeat',
                  maskPosition: '0 0, 50% 0',
                  transition: 'mask-size 200ms ease-out'
                }),
                styleBehavior(map(p => ({ maskSize: `100% 100%, ${p.h === null ? p.clear + 2 * CENTER_FADE_PX : 0}px 100%` }), combine({ clear: fadeCenter, h: hovered })))
              ])
        )(
          $plane(style({ maskRepeat: 'no-repeat, no-repeat', maskComposite: 'intersect' }), styleBehavior(map(p => p.mask, plot)))(
            $gridLine(style({ stroke: palette.positive }), attrBehavior(map(p => ({ d: p.upGrid }), plot)))(),
            $gridLine(style({ stroke: palette.negative }), attrBehavior(map(p => ({ d: p.downGrid }), plot)))()
          ),
          $plane(
            $stroke(style({ stroke: palette.positive }), attrBehavior(map(p => ({ d: p.upLine }), plot)))(),
            $stroke(style({ stroke: palette.foreground, strokeWidth: '1px', opacity: '0.6' }), attrBehavior(map(p => ({ d: p.zeroLine }), plot)))(),
            $stroke(style({ stroke: palette.negative }), attrBehavior(map(p => ({ d: p.downLine }), plot)))()
          ),
          switchLatest(map(list => $node(style({ position: 'absolute', inset: 0 }))(...list.map(pin => (axis === null ? $speck : $mark)(style({ left: `${pin.left}%`, top: `${pin.top}%` }))())), pins)),
          tip
            ? $dot(
                styleBehavior(
                  map(p => {
                    const y = p.ys[p.ys.length - 1]
                    return y == null ? null : { display: 'block', left: `${((p.ys.length - 1) / p.span) * 100}%`, top: `${y}%` }
                  }, plot)
                )
              )()
            : empty,
          $dot(
            styleBehavior(
              map(h => {
                if (h === null) return null
                const y = h.plot.ys[h.index]
                return y == null
                  ? null
                  : { display: 'block', left: `${(h.index / h.plot.span) * 100}%`, top: `${y}%`, background: y < h.plot.base ? palette.positive : y > h.plot.base ? palette.negative : palette.foreground }
              }, hovered)
            )
          )(),
          axis === null
            ? empty
            : switchLatest(
                map(
                  near => {
                    if (near === null) return empty
                    const below = near.top < 25
                    return $node(style({ position: 'absolute', left: `${near.left}%`, top: `${near.top}%`, width: '0', height: '0' }))(
                      $node(style({ position: 'absolute', left: '-0.5px', width: '1px', height: '20px', background: palette.foreground, ...(below ? { top: '5px' } : { bottom: '5px' }) }))(),
                      $node(
                        style({
                          position: 'absolute',
                          left: '0',
                          transform: `translateX(-${near.left}%)`,
                          whiteSpace: 'nowrap',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: palette.horizon,
                          color: palette.message,
                          fontSize: text.xs,
                          ...(below ? { top: '25px' } : { bottom: '25px' })
                        })
                      )($text(near.labels.join(' · ')))
                    )
                  },
                  op(
                    combine({ h: hovered, list: pins }),
                    map(p => {
                      if (p.h === null) return null
                      const at = p.h.index
                      const reach = Math.max(1, Math.round(p.h.plot.span / 100))
                      return p.list.filter(pin => Math.abs(pin.index - at) <= reach).sort((a, b) => Math.abs(a.index - at) - Math.abs(b.index - at))[0] ?? null
                    }),
                    skipRepeatsWith((a, b) => a === b)
                  )
                )
              )
        ),
        axis !== null
          ? $node(
              style({ position: 'absolute', left: 0, right: 0, bottom: 0, height: '22px', lineHeight: '22px', fontSize: text.xs, color: palette.foreground, whiteSpace: 'nowrap', pointerEvents: 'none', ...(under === null ? {} : { background: under }) }),
              axisBoxTether(
                observer.resize(),
                map(entries => {
                  const entry = entries[0]
                  if (entry === undefined) throw new Error('a chart axis resize carried no entry')
                  const font = getComputedStyle(entry.target)
                  return { width: entry.contentRect.width, size: font.fontSize, family: font.fontFamily }
                }),
                skipRepeatsWith((a, b) => a.width === b.width && a.size === b.size && a.family === b.family)
              )
            )(
              $node(
                style({ position: 'absolute', inset: 0, transition: 'opacity 120ms ease-out' }),
                ...(axis === 'hover' ? [styleBehavior(map(h => (h === null ? { opacity: '0' } : null), hovered))] : [])
              )(
                switchLatest(
                  map(
                    list =>
                      $node(style({ position: 'absolute', inset: 0 }))(
                        ...list.map(tick => $node(style({ position: 'absolute', left: `${tick.at}px`, transform: 'translateX(-50%)', ...(tick.strong ? { fontWeight: '700', color: palette.message } : {}) }))($text(tick.label)))
                      ),
                    labels
                  )
                )
              ),
              $node(
                style({ position: 'absolute', display: 'none', top: 0, padding: '0 6px', borderRadius: '4px', background: palette.horizon, color: palette.message }),
                styleBehavior(
                  map(h => {
                    if (h === null) return null
                    const share = (h.index / h.plot.span) * 100
                    return { display: 'block', left: `${share}%`, transform: `translateX(-${share}%)` }
                  }, hovered)
                )
              )(
                $text(
                  op(
                    hovered,
                    filterNull,
                    map(h => {
                      const date = new Date(h.plot.points[h.index]!.time * 1000)
                      return `${String(date.getDate()).padStart(2, '0')} ${shortMonthFormat.format(date)} '${String(date.getFullYear()).slice(2)} ${clockFormat.format(date)}`
                    })
                  )
                )
              )
            )
          : empty
      ),
      { hover: map(h => (h === null ? null : h.plot.points[h.index]!), hovered) }
    ]
  })
