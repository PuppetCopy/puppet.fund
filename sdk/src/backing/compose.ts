import { PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__Mandate } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { backingCap, backingRoom, listsToken } from './sizing.js'

export interface ICohortCandidate {
  puppet: Address
  mandate: IAccountLib__Mandate
  matchable: bigint
  committedAt: number
}

export interface ICohortRow {
  puppet: Address
  matchable: bigint
  stake: bigint
  mandate: IAccountLib__Mandate
}

export interface ISettleValuation {
  toValue(token: Address, amount: bigint): bigint
  toAmount(token: Address, value: bigint): bigint
}

export function composeCohort(input: {
  master: Address
  tokenId: Hex
  collateral: bigint
  skin: bigint
  backed: bigint
  nowSec: number
  minStake: bigint
  candidates: readonly ICohortCandidate[]
}): ICohortRow[] {
  const room = backingRoom(input.collateral, input.skin) - input.backed
  if (room <= 0n) return []
  const eligible = input.candidates
    .filter(c => !isAddressEqual(c.puppet, input.master))
    .filter(c => isAddressEqual(c.mandate.master, input.master))
    .filter(c => c.mandate.expiry >= BigInt(input.nowSec))
    .filter(c => c.committedAt + Number(c.mandate.cooldownPeriod) <= input.nowSec)
    .filter(c => listsToken(c.mandate, input.tokenId))
    .map(c => ({ ...c, puppet: getAddress(c.puppet), cap: backingCap(c.mandate, input.collateral, c.matchable) }))
    .filter(c => c.cap > 0n)
    .sort((a, b) => (a.cap > b.cap ? -1 : a.cap < b.cap ? 1 : 0))
    .slice(0, Number(PROTOCOL.maxCohortSize))

  const ascending = [...eligible].sort((a, b) => (a.cap < b.cap ? -1 : a.cap > b.cap ? 1 : 0))
  let total = ascending.reduce((sum, c) => sum + c.cap, 0n)
  let from = 0
  while (from < ascending.length) {
    const smallest = ascending[from]!
    const stake = total <= room ? smallest.cap : (smallest.cap * room) / total
    if (stake >= input.minStake) break
    total -= smallest.cap
    from += 1
  }
  const taken = ascending.slice(from)
  return taken
    .map(c => ({ puppet: c.puppet, matchable: c.matchable, mandate: c.mandate, stake: total <= room ? c.cap : (c.cap * room) / total }))
    .filter(row => row.stake > 0n)
    .sort((a, b) => (BigInt(a.puppet) < BigInt(b.puppet) ? -1 : 1))
}
