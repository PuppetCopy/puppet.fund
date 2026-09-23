import { CompactError } from '../compact/error.js'
import { driftVerdict } from './gain.js'
import type { IEvaluationConfig, INavBreakdown, INavGate, INavGateReason, INavKind, ISignerGain } from './types.js'

export function checkNavGate(
  breakdown: INavBreakdown,
  navMark: bigint,
  config: IEvaluationConfig,
  opts?: { clientNav?: bigint; kind?: INavKind; signerGain?: ISignerGain | null }
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

  if (opts?.clientNav !== undefined && opts.kind !== 'view') {
    const gain = opts.signerGain ?? null
    const { drift, allowed, profits, above } = driftVerdict(opts.clientNav, navMark, gain, config.driftToleranceBps)
    if (drift > allowed) {
      reasons.push({
        code: 'NAV_MISMATCH',
        detail: profits
          ? `client NAV ${opts.clientNav} sits ${above ? 'above' : 'below'} computed ${navMark} by ${drift}bps for ${opts.kind}, the side the signer profits from (share ${above ? gain?.above : gain?.below} against ${above ? gain?.below : gain?.above}), where no drift is allowed`
          : `client NAV ${opts.clientNav} diverges from computed ${navMark} by ${drift}bps for ${opts.kind} (consensus max ${config.driftToleranceBps}bps)`
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
