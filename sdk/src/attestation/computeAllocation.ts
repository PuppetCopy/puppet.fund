import type { Address, Hex } from 'viem'
import { sharesFor } from '../core/math.js'
import { decodeRuleBody } from './rule.js'

const RATE_PRECISION = 10_000n

export interface IAllocationPuppet {
  puppet: Address
  body: Hex
  mandate: Hex
  signedBalance: bigint
  lastAllocatedAt: number
  hasOpenRedeem: boolean
}

export interface IComputeAllocationContext {
  masterAmount: bigint
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  queuedShares: bigint
  now: number
  puppets: readonly IAllocationPuppet[]
}

export interface IAllocationResult {
  puppetList: Address[]
  bodyList: Hex[]
  mandateList: Hex[]
  matchedAmountList: bigint[]
  totalMatched: bigint
}

function resolveAmount(ctx: IComputeAllocationContext, puppet: IAllocationPuppet): bigint {
  if (puppet.hasOpenRedeem) return 0n
  if (ctx.acceptableNetAssetValue === 0n) return 0n
  const rule = decodeRuleBody(puppet.body)
  if (BigInt(ctx.now) < BigInt(puppet.lastAllocatedAt) + rule.throttlePeriod) return 0n

  let amount = (puppet.signedBalance * rule.allocationRate) / RATE_PRECISION
  if (rule.symmetry !== 0n && amount > ctx.masterAmount) amount = ctx.masterAmount
  if (rule.rateLimit !== 0n && amount > rule.rateLimit) amount = rule.rateLimit

  if (rule.exitFreeze > 0n) {
    const redeemRatio = ctx.totalShareSupply === 0n ? 0n : (ctx.queuedShares * RATE_PRECISION) / ctx.totalShareSupply
    amount = redeemRatio >= rule.exitFreeze ? 0n : (amount * (rule.exitFreeze - redeemRatio)) / rule.exitFreeze
  }

  if (amount > puppet.signedBalance) amount = puppet.signedBalance
  if (amount === 0n) return 0n

  const shares = sharesFor(ctx.totalShareSupply, ctx.acceptableNetAssetValue, amount)
  return shares === 0n ? 0n : amount
}

export function computeAllocation(ctx: IComputeAllocationContext): IAllocationResult {
  const matched = ctx.puppets
    .map(puppet => ({ puppet, amount: resolveAmount(ctx, puppet) }))
    .filter(entry => entry.amount > 0n)
    .sort((a, b) => (BigInt(a.puppet.puppet) < BigInt(b.puppet.puppet) ? -1 : 1))

  const matchedAmountList = matched.map(entry => entry.amount)
  return {
    puppetList: matched.map(entry => entry.puppet.puppet),
    bodyList: matched.map(entry => entry.puppet.body),
    mandateList: matched.map(entry => entry.puppet.mandate),
    matchedAmountList,
    totalMatched: matchedAmountList.reduce((sum, amount) => sum + amount, 0n)
  }
}
