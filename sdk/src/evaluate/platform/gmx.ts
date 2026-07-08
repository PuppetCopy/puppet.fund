import { TOKEN_META } from '@puppet/contracts/const'
import { type Address, getAddress } from 'viem'
import { max } from '../../core/math.js'
import { MARKET_ADDRESS_DESCRIPTION_MAP } from '../../gmx/market.js'
import { getLeverageFactor, getPositionPnlUsd } from '../../gmx/position.js'
import { tokenMetaByAddress } from '../../state/tokenRegistry.js'
import { usdToBase } from '../precision.js'
import type {
  IGmxClaimableRow,
  IGmxOrderRow,
  IGmxPositionRow,
  INavPosition,
  IPlatformEvalParams,
  IPlatformEvaluator,
  IPlatformInFlight,
  IPlatformValuation,
  IPriceSource
} from '../types.js'

export type { IGmxClaimableRow, IGmxOrderRow, IGmxPositionRow } from '../types.js'

const PLATFORM = 'gmx'

export const GMX_ORDER_TYPE = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  StopIncrease: 8
} as const

export const GMX_INCREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

export const GMX_DECREASE_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketDecrease,
  GMX_ORDER_TYPE.LimitDecrease,
  GMX_ORDER_TYPE.StopLossDecrease
])

export const GMX_ORDER_CUSTODY_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.LimitSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.LimitIncrease,
  GMX_ORDER_TYPE.StopIncrease
])

export const GMX_ORDER_EXECUTING_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.MarketDecrease
])

// GMX denominates positions in USD; USDC is the dollar-proxy market we price every token against to convert
// those USD figures into base-token wei (see usdToBase). A token with no <token>/USDC market simply has no
// entry and degrades to its stored pnl.
const USD_PROXY = TOKEN_META.USDC.symbol

const MARKET_INDEX_MAP = MARKET_ADDRESS_DESCRIPTION_MAP as Record<string, { indexToken?: Address } | undefined>

export function resolveIndexToken(market: Address): Address | undefined {
  return MARKET_INDEX_MAP[getAddress(market)]?.indexToken
}

export type IGmxPriceMap = Map<Address, IPriceSource>

export function gmxTokensToPrice(
  rows: IGmxPositionRow[],
  orders: IGmxOrderRow[],
  claimables: IGmxClaimableRow[],
  baseToken: Address
): Address[] {
  const tokens = new Set<Address>([getAddress(baseToken)])
  for (const r of rows) {
    const indexToken = resolveIndexToken(r.market)
    if (indexToken) tokens.add(getAddress(indexToken))
    tokens.add(getAddress(r.collateralToken))
  }
  for (const o of orders) {
    if (GMX_ORDER_CUSTODY_TYPES.has(o.orderType)) tokens.add(getAddress(o.collateralToken))
  }
  for (const c of claimables) tokens.add(getAddress(c.token))
  return [...tokens]
}

function tokenAmountToUsd(amount: bigint, priceByToken: IGmxPriceMap, token: Address): bigint | null {
  const entry = priceByToken.get(getAddress(token))
  if (!entry || entry.price === 0n) return null
  return amount * entry.price
}

export function valueGmxPositions(
  rows: IGmxPositionRow[],
  orders: IGmxOrderRow[],
  claimables: IGmxClaimableRow[],
  priceByToken: IGmxPriceMap,
  baseToken: Address,
  nowSec: number
): IPlatformValuation {
  if (rows.length === 0 && orders.length === 0 && claimables.length === 0)
    return { platform: PLATFORM, positions: [], inFlight: [], available: true }

  const baseEntry = priceByToken.get(getAddress(baseToken))
  if (!baseEntry || baseEntry.price === 0n) {
    return {
      platform: PLATFORM,
      positions: [],
      inFlight: [],
      available: false,
      unavailableReason: 'no GMX oracle price for base token'
    }
  }
  const basePrice = baseEntry.price
  const baseAgeSec = Math.max(0, nowSec - baseEntry.time)

  const positions: INavPosition[] = rows.map(row => {
    const indexToken = resolveIndexToken(row.market)
    const indexEntry = indexToken ? priceByToken.get(indexToken) : undefined
    const indexPrice = indexEntry ? indexEntry.price : 0n
    const indexAgeSec = indexEntry ? nowSec - indexEntry.time : 0
    const canRevalue = indexEntry !== undefined && indexPrice > 0n && indexToken !== undefined
    const pnlUsd = canRevalue
      ? getPositionPnlUsd(row.isLong, row.sizeInUsd, row.sizeInTokens, indexPrice)
      : row.storedPnlUsd
    const collateralBase = usdToBase(row.collateralUsd, basePrice)
    const pnlBase = usdToBase(pnlUsd, basePrice)
    return {
      platform: PLATFORM,
      positionKey: row.positionKey,
      market: row.market,
      collateralBase,
      pnlBase,
      netBase: max(0n, collateralBase + pnlBase),
      priceAgeSec: canRevalue ? Math.max(baseAgeSec, indexAgeSec) : undefined,
      facets: {
        side: row.isLong ? 'long' : 'short',
        sizeUsd: row.sizeInUsd,
        leverageBps: getLeverageFactor(row.sizeInUsd, row.collateralUsd, pnlUsd, 0n, 0n)
      }
    }
  })
  const inFlight: IPlatformInFlight[] = []
  for (const o of orders) {
    if (GMX_ORDER_CUSTODY_TYPES.has(o.orderType) && o.collateralDeltaAmount > 0n) {
      const custodyUsd = tokenAmountToUsd(o.collateralDeltaAmount, priceByToken, o.collateralToken)
      if (custodyUsd === null) {
        return {
          platform: PLATFORM,
          positions: [],
          inFlight: [],
          available: false,
          unavailableReason: `no oracle price for resting order collateral ${o.collateralToken}`
        }
      }
      const collateralBase = usdToBase(custodyUsd, basePrice)
      positions.push({
        platform: PLATFORM,
        positionKey: o.orderKey,
        market: o.market,
        collateralBase,
        pnlBase: 0n,
        netBase: collateralBase,
        priceAgeSec: baseAgeSec,
        facets: { kind: 'resting-order', orderType: o.orderType, side: o.isLong ? 'long' : 'short' }
      })
    }
    if (GMX_ORDER_EXECUTING_TYPES.has(o.orderType)) {
      inFlight.push({
        platform: PLATFORM,
        kind: 'order',
        ref: o.orderKey,
        detail: `market order type ${o.orderType} pending keeper execution`
      })
    }
  }
  for (const c of claimables) {
    if (c.amount === 0n) continue
    const claimUsd = tokenAmountToUsd(c.amount, priceByToken, c.token)
    if (claimUsd === null) {
      return {
        platform: PLATFORM,
        positions: [],
        inFlight: [],
        available: false,
        unavailableReason: `no oracle price for claimable funding token ${c.token}`
      }
    }
    const collateralBase = usdToBase(claimUsd, basePrice)
    positions.push({
      platform: PLATFORM,
      positionKey: `${getAddress(c.market)}${getAddress(c.token).slice(2)}` as `0x${string}`,
      market: c.market,
      collateralBase,
      pnlBase: 0n,
      netBase: collateralBase,
      priceAgeSec: baseAgeSec,
      facets: { kind: 'claimable-funding', token: c.token }
    })
  }
  return { platform: PLATFORM, positions, inFlight, available: true }
}

export const gmxEvaluator: IPlatformEvaluator = {
  platform: PLATFORM,
  async evaluate({
    baseToken,
    nowSec,
    getRate,
    positions,
    orders,
    claimables
  }: IPlatformEvalParams): Promise<IPlatformValuation> {
    if (positions.length === 0 && orders.length === 0 && claimables.length === 0)
      return { platform: PLATFORM, positions: [], inFlight: [], available: true }

    // Price every distinct token (base + per-market index + collateral) against the USD-proxy market in
    // parallel; token0 is that token's per-wei price in USD-scale. A token with no direct <token>/USDC market
    // fails closed in getRate and is simply omitted, so valueGmxPositions sees no entry and degrades it (the
    // base token missing => the platform reports unavailable; an index token missing => stored pnl).
    const priceByToken: IGmxPriceMap = new Map()
    await Promise.all(
      gmxTokensToPrice(positions, orders, claimables, baseToken).map(async token => {
        // Resolve the token ADDRESS to its asset symbol for the rate API; a GMX index token that isn't a registered
        // base (e.g. a synthetic market) has no entry, so it's simply omitted (same as the unpriceable-pair degrade).
        const asset = tokenMetaByAddress.get(getAddress(token))?.symbol
        if (!asset) return
        const rate = await getRate(asset, USD_PROXY).catch(() => null)
        if (rate) priceByToken.set(getAddress(token), { price: rate.token0, time: rate.time })
      })
    )

    return valueGmxPositions(positions, orders, claimables, priceByToken, getAddress(baseToken), nowSec)
  }
}
