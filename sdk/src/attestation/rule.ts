import type { Hex } from 'viem'

export const RULE_SLOTS = ['throttlePeriod', 'rateLimit', 'exitFreeze', 'allocationRate', 'symmetry'] as const
export type RuleSlot = (typeof RULE_SLOTS)[number]
export type IRuleBody = Record<RuleSlot, bigint>

const SLOT_HEX = 64

export function decodeRuleBody(body: Hex): IRuleBody {
  const hex = body.startsWith('0x') ? body.slice(2) : body
  const out = {} as IRuleBody
  for (let i = 0; i < RULE_SLOTS.length; i++) {
    const start = i * SLOT_HEX
    out[RULE_SLOTS[i]] = hex.length >= start + SLOT_HEX ? BigInt(`0x${hex.slice(start, start + SLOT_HEX)}`) : 0n
  }
  return out
}

export function encodeRuleBody(rule: Partial<IRuleBody>): Hex {
  const body = RULE_SLOTS.map(name => (rule[name] ?? 0n).toString(16).padStart(SLOT_HEX, '0')).join('')
  return `0x${body}`
}

export const RULE_REVOKED: IRuleBody = Object.fromEntries(RULE_SLOTS.map(name => [name, 0n])) as IRuleBody

export function isRevokedRule(rule: Partial<IRuleBody>): boolean {
  return RULE_SLOTS.every(name => (rule[name] ?? 0n) === 0n)
}

export function encodeRevokedRule(): Hex {
  return '0x'
}
