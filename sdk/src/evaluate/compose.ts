import type {
  INavBreakdown,
  INavChainBalance,
  INavPosition,
  INavValuedHolding,
  IPlatformInFlight,
  IPlatformValuation
} from './types.js'

export function composeBreakdown(
  chains: INavChainBalance[],
  valuations: IPlatformValuation[],
  holdings: INavValuedHolding[]
): INavBreakdown {
  let unitedCashBase = 0n
  for (const c of chains) unitedCashBase += c.balance

  let holdingMarkBase = 0n
  for (const h of holdings) {
    holdingMarkBase += h.mark.valueBase
  }

  const positions: INavPosition[] = []
  const inFlight: IPlatformInFlight[] = []
  const unavailablePlatforms: { platform: string; reason: string | undefined }[] = []
  let positionMarkBase = 0n
  for (const v of valuations) {
    if (!v.available) unavailablePlatforms.push({ platform: v.platform, reason: v.unavailableReason })
    for (const f of v.inFlight) inFlight.push(f)
    for (const p of v.positions) {
      positions.push(p)
      positionMarkBase += p.netBase
    }
  }

  return {
    unitedCashBase,
    positionMarkBase,
    holdingMarkBase,
    perChain: chains,
    holdings,
    positions,
    inFlight,
    unavailablePlatforms
  }
}

