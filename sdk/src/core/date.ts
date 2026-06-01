import { IntervalTime } from '../const/common.js'
import { getUnixTimestamp } from './utils.js'

export declare type Nominal<T, Name extends string> = T & {
  [Symbol.species]: Name
}

export type UTCTimestamp = Nominal<number, 'UTCTimestamp'>

export const tzOffset = new Date().getTimezoneOffset() * 60000

export function timeTzOffset(ms: number): UTCTimestamp {
  return Math.floor(ms - tzOffset) as UTCTimestamp
}

export function unixTimeTzOffset(ms: number): UTCTimestamp {
  return ms as UTCTimestamp
}

export const readableDate = (timestamp: number, intlOptions: Intl.DateTimeFormatOptions = { dateStyle: 'short' }) =>
  new Date(timestamp * 1000).toLocaleDateString(undefined, intlOptions)

export const displayDate = (unixTime: number | bigint) => {
  return `${new Date(Number(unixTime) * 1000).toDateString()} ${new Date(Number(unixTime) * 1000).toLocaleTimeString()}`
}

export function countdownFn(targetDate: number | bigint, now: number | bigint) {
  const distance = Number(targetDate) - Number(now)

  const days = Math.floor(distance / (60 * 60 * 24))
  const hours = Math.floor((distance % (60 * 60 * 24)) / (60 * 60))
  const minutes = Math.floor((distance % (60 * 60)) / 60)
  const seconds = Math.floor(distance % 60)

  return `${days ? `${days}d ` : ''} ${hours ? `${hours}h ` : ''} ${minutes ? `${minutes}m ` : ''} ${seconds ? `${seconds}s ` : ''}`
}

const intervals = [
  { label: 'year', seconds: IntervalTime.MONTH * 12 },
  { label: 'month', seconds: IntervalTime.MONTH },
  { label: 'day', seconds: IntervalTime.DAY },
  { label: 'hr', seconds: IntervalTime.HR },
  { label: 'min', seconds: IntervalTime.MIN },
  { label: 'sec', seconds: IntervalTime.SEC }
] as const

export function getDuration(time: number | bigint, threshold = IntervalTime.MONTH, none = 'None') {
  let remainingTime = Number(time)
  let durationString = ''

  for (const interval of intervals) {
    if (interval.seconds <= remainingTime) {
      const count = Math.floor(remainingTime / interval.seconds)
      remainingTime -= count * interval.seconds
      durationString += `${count} ${interval.label}${count !== 1 ? 's' : ''} `

      // Stop if remaining time is below the threshold
      if (remainingTime < threshold) {
        break
      }
    }
  }

  return durationString.trim() || none
}

export function getTimeAgo(time: number, suffix = 'ago') {
  const timeDelta = getUnixTimestamp() - time
  const interval = intervals.find(i => i.seconds < timeDelta)

  if (!interval) {
    return 'now'
  }

  const count = Math.floor(timeDelta / interval.seconds)
  return `${count} ${interval.label}${count !== 1 ? 's' : ''} ${suffix}`
}

export function getIntervalBasedOnTimeframe(maxColumns: number, from: number, to: number) {
  const delta = to - from

  const interval =
    maxColumns < delta / IntervalTime.WEEK
      ? IntervalTime.WEEK
      : maxColumns < delta / IntervalTime.DAY
        ? IntervalTime.DAY
        : maxColumns < delta / IntervalTime.HR4
          ? IntervalTime.HR4
          : maxColumns < delta / IntervalTime.HR
            ? IntervalTime.HR
            : maxColumns < delta / IntervalTime.MIN15
              ? IntervalTime.MIN15
              : IntervalTime.MIN5

  return interval
}
