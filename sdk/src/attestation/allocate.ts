import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__AccountInitParams,
  IAllocate__AllocateIntent,
  IFundAccountLib__FundAccountInitParams
} from '@puppet/contracts/types'
import { type Address, encodePacked, type Hex, isAddressEqual, keccak256, type TypedDataDefinition } from 'viem'
import { predictPuppetAccount } from '../account/index.js'
import { CompactContractError } from '../compact/error.js'
import { sharesFor } from '../core/math.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDeployProof, type IDraftContext } from './shared.js'

export interface IAllocateRulePosition {
  puppet: Hex
  body: Hex
  mandate: Hex
}

export interface IAllocateInput extends IDeployProof {
  params: IAccountLib__AccountInitParams
  fundParams: IFundAccountLib__FundAccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  masterAmount: bigint
  puppetList: Address[]
  allocatedAmountList: bigint[]
}

interface IAllocateAttestContext extends IDraftContext {
  currentBlock: bigint
  totalShareSupply: bigint
  seeded: boolean
  liquidationRate: bigint
  poolWeight: bigint
  positions: readonly IAllocateRulePosition[]
}

export function attestAllocateIntent(ctx: IAllocateAttestContext, input: IAllocateInput) {
  const totalAllocated = input.allocatedAmountList.reduce((sum, a) => sum + a, 0n)
  IntentLib.verifyCommonIntent(ctx, {
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    baseToken: input.fundParams.baseToken,
    lookupChain: HUB_CHAIN_ID,
    capAmount: input.masterAmount + totalAllocated,
    acceptableRelayFee: input.acceptableRelayFee
  })

  if (input.acceptableNetAssetValue === 0n) throw new CompactContractError('Allocate__ZeroAcceptableNav', [])
  if (ctx.liquidationRate !== 0n) throw new CompactContractError('Share__FundLiquidated', [])
  const derivedMaster = predictPuppetAccount(input.params)
  if (!isAddressEqual(derivedMaster, input.fundParams.master)) {
    throw new CompactContractError('Share__MasterMismatch', [derivedMaster, input.fundParams.master])
  }
  const n = input.puppetList.length
  if (input.allocatedAmountList.length !== n) {
    throw new CompactContractError('Allocate__ListLengthMismatch', [BigInt(n), BigInt(n), BigInt(n)])
  }

  if (ctx.totalShareSupply === 0n && ctx.seeded && ctx.poolWeight > 0n)
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
    const ownerNewShares = sharesFor(ctx.totalShareSupply, input.acceptableNetAssetValue, input.masterAmount)
    if (ownerNewShares === 0n) effectiveMasterAmount = 0n
  }

  if (effectiveMasterAmount === 0n && totalAllocated === 0n) {
    throw new CompactContractError('Allocate__ZeroAmount', [])
  }
  IntentLib.verifyRelayFee(input.acceptableRelayFee, effectiveMasterAmount + totalAllocated)

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

  const intent: IAllocate__AllocateIntent = {
    params: input.params,
    blockNumber: input.blockNumber,
    deadline: input.deadline,
    acceptableRelayFee: input.acceptableRelayFee,
    nonce: input.nonce,
    chainId: BigInt(ctx.chainId),
    fundParams: input.fundParams,
    acceptableNetAssetValue: input.acceptableNetAssetValue,
    totalShareSupply: input.totalShareSupply,
    masterAmount: input.masterAmount,
    puppetList: input.puppetList,
    allocatedAmountList: input.allocatedAmountList
  }

  const { puppetList, allocatedAmountList, ...rest } = intent
  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.allocate,
    message: {
      ...rest,
      puppetListHash: keccak256(encodePacked(['address[]'], [puppetList])),
      allocatedAmountListHash: keccak256(encodePacked(['uint256[]'], [allocatedAmountList]))
    }
  }
  return { intent, typedData, args: [intent, bodyList, mandateList] }
}
