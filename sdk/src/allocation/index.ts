import { PROTOCOL } from '@puppet/contracts/const'
import type { IMandateLib__Mandate } from '@puppet/contracts/types'
import { type Address, getAddress, isAddressEqual } from 'viem'
import { PRECISION } from '../const/common.js'
import { cashFor, sharesFor } from '../pool/index.js'
import { dispatchGasLimit, MAX_TX_GAS } from '../state/fee.js'

export interface IAllocationCandidate {
  puppet: Address
  mandate: IMandateLib__Mandate
  available: bigint
  held: bigint
  allocatedAt: bigint
}

export interface IAllocationRow {
  puppet: Address
  stake: bigint
  mandate: IMandateLib__Mandate
}

const byPuppet = <T extends { puppet: Address }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (BigInt(a.puppet) < BigInt(b.puppet) ? -1 : BigInt(a.puppet) > BigInt(b.puppet) ? 1 : 0))

export const allocationRoom = (mandate: Pick<IMandateLib__Mandate, 'allocationRate'>, available: bigint): bigint =>
  (available * mandate.allocationRate) / PRECISION.basisPoints

export const cooledDown = (allocatedAt: bigint, cooldownPeriod: bigint, at: bigint): boolean =>
  allocatedAt === 0n || at >= allocatedAt + cooldownPeriod

export function raisableOf(
  fund: { supply: bigint; value: bigint; masterShares: bigint; exiting: bigint },
  c: Pick<IAllocationCandidate, 'mandate' | 'available' | 'held'>
): { now: bigint; potential: bigint; unlockShares: bigint | null } {
  const rate = allocationRoom(c.mandate, c.available)
  const skinShares = (fund.masterShares * c.mandate.skin) / PRECISION.basisPoints
  const skin = skinShares > c.held ? cashFor(skinShares - c.held, fund.supply, fund.value) : 0n
  const headroom = (amount: bigint): bigint =>
    c.mandate.exitCap <= fund.exiting ? 0n : (amount * (c.mandate.exitCap - fund.exiting)) / c.mandate.exitCap
  const needed = (c.held + sharesFor(rate, fund.supply, fund.value)) * PRECISION.basisPoints
  return {
    now: headroom(c.mandate.skin === 0n || rate < skin ? rate : skin),
    potential: headroom(rate),
    unlockShares: c.mandate.skin === 0n ? null : (needed + c.mandate.skin - 1n) / c.mandate.skin
  }
}

export function composeAllocation(input: {
  kind: 'allocate' | 'createFund'
  master: Address
  owner: Address
  now: bigint
  deadline: bigint
  supply: bigint
  value: bigint
  masterShares: bigint
  exiting: bigint
  sliceAt: (rows: number) => bigint
  candidates: readonly IAllocationCandidate[]
}): IAllocationRow[] {
  const eligible = input.candidates
    .filter(c => !isAddressEqual(c.puppet, input.master) && !isAddressEqual(c.puppet, input.owner))
    .filter(c => isAddressEqual(c.mandate.master, input.master))
    .filter(c => c.mandate.expiry > input.deadline)
    .filter(c => cooledDown(c.allocatedAt, c.mandate.cooldownPeriod, input.now))
    .map(c => ({ ...c, puppet: getAddress(c.puppet), cap: raisableOf(input, c).now }))
    .filter(c => c.cap > 0n)
  let cohort = cohortOf(eligible, input.sliceAt)
  while (cohort.length > 0 && dispatchGasLimit(input.kind, false, BigInt(cohort.length), 0n, 0n) > MAX_TX_GAS) {
    cohort = cohortOf(cohort.slice(1), input.sliceAt)
  }
  return byPuppet(cohort.map(c => ({ puppet: c.puppet, mandate: c.mandate, stake: c.cap })))
}

export function cohortOf<T extends { cap: bigint }>(rows: readonly T[], sliceAt: (rows: number) => bigint): T[] {
  const ascending = [...rows]
    .sort((a, b) => (a.cap > b.cap ? -1 : a.cap < b.cap ? 1 : 0))
    .slice(0, Number(PROTOCOL.maxCohortSize))
    .reverse()
  while (ascending.length > 0 && ascending[0]!.cap * PROTOCOL.maxRelayFeeBps <= sliceAt(ascending.length) * PRECISION.basisPoints) {
    ascending.shift()
  }
  return ascending
}
