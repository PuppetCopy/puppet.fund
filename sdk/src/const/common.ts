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
  DAY = 86400,
  WEEK = 604800,
  MONTH = 2628000,
  QUARTER = 7884000,
  YEAR = 31536000
}

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000' as const
export const BYTES32_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000' as const
export const BYTES32_ONE = '0x0000000000000000000000000000000000000000000000000000000000000001' as const

export const USD_DECIMALS = 30
export const WEI_PRECISION = 10n ** BigInt(18)
export const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n

export const FUNDING_RATE_PRECISION = 1000000n

export const PLATFORM_STAT_INTERVAL = [
  IntervalTime.DAY,
  IntervalTime.WEEK,
  IntervalTime.MONTH,
  IntervalTime.QUARTER,
  IntervalTime.YEAR
] as const

export const BALANCE_TIMELINE_BUCKETS = 200

export const DEFAULT_DEADLINE_SEC = IntervalTime.MIN5

// Editors tolerate live network fees within this fraction above the saved
// `acceptableRelayFee` before surfacing a "fee has risen" alert. Below this
// margin, dust-level RPC ticks would otherwise spuriously trip the alert.
export const RELAY_FEE_TOLERANCE_BPS = 1000n // 10%

export const PRICEFEED_INTERVAL_LIST = [
  IntervalTime.MIN5,
  IntervalTime.MIN15,
  IntervalTime.HR,
  IntervalTime.HR6,
  IntervalTime.DAY,
  IntervalTime.WEEK,
  IntervalTime.MONTH
] as const
