import { PRECISION } from '@puppet/contracts/const'
import { CompactError } from '../compact/error.js'
import { abs, delta, max } from '../core/math.js'
import type { IEvaluationConfig, INavBreakdown, INavGate, INavGateReason, INavKind } from './types.js'

export function navDriftBps(clientNav: bigint, computedNav: bigint): bigint {
  const denom = max(abs(clientNav), abs(computedNav))
  if (denom === 0n) return 0n
  return (delta(clientNav, computedNav) * PRECISION.basisPoints) / denom
}

export function checkNavGate(
  breakdown: INavBreakdown,
  navSigned: bigint,
  config: IEvaluationConfig,
  opts?: { clientNav?: bigint; kind?: INavKind }
): INavGate {
  const reasons: INavGateReason[] = []

  // Liveness, not lag: the cash leg is read on-chain per intent (no indexer to trail the head), so the only blocking
  // condition is a chain we cannot reach — there is no "behind" to gate on. A reachable chain is always current.
  for (const c of breakdown.perChain) {
    if (!c.reachable) {
      reasons.push({ code: 'CHAIN_UNREACHABLE', detail: `chain ${c.chainId} is unreachable; cannot price its custody` })
    }
  }

  let unitedUnrecognized = 0n
  for (const c of breakdown.perChain) unitedUnrecognized += c.unrecognized
  for (const h of breakdown.holdings) unitedUnrecognized += h.unrecognizedBase
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

  for (const h of breakdown.holdings) {
    if (h.priceAgeSec === undefined) {
      reasons.push({
        code: 'STALE_ORACLE',
        detail: `holding ${h.symbol} (${h.token}) on chain ${h.chainId} is unvaluable`
      })
    } else if (h.priceAgeSec > config.maxPriceAgeSec) {
      reasons.push({
        code: 'STALE_ORACLE',
        detail: `holding ${h.symbol} on chain ${h.chainId} priced ${h.priceAgeSec}s old (max ${config.maxPriceAgeSec}s)`
      })
    }
  }

  for (const f of breakdown.inFlight) {
    reasons.push({
      code: f.kind === 'transfer' ? 'PENDING_BRIDGE' : 'PENDING_ORDER',
      detail: `${f.platform} ${f.kind} in-flight (${f.ref}): ${f.detail}`
    })
  }

  // Liquidate demands a fully-unwound book: an open position cannot ride into a close,
  // the full drain transfers actual base.
  if (opts?.kind === 'liquidate' && breakdown.positions.length > 0) {
    reasons.push({
      code: 'OPEN_POSITIONS',
      detail: `${breakdown.positions.length} venue position(s) still open; unwind to base before liquidating`
    })
  }
  if (opts?.kind === 'liquidate' && breakdown.holdings.some(h => h.signedBalance > 0n)) {
    reasons.push({
      code: 'OPEN_POSITIONS',
      detail: 'non-base holdings still open; swap to base before liquidating'
    })
  }

  if (opts?.clientNav !== undefined && opts.kind !== 'view') {
    const drift = navDriftBps(opts.clientNav, navSigned)
    if (drift > config.driftToleranceBps) {
      reasons.push({
        code: 'NAV_MISMATCH',
        detail: `client NAV ${opts.clientNav} diverges from computed ${navSigned} by ${drift}bps for ${opts.kind} (consensus max ${config.driftToleranceBps}bps)`
      })
    }
  }

  return { ok: reasons.length === 0, reasons }
}

export function assertNavSignable(gate: INavGate): void {
  if (gate.ok) return
  const first = gate.reasons[0]
  throw new CompactError(first.code, gate.reasons.map(r => r.detail).join('; '), 'soft')
}
