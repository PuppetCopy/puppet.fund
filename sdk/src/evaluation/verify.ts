import { BASIS_POINTS } from '@puppet/contracts/const'
import { CompactError } from '../compact/error.js'
import { delta } from '../core/math.js'
import type { IEvaluationConfig, INavBreakdown, INavGate, INavGateReason, INavKind } from './types.js'

export function navDriftBps(clientNav: bigint, computedNav: bigint): bigint {
  const denom = computedNav === 0n ? 1n : computedNav
  return (delta(clientNav, computedNav) * BASIS_POINTS) / denom
}

export function checkNavGate(
  breakdown: INavBreakdown,
  navSigned: bigint,
  config: IEvaluationConfig,
  opts?: { clientNav?: bigint; kind?: INavKind }
): INavGate {
  const reasons: INavGateReason[] = []

  for (const c of breakdown.perChain) {
    if (c.severity === 'unreachable' || c.ageSec > config.maxIndexerAgeSec) {
      reasons.push({
        code: 'INDEXER_STALE',
        detail: `chain ${c.chainId} indexed ${Math.round(c.ageSec)}s behind (max ${config.maxIndexerAgeSec}s)`
      })
    }
  }

  let unitedUnrecognized = 0n
  for (const c of breakdown.perChain) unitedUnrecognized += c.unrecognized
  if (unitedUnrecognized > config.maxUnrecognizedBaseWei) {
    reasons.push({
      code: 'UNRECOGNIZED_BALANCE',
      detail: `${unitedUnrecognized} base returned but not co-signed (max ${config.maxUnrecognizedBaseWei}); recognise it first`
    })
  }

  for (const platform of breakdown.unavailablePlatforms) {
    reasons.push({ code: 'PLATFORM_UNAVAILABLE', detail: `platform ${platform} cannot value its positions` })
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

  for (const f of breakdown.inFlight) {
    reasons.push({
      code: f.kind === 'transfer' ? 'PENDING_BRIDGE' : 'PENDING_ORDER',
      detail: `${f.platform} ${f.kind} in-flight (${f.ref}): ${f.detail}`
    })
  }

  if (opts?.clientNav !== undefined && opts.kind !== 'view') {
    const overstatedBy = opts.kind === 'fulfill' ? opts.clientNav - navSigned : navSigned - opts.clientNav
    if (overstatedBy > 0n) {
      const drift = navDriftBps(opts.clientNav, navSigned)
      if (drift > config.driftToleranceBps) {
        reasons.push({
          code: 'NAV_MISMATCH',
          detail: `client NAV ${opts.clientNav} overstates computed ${navSigned} by ${drift}bps for ${opts.kind} (max ${config.driftToleranceBps}bps)`
        })
      }
    }
  }

  return { ok: reasons.length === 0, reasons }
}

export function assertNavSignable(gate: INavGate): void {
  if (gate.ok) return
  const first = gate.reasons[0]
  throw new CompactError(first.code, gate.reasons.map(r => r.detail).join('; '), 'soft')
}
