import { TOKEN_META } from '@puppet/contracts/const'
import type { Address, } from 'viem'
import type { ChainId } from '../../const/index.js'
import { max } from '../../core/math.js'
import { GMX_V2_CHAIN_ID, MARKET_ADDRESS_DESCRIPTION_MAP } from '../../gmx/market.js'
import { getLeverageFactor, getPositionPnlUsd } from '../../gmx/position.js'
import { type ITokenMetaKey, tokenMetaByChainToken, tokenMetaKey } from '../../state/tokenRegistry.js'
import { usdPriceFromRate, usdToBase } from '../precision.js'
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

const GMX_ORDER_EXECUTING_TYPES: ReadonlySet<number> = new Set([
  GMX_ORDER_TYPE.MarketSwap,
  GMX_ORDER_TYPE.MarketIncrease,
  GMX_ORDER_TYPE.MarketDecrease
])

const USD_PROXY = TOKEN_META.USDC.symbol

const MARKET_INDEX_MAP = MARKET_ADDRESS_DESCRIPTION_MAP as Record<string, { indexToken?: Address } | undefined>

export function resolveIndexToken(market: Address): Address | undefined {
  return MARKET_INDEX_MAP[market]?.indexToken
}

export type IGmxPriceMap = Map<ITokenMetaKey, IPriceSource>

function gmxTokensToPrice(
  rows: IGmxPositionRow[],
  orders: IGmxOrderRow[],
  claimables: IGmxClaimableRow[],
  baseToken: Address
): Address[] {
  const tokens = new Set<Address>([baseToken])
  for (const r of rows) {
    const indexToken = resolveIndexToken(r.market)
    if (indexToken) tokens.add(indexToken)
    tokens.add(r.collateralToken)
  }
  for (const o of orders) {
    if (GMX_ORDER_CUSTODY_TYPES.has(o.orderType)) tokens.add(o.collateralToken)
  }
  for (const c of claimables) tokens.add(c.token)
  return [...tokens]
}

function tokenAmountToUsd(priceByToken: IGmxPriceMap, chainId: ChainId, token: Address, amount: bigint): bigint | null {
  const entry = priceByToken.get(tokenMetaKey(chainId, token))
  if (!entry || entry.price === 0n) return null
  return amount * entry.price
}

function valueGmxPositions(
  chainId: ChainId,
  rows: IGmxPositionRow[],
  orders: IGmxOrderRow[],
  claimables: IGmxClaimableRow[],
  priceByToken: IGmxPriceMap,
  baseToken: Address,
  nowSec: number
): IPlatformValuation {
  if (rows.length === 0 && orders.length === 0 && claimables.length === 0)
    return { platform: PLATFORM, positions: [], inFlight: [], available: true }

  const baseEntry = priceByToken.get(tokenMetaKey(chainId, baseToken))
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
    const indexEntry = indexToken ? priceByToken.get(tokenMetaKey(chainId, indexToken)) : undefined
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
      const custodyUsd = tokenAmountToUsd(priceByToken, chainId, o.collateralToken, o.collateralDeltaAmount)
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
        ref: o.orderKey,
        detail: `market order type ${o.orderType} pending keeper execution`
      })
    }
  }
  for (const c of claimables) {
    if (c.amount === 0n) continue
    const claimUsd = tokenAmountToUsd(priceByToken, chainId, c.token, c.amount)
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
      positionKey: `${c.market}${c.token.slice(2)}` as `0x${string}`,
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
  chainId: GMX_V2_CHAIN_ID,
  async evaluate({
    chainId,
    baseToken,
    nowSec,
    getRate,
    positions,
    orders,
    claimables
  }: IPlatformEvalParams): Promise<IPlatformValuation> {
    if (positions.length === 0 && orders.length === 0 && claimables.length === 0)
      return { platform: PLATFORM, positions: [], inFlight: [], available: true }

    const priceByToken: IGmxPriceMap = new Map()
    await Promise.all(
      gmxTokensToPrice(positions, orders, claimables, baseToken).map(async token => {
        const key = tokenMetaKey(chainId, token)
        const meta = tokenMetaByChainToken.get(key)
        if (!meta) return
        const rate = await getRate(meta.symbol, USD_PROXY).catch(() => null)
        if (rate) priceByToken.set(key, { price: usdPriceFromRate(rate, TOKEN_META.USDC.decimals), time: rate.time })
      })
    )

    return valueGmxPositions(chainId, positions, orders, claimables, priceByToken, baseToken, nowSec)
  }
}
