export enum IntervalTime {
  SEC = 1,
  MIN = 60,
  MIN5 = 300,
  MIN15 = 900,
  MIN30 = 1800,
  HR = 3600,
  HR2 = 7200,
  HR4 = 14400,
  HR6 = 21600,
  HR8 = 28800,
  HR12 = 43200,
  DAY = 86400,
  WEEK = 604800,
  MONTH = 2628000,
  QUARTER = 7884000,
  YEAR = 31536000
}

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000' as const

export const USD_DECIMALS = 30

export const PLATFORM_STAT_INTERVAL = [
  IntervalTime.DAY,
  IntervalTime.WEEK,
  IntervalTime.MONTH,
  IntervalTime.QUARTER,
  IntervalTime.YEAR
] as const

export const DEFAULT_DEADLINE_SEC = IntervalTime.MIN5
