const GRID_LINES = 10
const TIME_UNITS: { unit: 'year' | 'month' | 'day' | 'hour' | 'minute'; size: number; seconds: number }[] = [
  { unit: 'year', size: 1, seconds: 31_557_600 },
  { unit: 'month', size: 1, seconds: 2_629_800 },
  { unit: 'day', size: 1, seconds: 86_400 },
  ...[12, 6, 3, 1].map(size => ({ unit: 'hour' as const, size, seconds: size * 3600 })),
  ...[30, 5, 1].map(size => ({ unit: 'minute' as const, size, seconds: size * 60 }))
]

export const baselinePlot = (
  points: readonly { time: number; value: number | null }[],
  baseline: number,
  scaleFloor: number,
  w: number,
  h: number,
  margin: number
) => {
  const values = points.map(point => point.value)
  const deltas = values.flatMap(value => (value === null ? [] : [value - baseline]))
  const up = Math.max(0, ...deltas)
  const down = Math.max(0, ...deltas.map(delta => -delta))
  const total = up + down
  const range = Math.max(total, scaleFloor)
  const inner = h * (1 - 2 * margin)
  const base = total === 0 ? h / 2 : h * margin + (up / total) * inner
  const ys = values.map(value => (value === null ? null : range === 0 ? base : base - ((value - baseline) / range) * inner))
  const step = w / Math.max(ys.length - 1, 1)
  const lines = { up: '', zero: '', down: '' }
  let run: { side: 'up' | 'zero' | 'down'; vertices: string[]; x: number; y: number } | null = null
  const close = () => {
    if (run === null) return
    lines[run.side] += `M${run.vertices.join('L')}`
    run = null
  }
  for (let i = 0; i < ys.length - 1; i++) {
    const from = ys[i]
    const to = ys[i + 1]
    if (from == null || to == null) {
      close()
      continue
    }
    const x = i * step
    const cross = (from - base) * (to - base) < 0 ? x + ((base - from) / (to - from)) * step : null
    const parts: [number, number, number, number][] = cross === null ? [[x, from, x + step, to]] : [[x, from, cross, base], [cross, base, x + step, to]]
    for (const [x0, y0, x1, y1] of parts) {
      const side = y0 + y1 < 2 * base ? 'up' : y0 + y1 > 2 * base ? 'down' : 'zero'
      if (run === null || run.side !== side || run.x !== x0 || run.y !== y0) {
        close()
        run = { side, vertices: [`${x0.toFixed(2)},${y0.toFixed(2)}`], x: x0, y: y0 }
      }
      run.vertices.push(`${x1.toFixed(2)},${y1.toFixed(2)}`)
      run.x = x1
      run.y = y1
    }
  }
  close()
  const known = ys.flatMap(y => (y === null ? [] : [y]))
  const runsAt = (level: number, beyond: (y: number) => boolean): string => {
    let path = ''
    let open: number | null = null
    let shut = 0
    for (let i = 0; i < ys.length - 1; i++) {
      const from = ys[i]
      const to = ys[i + 1]
      if (from == null || to == null) continue
      const x = i * step
      const crossing = (level - from) / (to - from)
      const start = beyond(from) ? x : beyond(to) ? x + crossing * step : null
      const end = beyond(to) ? x + step : beyond(from) ? x + crossing * step : null
      if (start === null || end === null) continue
      if (open !== null && start > shut + 1e-9) {
        if (shut - open > 1e-9) path += `M${open.toFixed(2)},${level.toFixed(2)}H${shut.toFixed(2)}`
        open = null
      }
      if (open === null) open = start
      shut = end
    }
    if (open !== null && shut - open > 1e-9) path += `M${open.toFixed(2)},${level.toFixed(2)}H${shut.toFixed(2)}`
    return path
  }
  let upGrid = ''
  let downGrid = ''
  if (total > 0) {
    const reach = total / GRID_LINES
    const power = 10 ** Math.floor(Math.log10(reach))
    const nice = [1, 2, 5, 10].map(multiple => multiple * power).find(candidate => candidate >= reach)
    if (nice === undefined) throw new Error(`no grid step covers ${reach}`)
    const pitch = nice * (inner / range)
    for (let level = base - pitch; level >= Math.min(base, ...known); level -= pitch) upGrid += runsAt(level, y => y <= level)
    for (let level = base + pitch; level <= Math.max(base, ...known); level += pitch) downGrid += runsAt(level, y => y >= level)
  }
  const ticks: { time: number; x: number; unit: 'year' | 'month' | 'day' | 'hour' | 'minute' }[] = []
  const first = points[0]
  const last = points[points.length - 1]
  if (first !== undefined && last !== undefined && last.time > first.time) {
    const gap = (last.time - first.time) / GRID_LINES
    const finest = TIME_UNITS.findIndex(each => each.seconds <= gap)
    const units = finest === -1 ? TIME_UNITS : TIME_UNITS.slice(0, finest + 1)
    const every = units[units.length - 1]!
    const cursor = new Date(first.time * 1000)
    cursor.setSeconds(0, 0)
    if (every.unit === 'minute') cursor.setMinutes(Math.floor(cursor.getMinutes() / every.size) * every.size)
    else {
      cursor.setMinutes(0)
      if (every.unit === 'hour') cursor.setHours(Math.floor(cursor.getHours() / every.size) * every.size)
      else {
        cursor.setHours(0)
        if (every.unit !== 'day') cursor.setDate(1)
        if (every.unit === 'year') cursor.setMonth(0)
      }
    }
    const candidates: { time: number; weight: number }[] = []
    while (cursor.getTime() < last.time * 1000) {
      if (cursor.getTime() > first.time * 1000) {
        const weight = units.findIndex(each =>
          each.unit === 'minute'
            ? cursor.getMinutes() % each.size === 0
            : cursor.getMinutes() === 0 &&
              (each.unit === 'hour'
                ? cursor.getHours() % each.size === 0
                : cursor.getHours() === 0 && (each.unit === 'day' || (cursor.getDate() === 1 && (each.unit === 'month' || cursor.getMonth() === 0))))
        )
        candidates.push({ time: cursor.getTime() / 1000, weight })
      }
      if (every.unit === 'minute') cursor.setMinutes(cursor.getMinutes() + every.size)
      else if (every.unit === 'hour') cursor.setHours(cursor.getHours() + every.size)
      else if (every.unit === 'day') cursor.setDate(cursor.getDate() + 1)
      else if (every.unit === 'month') cursor.setMonth(cursor.getMonth() + 1)
      else cursor.setFullYear(cursor.getFullYear() + 1)
    }
    let marks: { time: number; weight: number }[] = []
    for (let weight = 0; weight < units.length; weight++) {
      const placed = marks
      marks = []
      let next = 0
      let left = -Infinity
      for (const candidate of candidates) {
        if (candidate.weight !== weight) continue
        while (next < placed.length && placed[next]!.time < candidate.time) {
          left = placed[next]!.time
          marks.push(placed[next++]!)
        }
        const right = next < placed.length ? placed[next]!.time : Infinity
        if (right - candidate.time >= gap && candidate.time - left >= gap) {
          marks.push(candidate)
          left = candidate.time
        }
      }
      marks.push(...placed.slice(next))
    }
    let i = 0
    for (const mark of marks) {
      while (points[i + 1]!.time <= mark.time) i++
      const at = (mark.time - points[i]!.time) / (points[i + 1]!.time - points[i]!.time)
      const x = (i + at) * step
      ticks.push({ time: mark.time, x, unit: units[mark.weight]!.unit })
      const from = ys[i]
      const to = ys[i + 1]
      if (from != null && to != null) {
        const y = from + (to - from) * at
        if (y < base) upGrid += `M${x.toFixed(2)},${base.toFixed(2)}V${y.toFixed(2)}`
        if (y > base) downGrid += `M${x.toFixed(2)},${base.toFixed(2)}V${y.toFixed(2)}`
      }
    }
  }
  return { ys, base, ticks, upGrid, downGrid, upLine: lines.up, zeroLine: lines.zero, downLine: lines.down }
}

