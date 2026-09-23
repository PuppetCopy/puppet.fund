import { PRECISION, PROTOCOL } from '@puppet/contracts/const'
import type { IFundStore__Position, IFundStore__Queue } from '@puppet/contracts/types'
import type { Address } from 'viem'
import { CompactContractError } from '../compact/error.js'

export const VIRTUAL_UNITS = 10n ** 12n
const VIRTUAL_VALUE = 1n
const ACCRUED_PRECISION = 10n ** 30n
const WEIGHT_RATIO_CAP = 10n ** 6n

export const EMPTY_QUEUE: IFundStore__Queue = { epoch: 0n, weight: 0n, masterWeight: 0n, accrued: 0n }

export const unitsFor = (amount: bigint, supply: bigint, value: bigint): bigint =>
  (amount * (supply + VIRTUAL_UNITS)) / (value + VIRTUAL_VALUE)

export const cashFor = (units: bigint, supply: bigint, value: bigint): bigint =>
  (units * (value + VIRTUAL_VALUE)) / (supply + VIRTUAL_UNITS)

const ceilDiv = (a: bigint, b: bigint): bigint => (a === 0n ? 0n : (a - 1n) / b + 1n)

export const enqueue = (queue: IFundStore__Queue, queued: bigint, units: bigint): bigint =>
  queue.weight === 0n ? units : (units * queue.weight) / queued

function checkSkin(skin: bigint, active: bigint, masterUnits: bigint): void {
  if (masterUnits * PRECISION.basisPoints < active * skin) {
    throw new CompactContractError('Fund__SkinBelowFloor', [masterUnits, active, skin])
  }
}

export const floorOf = (skin: bigint, active: bigint, masterUnits: bigint): bigint => (active === masterUnits ? 0n : skin)

export function settlePosition(
  queue: IFundStore__Queue,
  position: IFundStore__Position,
  queued: bigint,
  closedAccrued: bigint | undefined,
  performanceFee: bigint
): { payout: bigint; fee: bigint; position: IFundStore__Position } {
  let payout = 0n
  let fee = 0n
  const next = { ...position }
  if (position.weight > 0n) {
    const closed = position.epoch < queue.epoch
    if (closed && closedAccrued === undefined) throw new Error(`epoch ${position.epoch} closed but its accrued was not read`)
    const accrued = closed ? closedAccrued! : queue.accrued
    payout = (position.weight * (accrued - position.cursor)) / ACCRUED_PRECISION
    let units = closed ? 0n : (position.weight * queued) / queue.weight
    if (units > position.units) units = position.units
    const consumed = position.units === 0n ? position.basis : (position.basis * (position.units - units)) / position.units
    if (payout > consumed) fee = ((payout - consumed) * performanceFee) / PRECISION.basisPoints
    next.basis = position.basis - consumed
    next.units = units
    if (closed) next.weight = 0n
  }
  next.epoch = queue.epoch
  next.cursor = queue.accrued
  return { payout, fee, position: next }
}

export interface IDrainPlan {
  drained: bigint
  cash: bigint
  payout: bigint
  retired: bigint
  queue: IFundStore__Queue
  queued: bigint
  masterUnits: bigint
}

export function planDrain(input: {
  token: Address
  skin: bigint
  queue: IFundStore__Queue
  supply: bigint
  queued: bigint
  masterUnits: bigint
  value: bigint
  retire: bigint
  drain: bigint
  funded: bigint
}): IDrainPlan {
  const { token, skin, supply, value, retire, drain, funded } = input
  let queue = input.queue
  let queued = input.queued
  let masterUnits = input.masterUnits
  if (retire > 0n) {
    if (masterUnits < retire) throw new CompactContractError('Fund__InsufficientUnits', [masterUnits, retire])
    const added = enqueue(queue, queued, retire)
    queue = { ...queue, weight: queue.weight + added, masterWeight: queue.masterWeight + added }
    queued += retire
    masterUnits -= retire
    checkSkin(skin, supply - queued, masterUnits)
  }
  if (drain === 0n || drain > queued) throw new CompactContractError('Fund__DrainExceedsQueue', [drain, queued])
  let drained = drain
  const requested = cashFor(drained, supply, value)
  if (requested > funded) {
    drained = (drained * funded) / requested
    if (drained === 0n) throw new CompactContractError('Balance__InsufficientFund', [token, funded, requested])
  }
  if (drained < queued) {
    const floor = ceilDiv(queue.weight, WEIGHT_RATIO_CAP)
    if (queued <= floor) throw new CompactContractError('Fund__DrainLeavesDust', [queued, floor])
    if (drained > queued - floor) drained = queued - floor
  }
  const cash = cashFor(drained, supply, value)
  const puppetWeight = queue.weight - queue.masterWeight
  const payout = (cash * puppetWeight) / queue.weight
  return {
    drained,
    cash,
    payout,
    retired: cash - payout,
    queued: queued - drained,
    masterUnits,
    queue: {
      ...queue,
      accrued: puppetWeight > 0n ? queue.accrued + (payout * ACCRUED_PRECISION) / puppetWeight : queue.accrued
    }
  }
}


export interface IAllocatePlan {
  masterSlice: bigint
  billed: bigint
  contributed: bigint
  rowList: ({ slice: bigint; units: bigint } | null)[]
  minted: bigint
  skin: bigint
  masterUnits: bigint
}

export function planAllocate(input: {
  skin: bigint
  supply: bigint
  queued: bigint
  masterUnits: bigint
  value: bigint
  fee: bigint
  credit: { chainId: bigint; amount: bigint; value: bigint }
  rowList: readonly { stake: bigint; skin: bigint; rate: bigint; balance: bigint; basis: bigint }[]
  verifyRow?: (index: number) => void
}): IAllocatePlan {
  const { supply, value, credit, rowList } = input
  const active = supply - input.queued
  let skin = floorOf(input.skin, active, input.masterUnits)
  let remainingFee = input.fee
  const masterLeg = credit.amount > 0n || credit.value > 0n ? 1n : 0n
  const count = BigInt(rowList.length)
  let minted = 0n
  const planned = rowList.map((row, i) => {
    const slice = remainingFee / (count - BigInt(i) + masterLeg)
    if (slice * PRECISION.basisPoints >= row.stake * PROTOCOL.maxRelayFeeBps) return null
    input.verifyRow?.(i)
    if ((row.basis + row.stake) * PRECISION.basisPoints > (row.balance + row.basis) * row.rate) return null
    remainingFee -= slice
    const units = unitsFor(row.stake - slice, supply, value)
    if (row.skin > skin) skin = row.skin
    minted += units
    return { slice, units }
  })
  let masterSlice = 0n
  let billed = 0n
  let contributed = 0n
  if (masterLeg > 0n) {
    masterSlice = remainingFee
    if (credit.value <= masterSlice) throw new CompactContractError('Fund__FeeUnfunded', [credit.value, masterSlice])
    billed = (masterSlice * credit.amount + credit.value - 1n) / credit.value
    if (credit.amount <= billed) throw new CompactContractError('Balance__ZeroAmount', [])
    contributed = unitsFor(credit.value - masterSlice, supply, value)
  }
  minted += contributed
  if (minted === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const masterUnits = input.masterUnits + contributed
  checkSkin(skin, active + minted, masterUnits)
  return { masterSlice, billed, contributed, rowList: planned, minted, skin, masterUnits }
}

export const priceOf = (value: bigint, supply: bigint): { numerator: bigint; denominator: bigint } => ({
  numerator: value + VIRTUAL_VALUE,
  denominator: supply + VIRTUAL_UNITS
})
