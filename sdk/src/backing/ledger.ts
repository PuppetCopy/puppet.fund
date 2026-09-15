import type { Address } from 'viem'

export const SHARE_PRECISION = 10n ** 12n

export interface ILedger {
  totalShares: bigint
  totalPending: bigint
  backing: bigint
  masterShares: bigint
  masterPending: bigint
}

export interface IBackerLedger {
  puppet: Address
  stake: bigint
  pending: bigint
  shares: bigint
}

export const byPuppet = <T extends { puppet: Address }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (BigInt(a.puppet) < BigInt(b.puppet) ? -1 : BigInt(a.puppet) > BigInt(b.puppet) ? 1 : 0))

export function foldPending(
  ledger: ILedger,
  priorValue: bigint,
  backers: readonly IBackerLedger[]
): { ledger: ILedger; backers: IBackerLedger[]; puppetValue: bigint } {
  const pending = ledger.totalPending
  const ordered = byPuppet(backers)
  if (ledger.totalShares === 0n && pending === 0n) {
    return { ledger: { ...ledger }, backers: ordered.map(b => ({ ...b })), puppetValue: 0n }
  }
  const virtual = priorValue + ledger.backing - pending
  const mint = ledger.totalShares === 0n ? pending * SHARE_PRECISION : (pending * ledger.totalShares) / virtual
  const total = ledger.totalShares + mint
  let cum = ledger.masterPending
  let prev = pending === 0n ? 0n : (mint * cum) / pending
  const masterShares = ledger.masterShares + prev
  const folded = ordered.map(b => {
    cum += b.pending
    const cur = pending === 0n ? 0n : (mint * cum) / pending
    const shares = b.shares + (cur - prev)
    prev = cur
    return { ...b, shares, pending: 0n }
  })
  if (cum !== pending) {
    throw new Error(`ledger: pending ${pending} is not covered by the backers (${cum}); a backer row is missing`)
  }
  return {
    ledger: { ...ledger, totalShares: total, totalPending: 0n, masterShares, masterPending: 0n },
    backers: folded,
    puppetValue: total === 0n ? 0n : ((virtual + pending) * (total - masterShares)) / total
  }
}

export function applyOperate(
  ledger: ILedger,
  deposit: bigint,
  backers: readonly IBackerLedger[],
  stakes: readonly { puppet: Address; stake: bigint }[]
): { ledger: ILedger; backers: IBackerLedger[] } {
  const next = { ...ledger }
  if (ledger.totalShares === 0n && ledger.totalPending === 0n) {
    next.masterShares = deposit * SHARE_PRECISION
    next.totalShares = deposit * SHARE_PRECISION
  } else {
    next.masterPending = deposit
    next.totalPending += deposit
  }
  const rows = new Map(backers.map(b => [b.puppet, { ...b }]))
  for (const { puppet, stake } of stakes) {
    const row = rows.get(puppet) ?? { puppet, stake: 0n, pending: 0n, shares: 0n }
    row.stake += stake
    row.pending = stake
    rows.set(puppet, row)
    next.totalPending += stake
    next.backing += stake
  }
  return { ledger: next, backers: byPuppet([...rows.values()]) }
}

export function owedFor(
  ledger: ILedger,
  priorValue: bigint,
  value: bigint,
  backers: readonly IBackerLedger[]
): { puppet: Address; owed: bigint }[] {
  const pending = ledger.totalPending
  const virtual = priorValue + ledger.backing - pending
  const mint = ledger.totalShares === 0n ? pending * SHARE_PRECISION : (pending * ledger.totalShares) / virtual
  const total = ledger.totalShares + mint
  let cum = ledger.masterPending
  let prev = pending === 0n ? 0n : (mint * cum) / pending
  const virtualEnd = value + ledger.backing
  let shareCum = 0n
  let valuePrev = 0n
  return byPuppet(backers).map(b => {
    cum += b.pending
    const cur = pending === 0n ? 0n : (mint * cum) / pending
    shareCum += b.shares + (cur - prev)
    prev = cur
    const valueCur = total === 0n ? 0n : (virtualEnd * shareCum) / total
    const owed = valueCur - valuePrev - b.stake
    valuePrev = valueCur
    return { puppet: b.puppet, owed }
  })
}
