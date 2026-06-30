import type {  IGmxPositionProvider } from '@puppet/sdk/evaluate'
import { getAddress } from 'viem'
import { fetchOpenPositions } from '../matchmaker/reads.js'

// Browser-side NAV providers, the client counterpart to the matchmaker's in-process ones. The evaluate module
// is provider-injected: open positions come from the journal's folded gmxPositionTable (via /query), prices
// from the journal's GET /rate (the same median oracle the relay co-signs against, so the browser prices
// exactly the relay's priceable set).

export const gmxPositionProvider: IGmxPositionProvider = async account =>
  (await fetchOpenPositions(getAddress(account))).map(p => ({
    positionKey: p.positionId,
    market: getAddress(p.market),
    collateralToken: getAddress(p.collateralToken),
    isLong: p.isLong,
    sizeInUsd: p.sizeInUsd,
    sizeInTokens: p.sizeInTokens,
    collateralUsd: p.collateralInUsd,
    storedPnlUsd: p.pnl
  }))

