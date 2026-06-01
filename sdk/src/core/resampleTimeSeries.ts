export type TimelineItem<T> = {
  time: number
  slot: number
  value: T
}

export interface IResampleTimeSeries<TSource, TMap, TResult extends TimelineItem<TMap>> {
  ticks?: number
  lastTime?: number
  sourceList: TSource[]

  getTime: (t: TSource) => number
  sourceMap: (next: TSource, timeslot: number) => TMap
  gapMap?: (next: TResult, timeslot: number) => TResult
  squashMap?: (conflict: TResult, next: TSource, timeslot: number) => TMap
}

export function resampleTimeSeries<TSource, TMap, TResult extends TimelineItem<TMap>>(
  config: IResampleTimeSeries<TSource, TMap, TResult>
): TResult[] {
  const {
    ticks = 30,
    sourceList,
    sourceMap,
    gapMap = prev => prev,
    squashMap = (_prev, next, timeslot) => sourceMap(next, timeslot),
    getTime
  } = config

  if (sourceList.length === 0) {
    return []
  }

  const initialTime = getTime(sourceList[0])
  const lastTime = getTime(sourceList[sourceList.length - 1])
  const interval = Math.max(1, Math.floor((lastTime - initialTime) / ticks))

  const seedSlot = Math.floor(initialTime / interval)
  const seedTimeSlot = seedSlot * interval
  const seedMap = { time: seedTimeSlot, slot: seedSlot, value: sourceMap(sourceList[0], seedTimeSlot) } as TResult
  const timelineMap: { [k: number]: TResult } = {}

  timelineMap[seedSlot] = seedMap

  let prev = seedMap
  for (let i = 1; i < sourceList.length; i++) {
    const source = sourceList[i]
    const sourceTime = getTime(sourceList[i])

    if (getTime(sourceList[i - 1]) > sourceTime) {
      throw new Error('source has to be sorted')
    }

    const timeSlot = Math.floor(sourceTime / interval)
    const squashPrev = timelineMap[timeSlot]

    if (squashPrev) {
      const item = {
        time: squashPrev.time,
        slot: timeSlot,
        value: squashMap(squashPrev, source, timeSlot)
      } as TResult

      timelineMap[timeSlot] = item
      prev = item
      continue
    }

    const gapSpan = timeSlot - prev.slot
    for (let gap = 1; gap < gapSpan; gap++) {
      const gapTimeSlot = prev.slot + gap

      if (timelineMap[gapTimeSlot]) {
        throw new Error('Gap time slot conlides with existing time slot')
      }

      const gapTimeslot = gapTimeSlot * interval
      timelineMap[gapTimeSlot] = {
        time: gapTimeslot,
        slot: gapTimeSlot,
        value: gapMap(prev, gapTimeSlot).value
      } as TResult
    }

    const item = { time: timeSlot * interval, slot: timeSlot, value: sourceMap(source, timeSlot) } as TResult

    timelineMap[timeSlot] = item
    prev = item
  }

  return Object.values(timelineMap)
}
