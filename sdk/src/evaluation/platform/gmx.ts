import { type Address, getAddress, type Hex } from 'viem'
import { max } from '../../core/math.js'
import { MARKET_ADDRESS_DESCRIPTION_MAP } from '../../gmx/market.js'
import { getLeverageFactor, getPositionPnlUsd } from '../../gmx/position.js'
import { select } from '../../state/shared.js'
import { usdToBase } from '../precision.js'
import type { INavPosition, IPlatformEvalParams, IPlatformEvaluator, IPlatformValuation } from '../types.js'

const PLATFORM = 'gmx'

const MARKET_INDEX_MAP = MARKET_ADDRESS_DESCRIPTION_MAP as Record<string, { indexToken?: Address } | undefined>

export function resolveIndexToken(market: Address): Address | undefined {
  return MARKET_INDEX_MAP[getAddress(market)]?.indexToken
}

export interface IGmxPositionRow {
  positionKey: Hex
  market: Address
  collateralToken: Address
  isLong: boolean
  sizeInUsd: bigint
  sizeInTokens: bigint
  collateralUsd: bigint
  storedPnlUsd: bigint
}

export type IGmxPriceMap = Map<Address, { price: bigint; updateTimestamp: number }>

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

  const positions: INavPosition[] = rows.map(row => {
    const indexToken = resolveIndexToken(row.market)
    const indexEntry = indexToken ? priceByToken.get(indexToken) : undefined
    const canRevalue = indexEntry !== undefined && indexEntry.price > 0n && indexToken !== undefined
    const pnlUsd = canRevalue
      ? getPositionPnlUsd(row.isLong, row.sizeInUsd, row.sizeInTokens, indexEntry.price)
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
      priceAgeSec: canRevalue ? Math.max(0, nowSec - indexEntry.updateTimestamp) : undefined,
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
  async evaluate({ sql, account, baseToken, nowSec }: IPlatformEvalParams): Promise<IPlatformValuation> {
    const positionRows = await select(sql, 'Position', {
      where: { account: { _eq: getAddress(account) }, venueId: { _eq: 'gmx' }, status: { _eq: 'open' } },
      fields: [
        'id',
        'account',
        'collateralToken',
        'market',
        'isLong',
        'sizeInUsd',
        'sizeInTokens',
        'collateralInUsd',
        'pnl'
      ]
    })
    const rows: IGmxPositionRow[] = positionRows.map(r => ({
      positionKey: r.id as Hex,
      market: getAddress(r.market),
      collateralToken: getAddress(r.collateralToken),
      isLong: r.isLong,
      sizeInUsd: r.sizeInUsd,
      sizeInTokens: r.sizeInTokens,
      collateralUsd: r.collateralInUsd,
      storedPnlUsd: r.pnl
    }))
    if (rows.length === 0) return { platform: PLATFORM, positions: [], inFlight: [], available: true }

    const priceRows = await select(sql, 'GmxOraclePrice', {
      where: { id: { _in: gmxTokensToPrice(rows, baseToken) } },
      fields: ['id', 'price', 'updateTimestamp']
    })
    const priceByToken: IGmxPriceMap = new Map()
    for (const p of priceRows)
      priceByToken.set(getAddress(p.id), { price: p.price, updateTimestamp: p.updateTimestamp })

    return valueGmxPositions(rows, priceByToken, getAddress(baseToken), nowSec)
  }
}
