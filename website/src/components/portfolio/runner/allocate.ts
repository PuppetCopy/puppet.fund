import { EMPTY_NAME } from '@puppet/sdk/account'
import {
  computeAllocation,
  type IAllocateInput,
  type ICreateMasterInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { getAcceptableRelayFee, getSubaccountState, indexerBlock, randomNonce } from '@puppet/sdk/state'
import type { Address } from 'viem'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../../io/indexer/query.js'
import { homePublicClient } from '../../../wallet/index.js'
import type { IAllocateDraft, ICreateMasterDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

async function gatherMatched(
  ctx: ExecContext,
  master: Address,
  baseToken: Address,
  masterAmount: bigint
): Promise<{
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  puppetList: Address[]
  matchedAmountList: bigint[]
}> {
  const [puppets, pool] = await Promise.all([fetchMasterSubscribers(master), fetchMasterPoolState(master)])

  const totalShareSupply = pool?.totalShareSupply ?? 0n
  const queuedShares = pool?.queuedShares ?? 0n
  const acceptableNetAssetValue = totalShareSupply > 0n ? totalShareSupply : masterAmount > 0n ? masterAmount : 1n

  const matched = computeAllocation({
    masterAmount,
    acceptableNetAssetValue,
    totalShareSupply,
    queuedShares,
    now: Math.floor(Date.now() / 1000),
    puppets
  })

  return {
    acceptableNetAssetValue,
    totalShareSupply,
    puppetList: matched.puppetList,
    matchedAmountList: matched.matchedAmountList
  }
}

export async function buildCreateMasterInput(draft: ICreateMasterDraft, ctx: ExecContext): Promise<ICreateMasterInput> {
  const matched = await gatherMatched(ctx, draft.master, draft.baseToken, draft.masterAmount)
  const blockNumber = indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined)))
  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'createMaster',
    draft.baseToken,
    homePublicClient
  )

  return {
    params: draft.params,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    acceptableNetAssetValue: matched.acceptableNetAssetValue,
    masterAmount: draft.masterAmount,
    puppetList: matched.puppetList,
    matchedAmountList: matched.matchedAmountList,
    userDeploySig: '0x',
    userSignerProof: '0x'
  }
}

export async function buildAllocateInput(draft: IAllocateDraft, ctx: ExecContext): Promise<IAllocateInput> {
  const master = await getSubaccountState(ctx.sql, draft.master)
  if (!master) throw new Error(`master ${draft.master} not in indexer`)
  const params = {
    user: master.user,
    name: EMPTY_NAME,
    baseTokenId: master.baseTokenId,
    signer: master.signer
  }

  const matched = await gatherMatched(ctx, master.account, draft.baseToken, draft.masterAmount)
  const blockNumber = indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined)))
  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'allocate',
    draft.baseToken,
    homePublicClient
  )

  return {
    params,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    acceptableNetAssetValue: matched.acceptableNetAssetValue,
    totalShareSupply: matched.totalShareSupply,
    masterAmount: draft.masterAmount,
    puppetList: matched.puppetList,
    matchedAmountList: matched.matchedAmountList
  }
}
