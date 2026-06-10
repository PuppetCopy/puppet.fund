import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IAllocateModule__AllocateIntent,
  IShareLib__ShareInitParams
} from '@puppet/contracts/types'
import { type Address, encodePacked, type Hex, isAddressEqual, keccak256, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

export interface IAllocateRulePosition {
  puppet: Hex
  body: Hex
  mandate: Hex
}

export interface IAllocateInput {
  params: IAccountLib__AccountInitParams
  share: IShareLib__ShareInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  masterAmount: bigint
  puppetList: Address[]
  matchedAmountList: bigint[]
}

export interface IAllocateAttestContext extends IDraftContext {
  currentBlock: bigint
  totalShareSupply: bigint
  seeded: boolean
  poolTotalStake: bigint
  positions: readonly IAllocateRulePosition[]
}

export function attestAllocateIntent(ctx: IAllocateAttestContext, input: IAllocateInput) {
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseTokenId: input.share.baseTokenId,
    lookupChain: HUB_CHAIN_ID,
    capAmount: input.masterAmount,
    acceptableRelayFee: input.acceptableRelayFee
  })

  if (input.acceptableNetAssetValue === 0n) throw new CompactContractError('Allocate__ZeroAcceptableNav', [])
  const derivedMaster = predictPuppetAccount(input.params)
  if (!isAddressEqual(derivedMaster, input.share.master)) {
    throw new CompactContractError('Share__MasterMismatch', [derivedMaster, input.share.master])
  }
  const n = input.puppetList.length
  if (input.matchedAmountList.length !== n) {
    throw new CompactContractError('Allocate__ListLengthMismatch', [BigInt(n), BigInt(n), BigInt(n)])
  }

  if (ctx.totalShareSupply === 0n && ctx.seeded && ctx.poolTotalStake > 0n)
    throw new CompactContractError('Share__Empty', [])

  if (ctx.totalShareSupply !== input.totalShareSupply) {
    throw new CompactContractError('Allocate__PreMintSupplyMismatch', [ctx.totalShareSupply, input.totalShareSupply])
  }

  for (let i = 1; i < n; i++) {
    const prev = input.puppetList[i - 1]!
    const curr = input.puppetList[i]!
    if (BigInt(curr) <= BigInt(prev)) throw new CompactContractError('Allocate__PuppetListNotSorted', [prev, curr])
  }

  let effectiveMasterAmount = input.masterAmount
  if (input.masterAmount > 0n) {
    const ownerNewShares =
      ctx.totalShareSupply === 0n
        ? input.masterAmount
        : (input.masterAmount * ctx.totalShareSupply) / input.acceptableNetAssetValue
    if (ownerNewShares === 0n) effectiveMasterAmount = 0n
  }

  const totalMatched = input.matchedAmountList.reduce((sum, a) => sum + a, 0n)
  if (effectiveMasterAmount === 0n && totalMatched === 0n) {
    throw new CompactContractError('Allocate__ZeroAmount', [])
  }
  IntentLib.verifyRelayFee(input.acceptableRelayFee, effectiveMasterAmount + totalMatched)

  const byPuppet = new Map<string, { body: Hex; mandate: Hex }>()
  for (const row of ctx.positions) {
    byPuppet.set(row.puppet.toLowerCase(), { body: row.body, mandate: row.mandate })
  }
  const bodyList: Hex[] = []
  const mandateList: Hex[] = []
  for (let i = 0; i < input.puppetList.length; i++) {
    const found = byPuppet.get(input.puppetList[i]!.toLowerCase())
    bodyList.push(found?.body ?? ('0x' as Hex))
    mandateList.push(found?.mandate ?? ('0x' as Hex))
  }

  const intent: IAllocateModule__AllocateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    share: input.share,
    acceptableNetAssetValue: input.acceptableNetAssetValue,
    totalShareSupply: input.totalShareSupply,
    masterAmount: input.masterAmount,
    puppetList: input.puppetList,
    matchedAmountList: input.matchedAmountList
  }

  const { puppetList, matchedAmountList, ...rest } = intent
  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.allocate,
    message: {
      ...rest,
      puppetListHash: keccak256(encodePacked(['address[]'], [puppetList])),
      matchedAmountListHash: keccak256(encodePacked(['uint256[]'], [matchedAmountList]))
    }
  }
  return { intent, typedData, args: [intent, bodyList, mandateList] }
}
