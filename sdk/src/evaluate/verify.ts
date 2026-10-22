import { CompactError } from '../compact/error.js'
import type { INavGate } from './types.js'

export function assertNavSignable(gate: INavGate): asserts gate is { ok: true } {
  if (gate.ok) return
  const first = gate.reasons[0]
  throw new CompactError(first.code, gate.reasons.map(r => r.detail).join('; '), 'soft')
}
