import { PRECISION } from '@puppet/contracts/const'
import { CompactError } from '../compact/error.js'
import { abs, delta, max } from '../core/math.js'
import type { IEvaluationConfig, INavBreakdown, INavGate, INavGateReason, INavKind } from './types.js'

function navDriftBps(clientNav: bigint, computedNav: bigint): bigint {
  const denom = max(abs(clientNav), abs(computedNav))
  if (denom === 0n) return 0n
  return (delta(clientNav, computedNav) * PRECISION.basisPoints) / denom
}

export function checkNavGate(
  breakdown: INavBreakdown,
  navMark: bigint,
  config: IEvaluationConfig,
  opts?: { clientNav?: bigint; kind?: INavKind }
): INavGate {
  const reasons: INavGateReason[] = []

  for (const c of breakdown.perChain) {
    if (!c.reachable) {
      reasons.push({ code: 'CHAIN_UNREACHABLE', detail: `chain ${c.chainId} is unreachable; cannot price its custody` })
    }
  }

  for (const u of breakdown.unavailablePlatforms) {
    reasons.push({ code: 'PLATFORM_UNAVAILABLE', detail: `platform ${u.platform} cannot value its positions: ${u.reason}` })
  }

  for (const p of breakdown.positions) {
    if (p.priceAgeSec === undefined) {
      reasons.push({
        code: 'STALE_ORACLE',
        detail: `${p.platform} position ${p.positionKey} is unvaluable (market ${p.market})`
      })
    } else if (p.priceAgeSec > config.maxPriceAgeSec) {
      reasons.push({
        code: 'STALE_ORACLE',
        detail: `${p.platform} position ${p.positionKey} priced ${p.priceAgeSec}s old (max ${config.maxPriceAgeSec}s)`
      })
    }
  }

  for (const h of breakdown.holdings) {
    if (h.mark.priceAgeSec > config.maxPriceAgeSec) {
      reasons.push({
        code: 'STALE_ORACLE',
        detail: `holding ${h.symbol} on chain ${h.chainId} priced ${h.mark.priceAgeSec}s old (max ${config.maxPriceAgeSec}s)`
      })
    }
  }

  if (opts?.kind !== 'view') {
    for (const f of breakdown.inFlight) {
      reasons.push({
        code: 'PENDING_ORDER',
        detail: `${f.platform} in-flight (${f.ref}): ${f.detail}`
      })
    }
  }

  const exposed = breakdown.positions.filter(p => p.facets?.kind !== 'venue-cash' && p.facets?.kind !== 'claimable-funding')
  if (opts?.kind === 'settle' && exposed.length > 0) {
    reasons.push({
      code: 'OPEN_POSITIONS',
      detail: `${exposed.length} venue position(s) still open; a cycle settles only once every position is closed`
    })
  }

  if (opts?.clientNav !== undefined && opts.kind !== 'view') {
    const drift = navDriftBps(opts.clientNav, navMark)
    if (drift > config.driftToleranceBps) {
      reasons.push({
        code: 'NAV_MISMATCH',
        detail: `client NAV ${opts.clientNav} diverges from computed ${navMark} by ${drift}bps for ${opts.kind} (consensus max ${config.driftToleranceBps}bps)`
      })
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

export function assertNavSignable(gate: INavGate): asserts gate is { ok: true } {
  if (gate.ok) return
  const first = gate.reasons[0]
  throw new CompactError(first.code, gate.reasons.map(r => r.detail).join('; '), 'soft')
}
