import { TOKEN_META } from '@puppet/contracts/const'
import { type Address, getAddress } from 'viem'
import { max } from '../../core/math.js'
import { MARKET_ADDRESS_DESCRIPTION_MAP } from '../../gmx/market.js'
import { getLeverageFactor, getPositionPnlUsd } from '../../gmx/position.js'
import { tokenMetaByAddress } from '../../state/tokenRegistry.js'
import { usdToBase } from '../precision.js'
import type {
  IGmxPositionRow,
  INavPosition,
  IPlatformEvalParams,
  IPlatformEvaluator,
  IPlatformValuation,
  IPriceSource
} from '../types.js'

export type { IGmxPositionRow } from '../types.js'

const PLATFORM = 'gmx'

// GMX denominates positions in USD; USDC is the dollar-proxy market we price every token against to convert
// those USD figures into base-token wei (see usdToBase). A token with no <token>/USDC market simply has no
// entry and degrades to its stored pnl.
const USD_PROXY = TOKEN_META.USDC.symbol

const MARKET_INDEX_MAP = MARKET_ADDRESS_DESCRIPTION_MAP as Record<string, { indexToken?: Address } | undefined>

export function resolveIndexToken(market: Address): Address | undefined {
  return MARKET_INDEX_MAP[getAddress(market)]?.indexToken
}

export type IGmxPriceMap = Map<Address, IPriceSource>

export function gmxTokensToPrice(rows: IGmxPositionRow[], baseToken: Address): Address[] {
  const tokens = new Set<Address>([getAddress(baseToken)])
  for (const r of rows) {
    const indexToken = resolveIndexToken(r.market)
    if (indexToken) tokens.add(getAddress(indexToken))
    tokens.add(getAddress(r.collateralToken))
  }
  return [...tokens]
}

export function valueGmxPositions(
  rows: IGmxPositionRow[],
  priceByToken: IGmxPriceMap,
  baseToken: Address,
  nowSec: number
): IPlatformValuation {
  if (rows.length === 0) return { platform: PLATFORM, positions: [], inFlight: [], available: true }

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
  return { platform: PLATFORM, positions, inFlight: [], available: true }
}

export const gmxEvaluator: IPlatformEvaluator = {
  platform: PLATFORM,
  async evaluate({ baseToken, nowSec, getRate, positions }: IPlatformEvalParams): Promise<IPlatformValuation> {
    if (positions.length === 0) return { platform: PLATFORM, positions: [], inFlight: [], available: true }

    // Price every distinct token (base + per-market index + collateral) against the USD-proxy market in
    // parallel; token0 is that token's per-wei price in USD-scale. A token with no direct <token>/USDC market
    // fails closed in getRate and is simply omitted, so valueGmxPositions sees no entry and degrades it (the
    // base token missing => the platform reports unavailable; an index token missing => stored pnl).
    const priceByToken: IGmxPriceMap = new Map()
    await Promise.all(
      gmxTokensToPrice(positions, baseToken).map(async token => {
        // Resolve the token ADDRESS to its asset symbol for the rate API; a GMX index token that isn't a registered
        // base (e.g. a synthetic market) has no entry, so it's simply omitted (same as the unpriceable-pair degrade).
        const asset = tokenMetaByAddress.get(getAddress(token))?.symbol
        if (!asset) return
        const rate = await getRate(asset, USD_PROXY).catch(() => null)
        if (rate) priceByToken.set(getAddress(token), { price: rate.token0, time: rate.time })
      })
    )

    return valueGmxPositions(positions, priceByToken, getAddress(baseToken), nowSec)
  }
}
