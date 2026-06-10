import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import {
  computeAllocation,
  type IAllocateInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import { evaluateAccountNav } from '@puppet/sdk/evaluation'
import {
  getAcceptableRelayFee,
  getSubaccountState,
  type IndexerHealth,
  type ISubaccountState,
  indexerBlock,
  randomNonce
} from '@puppet/sdk/state'
import { type Address, type Hex, isAddressEqual } from 'viem'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../../io/indexer/query.js'
import { homePublicClient } from '../../../wallet/index.js'
import type { IAllocateDraft } from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext } from './_shared.js'

export interface IGatheredAllocation {
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  matched: ReturnType<typeof computeAllocation>
  totalPuppets: number
}

export async function gatherMatched(
  sql: Parameters<typeof evaluateAccountNav>[0],
  indexerHealth: IndexerHealth,
  fund: Address,
  baseToken: Address,
  baseTokenId: Hex,
  masterAmount: bigint,
  subaccount?: ISubaccountState
): Promise<IGatheredAllocation> {
  const [puppets, pool] = await Promise.all([fetchMasterSubscribers(fund), fetchMasterPoolState(fund)])

  const totalShareSupply = pool?.totalShareSupply ?? 0n
  const queuedShares = pool?.queuedShares ?? 0n
  const acceptableNetAssetValue =
    totalShareSupply > 0n
      ? (
          await evaluateAccountNav(sql, {
            master: fund,
            baseToken,
            baseTokenId,
            health: indexerHealth,
            kind: 'allocate',
            subaccount
          })
        ).navSigned
      : masterAmount > 0n
        ? masterAmount
        : 1n

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
  const fund = await getSubaccountState(ctx.sql, draft.master)
  const master = fund?.signer ?? predictPuppetAccount({ user: ctx.wallet.address, signer: ctx.session.signer })
  if (!fund && !isAddressEqual(predictFundAccount(master), draft.master)) {
    throw new Error(`fund ${draft.master} not in indexer and not derivable from the active session`)
  }

  const gathered = await gatherMatched(
    ctx.sql,
    ctx.indexerHealth,
    draft.master,
    draft.baseToken,
    draft.baseTokenId,
    draft.masterAmount,
    fund
  )
  const blockNumber = indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(undefined)))
  const acceptableRelayFee = await getAcceptableRelayFee(
    ctx.gasPrice,
    'HubGate',
    'allocate',
    draft.baseToken,
    homePublicClient
  )

  return {
    master,
    baseTokenId: draft.baseTokenId,
    name: draft.name,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    acceptableNetAssetValue: gathered.acceptableNetAssetValue,
    totalShareSupply: gathered.totalShareSupply,
    masterAmount: draft.masterAmount,
    puppetList: gathered.matched.puppetList,
    matchedAmountList: gathered.matched.matchedAmountList
  }
}
