import { IntervalTime } from '../const/common.js'

export const readableDate = (timestamp: number, intlOptions: Intl.DateTimeFormatOptions = { dateStyle: 'short' }) =>
  new Date(timestamp * 1000).toLocaleString(undefined, intlOptions)

const intervals = [
  { label: 'year', seconds: IntervalTime.MONTH * 12 },
  { label: 'month', seconds: IntervalTime.MONTH },
  { label: 'day', seconds: IntervalTime.DAY },
  { label: 'hr', seconds: IntervalTime.HR },
  { label: 'min', seconds: IntervalTime.MIN },
  { label: 'sec', seconds: IntervalTime.SEC }
] as const

export function getDuration(time: number | bigint, threshold: number = IntervalTime.MONTH, none = 'None') {
  let remainingTime = Number(time)
  let durationString = ''

  for (const interval of intervals) {
    if (interval.seconds <= remainingTime) {
      const count = Math.floor(remainingTime / interval.seconds)
      remainingTime -= count * interval.seconds
      durationString += `${count} ${interval.label}${count !== 1 ? 's' : ''} `

      if (remainingTime < threshold) {
        break
      }
    }
  }

  return durationString.trim() || none
}
