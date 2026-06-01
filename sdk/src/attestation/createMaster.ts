import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_INTENTS } from '@puppet/contracts/intents'
import type { IAccountLib__AccountInitParams, IAllocateModule__AllocateIntent } from '@puppet/contracts/types'
import { type Address, concat, type Hex, keccak256, type TypedDataDefinition, toHex } from 'viem'
import { CompactContractError } from '../compact/error.js'
import { CompactError } from '../compact/index.js'
import type { IAllocateRulePosition } from './allocate.js'
import * as IntentLib from './intentLib.js'
import { HUB_DOMAIN, type IDraftContext } from './shared.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

export interface ICreateMasterInput {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  acceptableNetAssetValue: bigint
  masterAmount: bigint
  puppetList: Address[]
  matchedAmountList: bigint[]
  userDeploySig: Hex
  userSignerProof: Hex
}

export interface ICreateMasterAttestContext extends IDraftContext {
  currentBlock: bigint
  transientRouteBalance: bigint
  positions: readonly IAllocateRulePosition[]
}

export function attestCreateMasterIntent(ctx: ICreateMasterAttestContext, input: ICreateMasterInput) {
  IntentLib.verifyTimeBounds(input.blockNumber, input.deadline, ctx.currentBlock)
  const baseToken = IntentLib.verifyTokenAndCap(
    ctx.tokenRegistry,
    HUB_CHAIN_ID,
    input.params.baseTokenId,
    input.masterAmount
  )
  if (input.params.user === ZERO_ADDRESS) throw new CompactContractError('Account__InvalidUser', [])
  if (input.params.baseTokenId === ZERO_BYTES32) throw new CompactContractError('Account__InvalidBaseTokenId', [])

  if (input.masterAmount > 0n && ctx.transientRouteBalance < input.masterAmount) {
    throw new CompactError(
      'TRANSIENT_ROUTE_UNDERFUNDED',
      `transient route balance ${ctx.transientRouteBalance} below masterAmount ${input.masterAmount}`
    )
  }

  if (input.acceptableNetAssetValue === 0n) throw new CompactContractError('Allocate__ZeroAcceptableNav', [])
  const n = input.puppetList.length
  if (input.matchedAmountList.length !== n) {
    throw new CompactContractError('Allocate__ListLengthMismatch', [BigInt(n), BigInt(n), BigInt(n)])
  }
  const totalMatched = input.matchedAmountList.reduce((sum, a) => sum + a, 0n)
  if (input.masterAmount === 0n && totalMatched === 0n) throw new CompactContractError('Allocate__ZeroAmount', [])

  for (let i = 1; i < n; i++) {
    const prev = input.puppetList[i - 1]!
    const curr = input.puppetList[i]!
    if (BigInt(curr) <= BigInt(prev)) throw new CompactContractError('Allocate__PuppetListNotSorted', [prev, curr])
  }
  IntentLib.verifyRelayFee(input.acceptableRelayFee, input.masterAmount + totalMatched)

  const byPuppet = new Map<string, { body: Hex; mandate: Hex }>()
  for (const row of ctx.positions) {
    byPuppet.set(row.puppet, { body: row.body, mandate: row.mandate })
  }
  const bodyList: Hex[] = []
  const mandateList: Hex[] = []
  for (let i = 0; i < input.puppetList.length; i++) {
    const found = byPuppet.get(input.puppetList[i]!.toLowerCase() as Hex)
    if (input.matchedAmountList[i] !== 0n && !found) {
      throw new CompactError(
        'SUBSCRIPTION_MISSING',
        `puppet ${input.puppetList[i]} has matchedAmount ${input.matchedAmountList[i]} but no standing-auth subscription`
      )
    }
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
    baseToken,
    acceptableNetAssetValue: input.acceptableNetAssetValue,
    totalShareSupply: 0n,
    masterAmount: input.masterAmount,
    puppetList: input.puppetList,
    matchedAmountList: input.matchedAmountList
  }

  const { puppetList, matchedAmountList, ...rest } = intent
  const typedData: TypedDataDefinition = {
    domain: HUB_DOMAIN,
    ...HUB_GATE_INTENTS.createMaster,
    message: {
      ...rest,
      puppetListHash: keccak256(concat(puppetList)),
      matchedAmountListHash: keccak256(concat(matchedAmountList.map(x => toHex(x, { size: 32 }))))
    }
  }
  return {
    intent,
    typedData,
    args: [intent, bodyList, mandateList, input.userDeploySig, input.userSignerProof]
  }
}
