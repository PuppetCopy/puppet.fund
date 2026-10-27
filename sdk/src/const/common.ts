import { PROTOCOL } from '@puppet/contracts/const'

export const IntervalTime = {
  SEC: 1,
  MIN: 60,
  MIN5: 300,
  MIN15: 900,
  MIN30: 1800,
  HR: 3600,
  HR2: 7200,
  HR4: 14400,
  HR6: 21600,
  HR8: 28800,
  HR12: 43200,
  DAY: 86400,
  WEEK: 604800,
  MONTH: 2628000,
  QUARTER: 7884000,
  YEAR: 31536000
} as const
export type IntervalTime = (typeof IntervalTime)[keyof typeof IntervalTime]

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000' as const
export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const

export const USD_DECIMALS = 30
export const CROSS_CHAIN_MIN_USD = 1n
export const USD_SYMBOL = 'USD'

export const PRECISION = {
  basisPoints: 10_000n,
  floatPrecisionExp: 10n ** 30n
} as const

export const PLATFORM_STAT_INTERVAL = [
  IntervalTime.DAY,
  IntervalTime.WEEK,
  IntervalTime.MONTH,
  IntervalTime.QUARTER,
  IntervalTime.YEAR
] as const

export const DEFAULT_DEADLINE_SEC = Number(PROTOCOL.maxIntentTtlSec) / 2

export const PRICED_DEADLINE_SEC = IntervalTime.MIN

export const VENUE_READ_STALE_SEC = IntervalTime.HR
