import { decodeRuleBody, RULE_SLOTS, type RuleSlot } from '@puppet/sdk/attestation'
import type { Hex } from 'viem'

export type RuleUnit = 'seconds' | 'bps' | 'token' | 'flag'

export const RULE_META: Record<RuleSlot, { label: string; unit: RuleUnit }> = {
  throttlePeriod: { label: 'Throttle period', unit: 'seconds' },
  rateLimit: { label: 'Rate limit', unit: 'token' },
  exitFreeze: { label: 'Exit freeze', unit: 'bps' },
  allocationRate: { label: 'Allocation rate', unit: 'bps' },
  symmetry: { label: 'Symmetric funding', unit: 'flag' }
}

export interface IRuleField {
  key: RuleSlot
  label: string
  unit: RuleUnit
  value: bigint
}

export function parseRuleBody(body: Hex): IRuleField[] {
  const decoded = decodeRuleBody(body)
  return RULE_SLOTS.map(key => ({ key, ...RULE_META[key], value: decoded[key] }))
}
