import { coregateAbi, hubgateAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ACCOUNT_DOMAIN, CHAINLESS_DOMAIN, INTENTS, MANDATE_TYPES } from '@puppet/contracts/intents'
import type {
  IAccountLib__Backing,
  IAccountLib__IntentHeader,
  IAccountLib__Mandate,
  ICoreGate__OperateIntent,
  ICoreGate__Outcome,
  ICoreGate__SettleIntent,
  ICoreGate__WithdrawIntent,
  IDeposit__DepositSwap,
  IHubGate__DrawIntent,
  IHubGate__Loss,
  IHubGate__MandateIntent,
  IHubGate__UnbondIntent
} from '@puppet/contracts/types'
import type { AbiParameter, Address, Hex, TypedDataDefinition } from 'viem'
import { encodeAbiParameters, hashTypedData, isAddressEqual, keccak256, recoverAddress, } from 'viem'
import { CALL_LIST_PARAM } from '../account/commitment.js'
import { genesisDigest } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { IMandateRow } from '../schema/index.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'
import { verifyDeadline } from './intentLib.js'

const ACTION_SCOPE = {
  operate: { derived: true },
  settle: { derived: true },
  draw: { derived: true },
  mandate: { derived: true },
  depositAcross: { derived: false },
  credit: { derived: false },
  withdraw: { derived: false },
  unbond: { derived: false }
} as const

export type IActionKind = keyof typeof ACTION_SCOPE
export type IDerivedAction = {
  [K in IActionKind]: (typeof ACTION_SCOPE)[K]['derived'] extends true ? K : never
}[IActionKind]
export type ISealedAction = Exclude<IActionKind, IDerivedAction>

export function isActionKind(kind: unknown): kind is IActionKind {
  return typeof kind === 'string' && kind in ACTION_SCOPE
}

export function isDerivedAction(kind: IActionKind): kind is IDerivedAction {
  return ACTION_SCOPE[kind].derived
}

export interface IIntentByKind {
  depositAcross: IDeposit__DepositSwap
  withdraw: ICoreGate__WithdrawIntent
  mandate: IHubGate__MandateIntent
  unbond: IHubGate__UnbondIntent
  operate: ICoreGate__OperateIntent
  settle: ICoreGate__SettleIntent
  draw: IHubGate__DrawIntent
}

export type IIntentKind = keyof IIntentByKind

export function accountDomain(chainId: ChainId, account: Address) {
  return { ...ACCOUNT_DOMAIN, chainId, verifyingContract: account } as const
}

function intentField(abi: readonly { type: string; name?: string; inputs?: readonly AbiParameter[] }[], fn: string, field: string): AbiParameter {
  const intent = abi.find(item => item.type === 'function' && item.name === fn)?.inputs?.[0]
  const param = intent && 'components' in intent ? intent.components.find(c => c.name === field) : undefined
  if (!param) throw new Error(`the ${fn} intent has no ${field} field in the gate ABI`)
  return param
}

const MANDATE_LIST_PARAM = intentField(hubgateAbi, 'mandate', 'mandateList')
const BACKING_LIST_PARAM = intentField(coregateAbi, 'operate', 'backingList')
const GAIN_LIST_PARAM = intentField(coregateAbi, 'settle', 'gainList')
const LOSS_LIST_PARAM = intentField(hubgateAbi, 'draw', 'lossList')

export const creditListHash = (list: readonly Address[]): Hex => keccak256(encodeAbiParameters([{ type: 'address[]' }], [list]))

export const mandateListHash = (list: readonly IAccountLib__Mandate[]): Hex =>
  keccak256(encodeAbiParameters([MANDATE_LIST_PARAM], [list]))
export const backingListHash = (list: readonly IAccountLib__Backing[]): Hex =>
  keccak256(encodeAbiParameters([BACKING_LIST_PARAM], [list]))
export const gainListHash = (list: readonly ICoreGate__Outcome[]): Hex => keccak256(encodeAbiParameters([GAIN_LIST_PARAM], [list]))
export const lossListHash = (list: readonly IHubGate__Loss[]): Hex => keccak256(encodeAbiParameters([LOSS_LIST_PARAM], [list]))

export function mandateTypedData(puppet: Address, mandate: IAccountLib__Mandate): TypedDataDefinition {
  return { domain: { ...CHAINLESS_DOMAIN, verifyingContract: puppet }, primaryType: 'Mandate', types: MANDATE_TYPES, message: { ...mandate } }
}

export const mandateDigest = (puppet: Address, mandate: IAccountLib__Mandate): Hex => hashTypedData(mandateTypedData(puppet, mandate))

function intentMessage<K extends IIntentKind>(kind: K, intent: IIntentByKind[K]): Record<string, unknown> {
  if (kind === 'operate') {
    const { creditList, backingList, callList, ...rest } = intent as ICoreGate__OperateIntent
    return {
      ...rest,
      creditListHash: creditListHash(creditList),
      backingListHash: backingListHash(backingList),
      callListHash: keccak256(encodeAbiParameters([CALL_LIST_PARAM], [callList]))
    }
  }
  if (kind === 'settle') {
    const { gainList, ...rest } = intent as ICoreGate__SettleIntent
    return { ...rest, gainListHash: gainListHash(gainList) }
  }
  if (kind === 'draw') {
    const { lossList, ...rest } = intent as IHubGate__DrawIntent
    return { ...rest, lossListHash: lossListHash(lossList) }
  }
  if (kind === 'mandate') {
    const { creditList, mandateList, signatureList: _signatureList, ...rest } = intent as IHubGate__MandateIntent
    return { ...rest, creditListHash: creditListHash(creditList), mandateListHash: mandateListHash(mandateList) }
  }
  return intent as unknown as Record<string, unknown>
}

export function intentTypedData<K extends IIntentKind>(kind: K, chainId: ChainId, intent: IIntentByKind[K]): TypedDataDefinition {
  const spec = INTENTS[kind]
  if (spec.gate === 'HubGate' && chainId !== HUB_CHAIN_ID) {
    throw new CompactContractError('Account__HeaderMismatch', [intent.header.account])
  }
  return {
    domain: accountDomain(chainId, intent.header.account),
    primaryType: spec.primaryType,
    types: spec.types,
    message: intentMessage(kind, intent)
  }
}

export interface IDraftContext {
  chainId: ChainId
  tokenRegistry: ITokenRegistryMap
}

export interface IBodyArgs {
  user: Address
  signer: Address
}

export interface IHeaderContext {
  nonce: bigint
  body: IBodyArgs | null
}

export interface IAccountBinding {
  account: Address
  user: Address
}

export function verifyBody(body: IBodyArgs | null, header: IAccountBinding): void {
  if (body === null || !isAddressEqual(body.user, header.user)) {
    throw new CompactContractError('Account__HeaderMismatch', [header.account])
  }
}

export interface IGenesisClaim {
  signer: Address
  key: Hex
}

export interface IGenesisContext extends IHeaderContext {
  genesis: IGenesisClaim | null
}

export async function verifyGenesis(header: IAccountBinding, genesis: IGenesisClaim): Promise<void> {
  const recovered = await recoverAddress({
    hash: genesisDigest({ account: header.account, user: header.user, signer: genesis.signer }),
    signature: genesis.key
  })
  if (!isAddressEqual(recovered, header.account)) throw new CompactContractError('Account__InvalidSignature', [])
}

export function verifyHeader(ctx: IHeaderContext, header: IAccountLib__IntentHeader): void {
  verifyBody(ctx.body, header)
  if (header.nonce !== ctx.nonce) throw new CompactContractError('Account__NonceMismatch', [header.account, ctx.nonce, header.nonce])
  verifyDeadline(header.deadline)
  if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
}

export async function verifyHeaderOrGenesis(ctx: IGenesisContext, header: IAccountLib__IntentHeader): Promise<Address> {
  if (ctx.body !== null) {
    verifyHeader(ctx, header)
    return ctx.body.signer
  }
  if (ctx.genesis === null) {
    throw new CompactError('GENESIS_MISSING', `${header.account} has no body on this chain; the intent needs its genesis`, 'hard')
  }
  await verifyGenesis(header, ctx.genesis)
  if (header.nonce !== ctx.nonce) throw new CompactContractError('Account__NonceMismatch', [header.account, ctx.nonce, header.nonce])
  verifyDeadline(header.deadline)
  if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
  return ctx.genesis.signer
}

export function verifyMandateRow(known: IMandateRow | undefined, puppet: Address, mandate: IAccountLib__Mandate): void {
  if (
    known === undefined ||
    !isAddressEqual(known.master, mandate.master) ||
    known.skin !== mandate.skin ||
    known.allocationRate !== mandate.allocationRate ||
    known.cooldownPeriod !== mandate.cooldownPeriod ||
    known.expiry !== mandate.expiry ||
    known.tokenIdList.length !== mandate.tokenIdList.length ||
    known.tokenIdList.some((id, i) => id !== mandate.tokenIdList[i])
  ) {
    throw new CompactContractError('Mandate__Mismatch', [puppet, mandateDigest(puppet, mandate)])
  }
}
