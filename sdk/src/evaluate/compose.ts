import { PRECISION } from '@puppet/contracts/const'
import { applyBasisPoints, max, min } from '../core/math.js'
import type {
  IEvaluationConfig,
  INavBreakdown,
  INavChainBalance,
  INavKind,
  INavPosition,
  INavValuedHolding,
  IPlatformInFlight,
  IPlatformValuation
} from './types.js'

function haircutGain(pnlBase: bigint, gainHaircutBps: bigint): bigint {
  return pnlBase > 0n ? applyBasisPoints(pnlBase, PRECISION.basisPoints - gainHaircutBps) : pnlBase
}

export function composeBreakdown(
  chains: INavChainBalance[],
  valuations: IPlatformValuation[],
  holdings: INavValuedHolding[] = []
): INavBreakdown {
  let unitedSignedBalance = 0n
  for (const c of chains) unitedSignedBalance += c.signedBalance

  let holdingMarkBase = 0n
  for (const h of holdings) holdingMarkBase += h.valueBase

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
    holdingMarkBase,
    perChain: chains,
    holdings,
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
  const spotBase = breakdown.unitedSignedBalance + breakdown.holdingMarkBase
  const navMark = spotBase + breakdown.positionMarkBase
  const navFloor = spotBase + breakdown.positionFloorBase

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
    navSigned = spotBase + positionAllocBase
  }

  return { navMark, navFloor, navSigned }
}
