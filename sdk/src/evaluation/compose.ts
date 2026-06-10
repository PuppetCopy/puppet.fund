import { BASIS_POINTS } from '@puppet/contracts/const'
import { applyBasisPoints, max, min } from '../core/math.js'
import type {
  IEvaluationConfig,
  INavBreakdown,
  INavChainBalance,
  INavKind,
  INavPosition,
  IPlatformInFlight,
  IPlatformValuation
} from './types.js'

function haircutGain(pnlBase: bigint, gainHaircutBps: bigint): bigint {
  return pnlBase > 0n ? applyBasisPoints(pnlBase, BASIS_POINTS - gainHaircutBps) : pnlBase
}

export function composeBreakdown(chains: INavChainBalance[], valuations: IPlatformValuation[]): INavBreakdown {
  let unitedSignedBalance = 0n
  for (const c of chains) unitedSignedBalance += c.signedBalance

  const positions: INavPosition[] = []
  const inFlight: IPlatformInFlight[] = []
  const unavailablePlatforms: string[] = []
  let positionMarkBase = 0n
  let positionFloorBase = 0n
  for (const v of valuations) {
    if (!v.available) unavailablePlatforms.push(v.platform)
    for (const f of v.inFlight) inFlight.push(f)
    for (const p of v.positions) {
      positions.push(p)
      positionMarkBase += max(0n, p.collateralBase + p.pnlBase)
      positionFloorBase += max(0n, p.collateralBase + min(0n, p.pnlBase))
    }
  }

  return {
    unitedSignedBalance,
    positionMarkBase,
    positionFloorBase,
    perChain: chains,
    positions,
    inFlight,
    unavailablePlatforms
  }
}

export function computeNavValues(
  breakdown: INavBreakdown,
  kind: INavKind,
  config: IEvaluationConfig
): { navMark: bigint; navFloor: bigint; navSigned: bigint } {
  const navMark = breakdown.unitedSignedBalance + breakdown.positionMarkBase
  const navFloor = breakdown.unitedSignedBalance + breakdown.positionFloorBase

  let navSigned: bigint
  if (kind === 'view') {
    navSigned = navMark
  } else if (kind === 'redeem') {
    navSigned = navFloor
  } else {
    let positionAllocBase = 0n
    for (const p of breakdown.positions) {
      positionAllocBase += max(0n, p.collateralBase + haircutGain(p.pnlBase, config.allocateGainHaircutBps))
    }
    navSigned = breakdown.unitedSignedBalance + positionAllocBase
  }

  return { navMark, navFloor, navSigned }
}
