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
  allocatedAmountList: bigint[]
  totalAllocated: bigint
}

// The MAXIMUM a master may pull from this puppet, from the puppet's consented rule (allocationRate/symmetry/rateLimit/
// exitFreeze) against its LIVE signed balance. The contract enforces only rateLimit + the signed-balance floor, so this
// is the sole enforcement of the % rate + symmetry + exit-freeze. Shared verbatim by the builder (resolveAmount) and the
// matchmaker's co-sign check so the two can never drift. Excludes the throttle/open-redeem gates and the shares-rounding
// collapse (those only ever zero the amount and are gated separately), keeping it a sound UPPER bound to verify against.
export function permittedAllocationCap(
  body: Hex,
  p: { signedBalance: bigint; masterAmount: bigint; totalShareSupply: bigint; queuedShares: bigint }
): bigint {
  const rule = decodeRuleBody(body)
  let amount = (p.signedBalance * rule.allocationRate) / RATE_PRECISION
  // Legacy boolean-era rules stored symmetry as 1n ("on"); read that as 100%, not a 0.01% cap.
  const symmetry = rule.symmetry === 1n ? RATE_PRECISION : rule.symmetry
  if (symmetry !== 0n) {
    const masterCap = (p.masterAmount * symmetry) / RATE_PRECISION
    if (amount > masterCap) amount = masterCap
  }
  if (rule.rateLimit !== 0n && amount > rule.rateLimit) amount = rule.rateLimit
  if (rule.exitFreeze > 0n) {
    const redeemRatio = p.totalShareSupply === 0n ? 0n : (p.queuedShares * RATE_PRECISION) / p.totalShareSupply
    amount = redeemRatio >= rule.exitFreeze ? 0n : (amount * (rule.exitFreeze - redeemRatio)) / rule.exitFreeze
  }
  if (amount > p.signedBalance) amount = p.signedBalance
  return amount
}

function resolveAmount(ctx: IComputeAllocationContext, puppet: IAllocationPuppet): bigint {
  if (puppet.hasOpenRedeem) return 0n
  if (ctx.acceptableNetAssetValue === 0n) return 0n
  const rule = decodeRuleBody(puppet.body)
  if (BigInt(ctx.now) < BigInt(puppet.lastAllocatedAt) + rule.throttlePeriod) return 0n

  const amount = permittedAllocationCap(puppet.body, {
    signedBalance: puppet.signedBalance,
    masterAmount: ctx.masterAmount,
    totalShareSupply: ctx.totalShareSupply,
    queuedShares: ctx.queuedShares
  })
  if (amount === 0n) return 0n

  const shares = sharesFor(ctx.totalShareSupply, ctx.acceptableNetAssetValue, amount)
  return shares === 0n ? 0n : amount
}

export function computeAllocation(ctx: IComputeAllocationContext): IAllocationResult {
  const matched = ctx.puppets
    .map(puppet => ({ puppet, amount: resolveAmount(ctx, puppet) }))
    .filter(entry => entry.amount > 0n)
    .sort((a, b) => (BigInt(a.puppet.puppet) < BigInt(b.puppet.puppet) ? -1 : 1))

  const allocatedAmountList = matched.map(entry => entry.amount)
  return {
    puppetList: matched.map(entry => entry.puppet.puppet),
    bodyList: matched.map(entry => entry.puppet.body),
    mandateList: matched.map(entry => entry.puppet.mandate),
    allocatedAmountList,
    totalAllocated: allocatedAmountList.reduce((sum, amount) => sum + amount, 0n)
  }
}
