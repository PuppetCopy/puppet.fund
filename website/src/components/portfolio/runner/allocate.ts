import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { computeAllocation, type IAllocateInput } from '@puppet/sdk/attestation'
import { assertNavSignable, composeCashLeg, composeHoldings, evaluateAccountNav } from '@puppet/sdk/evaluate'
import type { IChainLiveness, ISubaccountState, ITokenRegistryMap } from '@puppet/sdk/state'
import type { Address, } from 'viem'
import { getRate } from '../../../io/context.js'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../../io/datastore/query.js'
import { readSubaccountState } from '../../../io/datastore/walletState.js'
import { gmxClaimableProvider, gmxOrderProvider, gmxPositionProvider } from '../../../io/gmx/navProviders.js'
import type { IAllocateDraft } from '../draft.js'
import { type ExecContext, resolveRelayFee, stepMetadata } from './_shared.js'

export interface IGatheredAllocation {
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  matched: ReturnType<typeof computeAllocation>
  totalPuppets: number
}

export async function gatherMatched(
  registry: ITokenRegistryMap,
  chainLiveness: IChainLiveness,
  fund: Address,
  baseToken: Address,
  masterAmount: bigint,
  subaccount?: ISubaccountState
): Promise<IGatheredAllocation> {
  const [puppets, pool] = await Promise.all([
    fetchMasterSubscribers(fund, baseToken),
    fetchMasterPoolState(fund)
  ])

  const totalShareSupply = pool?.totalShareSupply ?? 0n
  const queuedShares = pool?.queuedShares ?? 0n
  let acceptableNetAssetValue: bigint
  if (totalShareSupply > 0n) {
    const sub = subaccount ?? (await readSubaccountState(registry, fund))
    if (!sub) throw new Error(`fund ${fund} state unavailable for allocate NAV`)
    const allocateEval = await evaluateAccountNav({
      master: fund,
      baseToken,
      kind: 'allocate',
      cashLeg: composeCashLeg(sub, chainLiveness, baseToken),
      holdings: composeHoldings(sub, baseToken),
      getRate,
      positions: await gmxPositionProvider(fund, baseToken),
      orders: await gmxOrderProvider(fund),
      claimables: await gmxClaimableProvider(fund)
    })
    assertNavSignable(allocateEval.gate)
    acceptableNetAssetValue = allocateEval.navSigned
  } else {
    acceptableNetAssetValue = masterAmount > 0n ? masterAmount : 1n
  }

  const matched = computeAllocation({
    masterAmount,
    acceptableNetAssetValue,
    totalShareSupply,
    queuedShares,
    now: Math.floor(Date.now() / 1000),
    puppets
  })

  return { acceptableNetAssetValue, totalShareSupply, matched, totalPuppets: puppets.length }
}

export async function buildAllocateInput(draft: IAllocateDraft, ctx: ExecContext): Promise<IAllocateInput> {
  const params = { user: ctx.wallet.address, signer: ctx.session.signer }
  const fundParams = { master: predictPuppetAccount(params), baseToken: draft.baseToken, name: draft.name }
  const fund = predictFundAccount(fundParams)

  const gathered = await gatherMatched(
    ctx.tokenRegistry,
    ctx.chainLiveness,
    fund,
    draft.baseToken,
    draft.masterAmount
  )
  const acceptableRelayFee = await resolveRelayFee(
    ctx,
    HUB_CHAIN_ID,
    'HubGate',
    'allocate',
    draft.baseToken,
    BigInt(gathered.matched.puppetList.length)
  )

  return {
    params,
    fundParams,
    ...stepMetadata(ctx),
    acceptableRelayFee,
    acceptableNetAssetValue: gathered.acceptableNetAssetValue,
    totalShareSupply: gathered.totalShareSupply,
    masterAmount: draft.masterAmount,
    puppetList: gathered.matched.puppetList,
    allocatedAmountList: gathered.matched.allocatedAmountList,
    userDeploySig: ctx.session.bindSig,
    userSignerProof: ctx.session.signerProof
  }
}
