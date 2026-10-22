import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PRICE_PRECISION, PROTOCOL, VIRTUAL_SHARES, VIRTUAL_VALUE } from '@puppet/contracts/const'
import type { IFund__Asset, IFund__Credit, IFund__Position, IFund__Price, IFundStore__Credit, IFundStore__Holding, IFundStore__Redemption } from '@puppet/contracts/types'
import { type Address, isAddressEqual, zeroAddress } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { PRECISION } from '../const/common.js'
import { TOKEN_META } from '../const/network.js'

const UINT256_CEILING = 2n ** 256n

const ceilDiv = (a: bigint, b: bigint): bigint => (a === 0n ? 0n : (a - 1n) / b + 1n)

const word = (x: bigint): bigint => {
  if (x >= UINT256_CEILING) throw new CompactError('POOL_OVERFLOW', `${x} overflows uint256, so the chain would panic where this plans`, 'hard')
  return x
}

const mulDiv = (a: bigint, b: bigint, c: bigint): bigint => word((a * b) / c)

export const valueFor = (amount: bigint, price: IFund__Price): bigint => word((amount * price.value) / price.amount)

export const valuationOf = (valuation: {
  assetList: readonly Pick<IFund__Asset, 'value'>[]
  positionList: readonly Pick<IFund__Position, 'value'>[]
}): bigint =>
  word([...valuation.assetList, ...valuation.positionList].reduce((total, line) => word(total + line.value), 0n))

export const sharesFor = (value: bigint, supply: bigint, nav: bigint): bigint => word((value * (supply + VIRTUAL_SHARES)) / (nav + VIRTUAL_VALUE))

export const cashFor = (shares: bigint, supply: bigint, nav: bigint): bigint => word((shares * (nav + VIRTUAL_VALUE)) / (supply + VIRTUAL_SHARES))

export const isOpen = (redemption: Pick<IFundStore__Redemption, 'owedLeft' | 'masterPay'>): boolean => redemption.owedLeft > 0n || redemption.masterPay > 0n

export const exitingOf = (queued: bigint, supply: bigint): bigint => ceilDiv(queued * PRECISION.basisPoints, supply + VIRTUAL_SHARES)

export const profitFeeOf = (payout: bigint, cost: bigint, price: bigint, performanceFee: bigint): bigint =>
  cost < price ? mulDiv(payout, performanceFee * (price - cost), price * PRECISION.basisPoints) : 0n

export const POOL_SHARE = 10n ** BigInt(TOKEN_META.WETH.decimals + VIRTUAL_SHARES.toString().length - VIRTUAL_VALUE.toString().length)

export const performanceIndexOf = (nav: bigint, fund: { totalShares: bigint; averageCost: bigint }): bigint => {
  const price = cashFor(POOL_SHARE, fund.totalShares, nav)
  return fund.totalShares === 0n ? price : mulDiv(price, POOL_SHARE, fund.averageCost)
}

export const joinCapOf = (input: { supply: bigint; masterShares: bigint; queued: bigint }): bigint =>
  input.supply === input.masterShares ? input.masterShares : mulDiv(input.masterShares, input.queued, input.supply - input.masterShares)

export interface IAllocatePlan {
  rowList: ({ value: bigint; shares: bigint; cost: bigint } | null)[]
  slice: bigint
  billed: bigint
  masterBilled: bigint
  creditValue: bigint
  contributed: bigint
  minted: bigint
  masterShares: bigint
}

export interface IAllocateRow {
  puppet: Address
  amount: bigint
  skin: bigint
  rate: bigint
  exitCap: bigint
  cooldownPeriod: bigint
  balance: bigint
  held: bigint
  cost: bigint
  allocatedAt: bigint
  mandated: boolean
}

export function planAllocate(input: {
  now: bigint
  owner: Address
  supply: bigint
  redemption: Pick<IFundStore__Redemption, 'id' | 'queued' | 'owedLeft' | 'masterPay'>
  masterShares: bigint
  value: bigint
  fee: bigint
  price: IFund__Price
  credit: Pick<IFund__Credit, 'chainId' | 'total' | 'feeTotal'>
  credited: IFundStore__Credit | null
  rowList: readonly IAllocateRow[]
}): IAllocatePlan {
  const { value, price, credit, rowList, redemption } = input
  if (price.amount === 0n || price.value === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const supply = input.supply
  if (isOpen(redemption)) throw new CompactContractError('Redeem__Open', [redemption.id])
  const exiting = exitingOf(redemption.queued, supply)
  const masterLeg = credit.total > 0n ? 1n : 0n
  const legs = BigInt(rowList.length) + masterLeg
  if (legs === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const slice = input.fee / legs
  let masterBilled = 0n
  let creditValue = 0n
  let contributed = 0n
  const existing = supply === 0n ? mulDiv(value, VIRTUAL_SHARES, VIRTUAL_VALUE) : 0n
  if (masterLeg > 0n) {
    const credited = input.credited
    if (credited === null) throw new Error('a credit leg plans against the credit book it adds to, and none was read')
    if (credit.total <= credited.total) throw new CompactContractError('Fund__CreditNotIncreasing', [credited.total, credit.total])
    const amount = credit.total - credited.total
    const masterSlice = mulDiv(slice, price.amount, price.value)
    const local = credit.chainId === BigInt(HUB_CHAIN_ID)
    if (local ? credit.feeTotal !== credited.feeTotal + masterSlice : credit.feeTotal < credited.feeTotal + masterSlice) {
      throw new CompactContractError('Fund__CreditFeeMismatch', [credit.feeTotal, credited.feeTotal + masterSlice])
    }
    masterBilled = credit.feeTotal - credited.feeTotal
    if (word(masterBilled * PRECISION.basisPoints) > word(amount * PROTOCOL.maxRelayFeeBps)) {
      throw new CompactContractError('Intent__RelayFeeRatioExceeded', [masterBilled, amount, PROTOCOL.maxRelayFeeBps])
    }
    creditValue = valueFor(amount, price)
    const extraValue = valueFor(masterBilled - masterSlice, price)
    if (creditValue < slice + extraValue) {
      throw new CompactError('POOL_OVERFLOW', `a credit worth ${creditValue} cannot carry a fee slice of ${slice} and a release fee worth ${extraValue}, so the chain would panic where this plans`, 'hard')
    }
    contributed = sharesFor(creditValue - slice - extraValue, supply + existing, value)
  }
  const masterShares = input.masterShares + existing + contributed
  let minted = existing + contributed
  const planned = rowList.map((row, i) => {
    const prev = i === 0 ? zeroAddress : rowList[i - 1]!.puppet
    if (BigInt(row.puppet) <= BigInt(prev)) throw new CompactContractError('Fund__AllocationListNotSorted', [prev, row.puppet])
    if (isAddressEqual(row.puppet, input.owner)) return null
    const rowValue = valueFor(row.amount, price)
    if (word(slice * PRECISION.basisPoints) >= word(rowValue * PROTOCOL.maxRelayFeeBps) || !row.mandated) return null
    if (row.allocatedAt > 0n && input.now - row.allocatedAt < row.cooldownPeriod) {
      throw new CompactContractError('Mandate__Cooldown', [row.puppet, row.allocatedAt, row.cooldownPeriod])
    }
    const open = row.exitCap > exiting ? row.exitCap - exiting : 0n
    if (word(row.amount * PRECISION.basisPoints) > word(row.balance * row.rate)) return null
    const rateRoom = word(valueFor(row.balance, price) * row.rate)
    if (open === 0n || word(rowValue * PRECISION.basisPoints * row.exitCap) > word(rateRoom * open)) return null
    const shares = sharesFor(rowValue - slice, supply + existing, value)
    if (shares === 0n) return null
    if (row.skin > 0n) {
      const skinRoom = word(masterShares * row.skin)
      const held = word(row.held * PRECISION.basisPoints)
      if (skinRoom < held || word(shares * PRECISION.basisPoints * row.exitCap) > word((skinRoom - held) * open)) return null
    }
    const cost = word(row.cost * row.held + (rowValue - slice) * PRICE_PRECISION) / (row.held + shares)
    if (cost >= 2n ** 80n) throw new CompactError('POOL_OVERFLOW', `a cost of ${cost} overflows the holding's uint80, so the chain would revert the round`, 'hard')
    minted += shares
    return { value: rowValue, shares, cost }
  })
  const included = BigInt(planned.filter(row => row !== null).length)
  const billed = (slice * included * price.amount) / price.value
  if (minted === existing) throw new CompactContractError('Balance__ZeroAmount', [])
  return { rowList: planned, slice, billed, masterBilled, creditValue, contributed, minted, masterShares }
}

export const payoutLineOf = (assetList: readonly IFund__Asset[], token: Address): IFund__Asset | null =>
  assetList.find(asset => asset.chainId === BigInt(HUB_CHAIN_ID) && isAddressEqual(asset.token, token) && asset.id === 0n && asset.amount > 0n) ?? null

export interface IRedeemPlan {
  redemption: IFundStore__Redemption
  rate: IFund__Price
  cash: bigint
  supply: bigint
  masterShares: bigint
  active: bigint
  masterPart: bigint
  full: boolean
  nav: bigint
  base: bigint
  burnBudget: bigint
  wrap: bigint
}

export function planRedeem(input: {
  supply: bigint
  masterBalance: bigint
  redemption: Pick<IFundStore__Redemption, 'id' | 'queued' | 'owedLeft' | 'masterPay'>
  fraction: bigint
  join: bigint
  valuation: bigint
  token: Address
  price: IFund__Price | null
  held: bigint
  native: bigint
  fee: bigint
}): IRedeemPlan {
  const wrappable = isAddressEqual(input.token, HUB_CANONICAL_TOKEN.WETH)
  const rate = wrappable ? { amount: 1n, value: 1n } : input.price
  if (rate === null || rate.amount === 0n || rate.value === 0n) throw new CompactContractError('Redeem__TokenUnpriced', [input.token])
  const prior = input.redemption
  if (isOpen(prior)) throw new CompactContractError('Redeem__Open', [prior.id])
  const supply = input.supply
  const masterShares = input.masterBalance
  const queued = prior.queued
  const active = supply - masterShares - queued
  const { fraction, join } = input
  if (fraction > PRECISION.basisPoints || (fraction > 0n && join > 0n)) throw new CompactContractError('Redeem__InvalidMode', [fraction, join])
  if (join > masterShares) throw new CompactContractError('Fund__InsufficientShares', [masterShares, join])
  const joinCap = joinCapOf({ supply, masterShares, queued })
  if (join > joinCap) throw new CompactContractError('Redeem__JoinAboveSymmetry', [join, joinCap])
  const masterPart = fraction > 0n ? mulDiv(masterShares, fraction, PRECISION.basisPoints) : join
  const owed = word(queued * PRECISION.basisPoints + active * fraction)
  if (owed + masterPart === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const cash = wrappable ? input.held + input.native : input.held
  const full = word(owed + masterPart * PRECISION.basisPoints) === word(supply * PRECISION.basisPoints)
  const worth = mulDiv(input.valuation, rate.amount, rate.value)
  if (full && worth > cash) throw new CompactContractError('Balance__InsufficientFund', [input.token, cash, worth])
  const nav = full ? cash : mulDiv(input.valuation + VIRTUAL_VALUE, rate.amount, rate.value)
  const base = full ? supply : supply + VIRTUAL_SHARES
  const pot = mulDiv(owed, nav, base * PRECISION.basisPoints)
  const masterPay = full ? cash - pot : mulDiv(masterPart, nav, base)
  if (pot + masterPay > cash) throw new CompactContractError('Balance__InsufficientFund', [input.token, cash, pot + masterPay])
  if (pot + masterPay < input.fee) throw new CompactContractError('Redeem__Dust', [pot + masterPay, input.fee])
  if (!full && masterPart > 0n && owed > 0n && pot <= input.fee) throw new CompactContractError('Redeem__Dust', [pot, input.fee])
  return {
    redemption: {
      id: prior.id + 1n,
      fraction: Number(fraction),
      fee: input.fee,
      masterPay,
      queued,
      owedLeft: owed,
      potLeft: pot,
      token: input.token,
      price: mulDiv(full ? mulDiv(cash, rate.value, rate.amount) : input.valuation + VIRTUAL_VALUE, PRICE_PRECISION, base)
    },
    rate,
    cash,
    supply,
    masterShares,
    active,
    masterPart,
    full,
    nav,
    base,
    burnBudget: queued + mulDiv(active, fraction, PRECISION.basisPoints),
    wrap: wrappable && pot + masterPay > input.held ? pot + masterPay - input.held : 0n
  }
}

export const claimOf = (holding: Pick<IFundStore__Holding, 'queued'>, balance: bigint, fraction: number): bigint =>
  word(holding.queued * PRECISION.basisPoints + (balance - holding.queued) * BigInt(fraction))

export interface ISettledHolder {
  holder: Address
  queued: bigint
  burned: bigint
  claim: bigint
  payout: bigint
  profitFee: bigint
  protocolCut: bigint
  fee: bigint
  cut: boolean
  refused: boolean
  holding: IFundStore__Holding
  redemption: IFundStore__Redemption
}

export interface ICohortPlan {
  settled: ISettledHolder[]
  protocolFees: bigint
  cut: bigint
  masterPayout: bigint
  closeOut: boolean
  redemption: IFundStore__Redemption
}

export function planCohort(input: {
  master: Address
  redemption: IFundStore__Redemption
  performanceFee: bigint
  protocolFeeShare: bigint
  holders: readonly { holder: Address; balance: bigint; holding: IFundStore__Holding; refused: boolean }[]
}): ICohortPlan {
  const redemption = { ...input.redemption }
  const settled: ISettledHolder[] = []
  let protocolFees = 0n
  let cut = 0n
  for (const row of input.holders) {
    if (redemption.potLeft <= redemption.fee) break
    if (isAddressEqual(row.holder, input.master)) throw new CompactContractError('Fund__NotHolder', [row.holder])
    if (settled.some(s => isAddressEqual(s.holder, row.holder)) || BigInt(row.holding.redeemedAt) === redemption.id) continue
    const queued = row.holding.queued
    const free = row.balance - queued
    const claim = word(queued * PRECISION.basisPoints + free * BigInt(redemption.fraction))
    if (claim === 0n) continue
    const payout = mulDiv(redemption.potLeft, claim, redemption.owedLeft)
    const profitFee = profitFeeOf(payout, row.holding.cost, redemption.price, input.performanceFee)
    redemption.potLeft -= payout
    redemption.owedLeft -= claim
    if (payout - profitFee <= redemption.fee || row.refused) {
      cut += payout
      settled.push({
        holder: row.holder,
        queued: 0n,
        burned: 0n,
        claim,
        payout,
        profitFee: 0n,
        protocolCut: 0n,
        fee: 0n,
        cut: true,
        refused: payout - profitFee > redemption.fee,
        holding: { ...row.holding, redeemedAt: Number(redemption.id) },
        redemption: { ...redemption }
      })
      continue
    }
    const burned = mulDiv(free, BigInt(redemption.fraction), PRECISION.basisPoints)
    const protocolCut = mulDiv(profitFee, input.protocolFeeShare, PRECISION.basisPoints)
    redemption.queued -= queued
    redemption.masterPay += profitFee - protocolCut
    if (redemption.masterPay >= 2n ** 96n) throw new CompactError('POOL_OVERFLOW', `a master pay of ${redemption.masterPay} overflows uint96, so the chain would revert the cohort`, 'hard')
    protocolFees += protocolCut
    settled.push({
      holder: row.holder,
      queued,
      burned,
      claim,
      payout,
      profitFee,
      protocolCut,
      fee: redemption.fee,
      cut: false,
      refused: false,
      holding: { ...row.holding, queued: 0n, redeemedAt: Number(redemption.id) },
      redemption: { ...redemption }
    })
  }
  if (redemption.owedLeft > 0n && redemption.potLeft <= redemption.fee) {
    cut += redemption.potLeft
    redemption.owedLeft = 0n
    redemption.potLeft = 0n
  }
  const closeOut = redemption.owedLeft === 0n && (input.redemption.owedLeft > 0n || redemption.masterPay > 0n)
  const masterPayout = closeOut ? redemption.masterPay : 0n
  if (closeOut) redemption.masterPay = 0n
  return { settled, protocolFees, cut, masterPayout, closeOut, redemption }
}

export interface ISellPlan {
  queued: bigint
  burned: bigint
  payout: bigint
  profitFee: bigint
  protocolCut: bigint
  holding: IFundStore__Holding
  redemption: IFundStore__Redemption
  balance: bigint
}

export function planSell(input: {
  redemption: IFundStore__Redemption
  holding: IFundStore__Holding
  balance: bigint
  shares: bigint
  performanceFee: bigint
  protocolFeeShare: bigint
}): ISellPlan {
  if (input.shares === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const redemption = { ...input.redemption }
  const holding = { ...input.holding }
  let balance = input.balance
  let queued = 0n
  let burned = 0n
  let payout = 0n
  let profitFee = 0n
  let protocolCut = 0n
  if (redemption.owedLeft > 0n && BigInt(holding.redeemedAt) !== redemption.id) {
    queued = holding.queued
    burned = mulDiv(balance - queued, BigInt(redemption.fraction), PRECISION.basisPoints)
    const claim = word(queued * PRECISION.basisPoints + (balance - queued) * BigInt(redemption.fraction))
    balance -= queued + burned
    payout = mulDiv(redemption.potLeft, claim, redemption.owedLeft)
    profitFee = profitFeeOf(payout, holding.cost, redemption.price, input.performanceFee)
    protocolCut = mulDiv(profitFee, input.protocolFeeShare, PRECISION.basisPoints)
    redemption.potLeft -= payout
    redemption.owedLeft -= claim
    redemption.queued -= queued
    redemption.masterPay += profitFee - protocolCut
    if (redemption.masterPay >= 2n ** 96n) throw new CompactError('POOL_OVERFLOW', `a master pay of ${redemption.masterPay} overflows uint96, so the chain would revert the sell`, 'hard')
    holding.queued = 0n
    holding.redeemedAt = Number(redemption.id)
  }
  if (balance - holding.queued < input.shares) throw new CompactContractError('Fund__InsufficientShares', [balance - holding.queued, input.shares])
  holding.queued += input.shares
  if (holding.queued >= 2n ** 96n) throw new CompactError('POOL_OVERFLOW', `a queue of ${holding.queued} overflows the holding's uint96, so the chain would revert the sell`, 'hard')
  redemption.queued += input.shares
  return { queued, burned, payout, profitFee, protocolCut, holding, redemption, balance }
}

export const POOL_SOURCE: string = [ceilDiv, word, mulDiv, profitFeeOf, performanceIndexOf, joinCapOf, planAllocate, planRedeem, planCohort, planSell]
  .map(f => f.toString())
  .join('\n')
  .concat(`\n${VIRTUAL_SHARES}${VIRTUAL_VALUE}${PRICE_PRECISION}`)
