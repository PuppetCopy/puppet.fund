import { PRECISION, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__Mandate } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual } from 'viem'

export interface IAllocationCandidate {
  puppet: Address
  mandate: IAccountLib__Mandate
  available: bigint
  basis: bigint
  allocatedAt: bigint
}

export interface IAllocationRow {
  puppet: Address
  stake: bigint
  mandate: IAccountLib__Mandate
}

const byPuppet = <T extends { puppet: Address }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (BigInt(a.puppet) < BigInt(b.puppet) ? -1 : BigInt(a.puppet) > BigInt(b.puppet) ? 1 : 0))

export const allocationRoom = (
  mandate: Pick<IAccountLib__Mandate, 'allocationRate'>,
  available: bigint,
  basis: bigint
): bigint => {
  const cap = ((available + basis) * mandate.allocationRate) / PRECISION.basisPoints
  return cap > basis ? cap - basis : 0n
}

export const cooledDown = (allocatedAt: bigint, cooldownPeriod: bigint, nowSec: bigint): boolean =>
  allocatedAt === 0n || nowSec >= allocatedAt + cooldownPeriod

function split(
  fundRow: readonly (IAllocationCandidate & { cap: bigint })[],
  room: bigint | null,
  minStake: bigint
): IAllocationRow[] {
  const ascending = [...fundRow].sort((a, b) => (a.cap < b.cap ? -1 : a.cap > b.cap ? 1 : 0))
  let total = ascending.reduce((sum, c) => sum + c.cap, 0n)
  const stakeOf = (cap: bigint): bigint => (room === null || total <= room ? cap : (cap * room) / total)
  let from = 0
  while (from < ascending.length) {
    if (stakeOf(ascending[from]!.cap) >= minStake) break
    total -= ascending[from]!.cap
    from += 1
  }
  return ascending
    .slice(from)
    .map(c => ({ puppet: c.puppet, mandate: c.mandate, stake: stakeOf(c.cap) }))
    .filter(row => row.stake > 0n)
}

export function composeAllocation(input: {
  master: Address
  nowSec: bigint
  minStake: bigint
  baseFloor: bigint
  roomAt: (floor: bigint) => bigint | null
  candidates: readonly IAllocationCandidate[]
}): IAllocationRow[] {
  const eligible = input.candidates
    .filter(c => !isAddressEqual(c.puppet, input.master))
    .filter(c => isAddressEqual(c.mandate.master, input.master))
    .filter(c => c.mandate.expiry > input.nowSec)
    .filter(c => cooledDown(c.allocatedAt, c.mandate.cooldownPeriod, input.nowSec))
    .map(c => ({ ...c, puppet: getAddress(c.puppet), cap: allocationRoom(c.mandate, c.available, c.basis) }))
    .filter(c => c.cap > 0n)

  const levels = [...new Set([input.baseFloor, ...eligible.map(c => c.mandate.skin).filter(skin => skin > input.baseFloor)])].sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  )
  let best: IAllocationRow[] = []
  let bestTotal = 0n
  for (const floor of levels) {
    const joined = eligible
      .filter(c => c.mandate.skin <= floor)
      .sort((a, b) => (a.cap > b.cap ? -1 : a.cap < b.cap ? 1 : 0))
      .slice(0, Number(PROTOCOL.maxCohortSize))
    const rows = split(joined, input.roomAt(floor), input.minStake)
    const total = rows.reduce((sum, row) => sum + row.stake, 0n)
    if (total > bestTotal) {
      best = rows
      bestTotal = total
    }
  }
  return byPuppet(best)
}
