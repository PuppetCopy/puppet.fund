import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__AllocateIntent, IFundStore__Credit } from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, hexToBytes, isAddressEqual, type TypedDataDefinition, zeroAddress } from 'viem'
import { type IFundProfile, PALETTE_BYTES, PALETTE_SIZE, PROFILE_BYTES, predictShare, predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { type ChainId, deploymentAddress } from '../const/index.js'
import type { IEvaluationConfig, ISignerGain } from '../evaluate/types.js'
import { type IAllocatePlan, planAllocate, valuationOf } from '../pool/index.js'
import { dispatchGasLimit, MAX_TX_GAS } from '../state/fee.js'
import { symbolOf } from '../state/tokenRegistry.js'
import { verifyPricedDeadline } from './intentLib.js'
import { type IDraftContext, type IGenesisContext, intentTypedData, mandateDigest, verifyFundShare, verifyHeaderOrGenesis } from './shared.js'
import { type IEscrowCredit, type IFundState, openEscrowOf } from './terms.js'
import { type IValuationAudit, verifyPrice, verifyValuation } from './valuation.js'


interface IAllocatePuppetState {
  mandate: Hex
  epoch: bigint | null
  user: Address | null
  available: bigint
  held: bigint
  cost: bigint
  allocatedAt: bigint
}

interface IAllocateAttestContext extends IDraftContext, IGenesisContext {
  profile: IFundProfile | null
  fund: IFundState | null
  audit: IValuationAudit | null
  priceMark: bigint
  priceGain: ISignerGain
  config: IEvaluationConfig
  credit: IEscrowCredit | null
  credited: IFundStore__Credit | null
  released: IFundStore__Credit | null
  puppets: ReadonlyMap<Address, IAllocatePuppetState>
}

export async function attestAllocateIntent(
  ctx: IAllocateAttestContext,
  intent: IFund__AllocateIntent
): Promise<{ typedData: TypedDataDefinition; plan: IAllocatePlan }> {
  if (ctx.chainId !== HUB_CHAIN_ID) throw new CompactError('BAD_REQUEST', 'allocation rounds run on the hub chain only', 'hard')
  const master = getAddress(intent.header.account)
  const profile = ctx.profile
  const rows = intent.allocationList
  if (profile !== null) {
    const pixels = hexToBytes(profile.pixels)
    if (pixels.length !== PROFILE_BYTES) throw new CompactContractError('ShareToken__InvalidGrid', [BigInt(pixels.length)])
    const stray = pixels.findIndex((entry, at) => at >= PALETTE_BYTES && entry >= PALETTE_SIZE)
    if (stray !== -1) throw new CompactContractError('ShareToken__InvalidPixel', [BigInt(stray - PALETTE_BYTES), BigInt(pixels[stray]!)])
    if (ctx.account !== null) throw new CompactContractError('Account__AlreadyCreated', [])
    if (isAddressEqual(predictUserAccount(intent.header.user), master)) throw new CompactContractError('Account__NotDelegated', [master])
  }
  if (profile !== null) await verifyHeaderOrGenesis(ctx, intent.header, 'createFund')
  const fund =
    profile === null
      ? ctx.fund
      : {
          shareToken: predictShare(deploymentAddress('HubGate', HUB_CHAIN_ID), deploymentAddress('ShareToken', HUB_CHAIN_ID), profile, master),
          performanceFee: PROTOCOL.performanceFee,
          owner: predictUserAccount(intent.header.user),
          supply: 0n,
          masterShares: 0n,
          redemption: { id: 0n, fraction: 0, fee: 0n, masterPay: 0n, queued: 0n, owedLeft: 0n, potLeft: 0n, token: zeroAddress, price: 0n }
        }
  verifyFundShare(fund, master, intent.shareToken)
  if (BigInt(rows.length) > PROTOCOL.maxCohortSize) throw new CompactContractError('Gate__ListTooLong', [BigInt(rows.length), PROTOCOL.maxCohortSize])
  if (profile === null) await verifyHeaderOrGenesis(ctx, intent.header, 'allocate')
  verifyPricedDeadline(intent.header.deadline, ctx.now)
  const value = valuationOf(intent.valuation)
  const price = intent.price
  if (price.amount === 0n || price.value === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  if (!Object.values(HUB_CANONICAL_TOKEN).some(token => isAddressEqual(token, intent.token))) {
    throw new CompactContractError('Fund__TokenNotCanonical', [intent.token])
  }
  const weth = HUB_CANONICAL_TOKEN.WETH
  if (!isAddressEqual(intent.header.feeToken, weth)) throw new CompactContractError('Intent__FeeTokenMismatch', [intent.header.feeToken, weth])
  if (isAddressEqual(intent.token, weth) && price.amount !== price.value) throw new CompactContractError('Fund__UnitPriceMismatch', [price.amount, price.value])
  const credit = intent.credit
  const credited = ctx.credited
  if (credit.total > 0n) {
    const local = credit.chainId === BigInt(ctx.chainId)
    if (local && !isAddressEqual(credit.token, intent.token)) throw new CompactContractError('Fund__CreditTokenMismatch', [credit.token, intent.token])
    if (!local && symbolOf(Number(credit.chainId) as ChainId, credit.token) !== symbolOf(ctx.chainId, intent.token)) {
      throw new CompactError('BAD_REQUEST', `the round is in ${intent.token} but credits ${credit.token} on chain ${credit.chainId}, another asset`, 'hard')
    }
    const unread = new CompactError('BALANCE_UNREAD', `the escrow and credit book of ${credit.token} on chain ${credit.chainId} were not read`, 'soft')
    if (credited === null) throw unread
    if (credit.total <= credited.total) throw new CompactContractError('Fund__CreditNotIncreasing', [credited.total, credit.total])
    if (local) {
      if (ctx.credit === null) throw unread
      const amount = credit.total - credited.total
      if (amount > openEscrowOf(ctx.credit)) throw new CompactContractError('Balance__InsufficientBalance', [openEscrowOf(ctx.credit), amount])
    } else {
      if (ctx.released === null) throw unread
      if (ctx.released.total !== credit.total || ctx.released.feeTotal !== credit.feeTotal) {
        throw new CompactError(
          'CREDIT_NOT_SETTLED',
          `the round credits ${credit.total} of ${credit.token} with fees of ${credit.feeTotal}, but chain ${credit.chainId} released ${ctx.released.total} with fees of ${ctx.released.feeTotal} into ${master}; release that exact total there first`,
          'soft'
        )
      }
    }
  }

  verifyValuation('allocate', intent.valuation, ctx.audit)
  verifyPrice('allocate', price, ctx.priceMark, ctx.priceGain, ctx.config)

  for (const row of rows) {
    const puppet = getAddress(row.puppet)
    if (ctx.puppets.get(puppet) === undefined) {
      throw new CompactError('BALANCE_UNREAD', `the balance and holding of ${puppet} were not read`, 'soft')
    }
  }

  const rowList = rows.map(row => {
    const puppet = getAddress(row.puppet)
    const state = ctx.puppets.get(puppet)!
    if (state.user === null || state.epoch === null || !isAddressEqual(predictUserAccount(state.user), puppet)) {
      throw new CompactContractError('Fund__NotAccount', [puppet])
    }
    const mandated = state.mandate === mandateDigest(row.mandate, state.epoch) && row.mandate.expiry > intent.header.deadline
    if (!mandated) {
      throw new CompactError(
        'MANDATE_NOT_LIVE',
        `the mandate ${puppet} gave ${master} is revoked, replaced, signed before its account's last revoke, or expires by the round deadline ${intent.header.deadline}, so the round would skip it`,
        'hard'
      )
    }
    return {
      puppet,
      amount: row.amount,
      skin: row.mandate.skin,
      rate: row.mandate.allocationRate,
      exitCap: row.mandate.exitCap,
      cooldownPeriod: row.mandate.cooldownPeriod,
      balance: state.available,
      held: state.held,
      cost: state.cost,
      allocatedAt: state.allocatedAt,
      mandated
    }
  })
  const reserved = dispatchGasLimit(profile === null ? 'allocate' : 'createFund', ctx.account === null, BigInt(rows.length), 0n, 0n)
  if (reserved > MAX_TX_GAS) {
    throw new CompactError('ROUND_TOO_HEAVY', `the round reserves ${reserved} gas for ${rows.length} rows, above the ${MAX_TX_GAS} one transaction may use; name fewer rows`, 'hard')
  }
  const plan = planAllocate({
    now: ctx.now,
    owner: fund.owner,
    supply: fund.supply,
    redemption: fund.redemption,
    masterShares: fund.masterShares,
    value,
    fee: intent.header.fee,
    price,
    credit,
    credited,
    rowList
  })
  const skipped = plan.rowList.findIndex(row => row === null)
  if (skipped !== -1) {
    throw new CompactError(
      'ROW_WOULD_SKIP',
      `${rows[skipped]!.puppet} cannot fund its ${rows[skipped]!.amount} row now (balance, mandate signature, allocation rate, skin, exit cap, a value too small to carry its fee slice, or it is the fund's owner); a skipped row still divides the relay fee, so the round must name only rows it can fund`,
      'hard'
    )
  }
  return { typedData: intentTypedData('allocate', ctx.chainId, intent), plan }
}
