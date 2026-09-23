import { hubgateAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ACCOUNT_DOMAIN, CHAINLESS_DOMAIN, INTENTS, MANDATE_TYPES, VALUATION_TYPES } from '@puppet/contracts/intents'
import type {
  IAccountLib__Genesis,
  IAccountLib__IntentHeader,
  IAccountLib__Mandate,
  IDeposit__SwapIntent,
  IFund__AllocateIntent,
  IFund__Allocation,
  IFund__Asset,
  IFund__Position,
  IFund__RedeemIntent,
  IFund__SellIntent,
  IFund__Valuation,
  IHubGate__MandateIntent,
  ILiquidityGate__EscrowIntent,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import type { AbiParameter, Address, Hex, TypedDataDefinition } from 'viem'
import { encodeAbiParameters, getAddress, hashStruct, hashTypedData, isAddressEqual, keccak256, recoverAddress, zeroAddress } from 'viem'
import { CALL_LIST_PARAM } from '../account/commitment.js'
import { genesisDigest, predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { IMandateRow } from '../schema/index.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'
import { verifyDeadline } from './intentLib.js'

const ACTION_SCOPE = {
  operate: { derived: true },
  mandate: { derived: true },
  allocate: { derived: true },
  createFund: { derived: true },
  redeem: { derived: true },
  sell: { derived: false },
  escrow: { derived: false },
  fundSwap: { derived: false },
  depositAcross: { derived: false },
  withdraw: { derived: false }
} as const

export type IActionKind = keyof typeof ACTION_SCOPE
export type IDerivedAction = {
  [K in IActionKind]: (typeof ACTION_SCOPE)[K]['derived'] extends true ? K : never
}[IActionKind]
export type ISealedAction = Exclude<IActionKind, IDerivedAction>
export type IScheduledKind = 'claim' | 'fulfil'

export function isActionKind(kind: unknown): kind is IActionKind {
  return typeof kind === 'string' && kind in ACTION_SCOPE
}

export function isDerivedAction(kind: IActionKind): kind is IDerivedAction {
  return ACTION_SCOPE[kind].derived
}

export interface IIntentByKind {
  depositAcross: IDeposit__SwapIntent
  withdraw: IDeposit__SwapIntent
  mandate: IHubGate__MandateIntent
  operate: ISpokeGate__OperateIntent
  fundSwap: IDeposit__SwapIntent
  escrow: ILiquidityGate__EscrowIntent
  createFund: IFund__AllocateIntent
  allocate: IFund__AllocateIntent
  sell: IFund__SellIntent
  redeem: IFund__RedeemIntent
}

type IIntentKind = keyof IIntentByKind

export function accountDomain(chainId: ChainId, account: Address) {
  return { ...ACCOUNT_DOMAIN, chainId, verifyingContract: account } as const
}

function intentField(fn: string, field: string): AbiParameter {
  const intent = hubgateAbi.find(item => item.type === 'function' && item.name === fn)?.inputs?.[0]
  const param = intent && 'components' in intent ? intent.components.find(c => c.name === field) : undefined
  if (!param) throw new Error(`the ${fn} argument has no ${field} field in the gate ABI`)
  return param
}

function valuationField(field: 'assetList' | 'positionList'): AbiParameter {
  const valuation = intentField('allocate', 'valuation')
  const param = 'components' in valuation ? valuation.components.find(c => c.name === field) : undefined
  if (!param) throw new Error(`the valuation struct has no ${field} field in the gate ABI`)
  return param
}

const MANDATE_LIST_PARAM = intentField('mandate', 'mandateList')
const ALLOCATION_LIST_PARAM = intentField('allocate', 'allocationList')
const ASSET_LIST_PARAM = valuationField('assetList')
const POSITION_LIST_PARAM = valuationField('positionList')

const mandateListHash = (list: readonly IAccountLib__Mandate[]): Hex =>
  keccak256(encodeAbiParameters([MANDATE_LIST_PARAM], [list]))
const allocationListHash = (list: readonly IFund__Allocation[]): Hex =>
  keccak256(encodeAbiParameters([ALLOCATION_LIST_PARAM], [list]))

const valuationHash = (valuation: IFund__Valuation): Hex => {
  const { assetList, positionList, ...rest } = valuation
  return hashStruct({
    primaryType: 'Valuation',
    types: VALUATION_TYPES,
    data: {
      ...rest,
      assetListHash: keccak256(encodeAbiParameters([ASSET_LIST_PARAM], [assetList as readonly IFund__Asset[]])),
      positionListHash: keccak256(encodeAbiParameters([POSITION_LIST_PARAM], [positionList as readonly IFund__Position[]]))
    }
  })
}

function mandateTypedData(puppet: Address, mandate: IAccountLib__Mandate): TypedDataDefinition {
  return { domain: { ...CHAINLESS_DOMAIN, verifyingContract: puppet }, primaryType: 'Mandate', types: MANDATE_TYPES, message: { ...mandate } }
}

export const mandateDigest = (puppet: Address, mandate: IAccountLib__Mandate): Hex => hashTypedData(mandateTypedData(puppet, mandate))

function intentMessage<K extends IIntentKind>(kind: K, intent: IIntentByKind[K]): Record<string, unknown> {
  if (kind === 'operate') {
    const { callList, ...rest } = intent as ISpokeGate__OperateIntent
    return { ...rest, callListHash: keccak256(encodeAbiParameters([CALL_LIST_PARAM], [callList])) }
  }
  if (kind === 'mandate') {
    const { mandateList, signatureList: _signatureList, ...rest } = intent as IHubGate__MandateIntent
    return { ...rest, mandateListHash: mandateListHash(mandateList) }
  }
  if (kind === 'allocate' || kind === 'createFund') {
    const { valuation, allocationList, ...rest } = intent as IFund__AllocateIntent
    return { ...rest, valuationHash: valuationHash(valuation), allocationListHash: allocationListHash(allocationList) }
  }
  if (kind === 'redeem') {
    const { valuation, ...rest } = intent as IFund__RedeemIntent
    return { ...rest, valuationHash: valuationHash(valuation) }
  }
  return intent as unknown as Record<string, unknown>
}

export function intentTypedData<K extends IIntentKind>(kind: K, chainId: ChainId, intent: IIntentByKind[K]): TypedDataDefinition {
  const spec = INTENTS[kind]
  if ((spec.gate === 'HubGate' && chainId !== HUB_CHAIN_ID) || (spec.gate === 'SpokeGate' && chainId === HUB_CHAIN_ID)) {
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

export interface IAccountState {
  user: Address
  nonce: bigint
}

export interface IHeaderContext {
  account: IAccountState | null
}

export interface IAccountBinding {
  account: Address
  user: Address
}

export interface IGenesisContext extends IHeaderContext {
  genesis: IAccountLib__Genesis | null
}

export const BODY_GENESIS_NONCE = 1n
export const USER_GENESIS_NONCE = 0n

async function verifyGenesis(header: IAccountBinding, genesis: IAccountLib__Genesis): Promise<bigint> {
  const parent = getAddress(genesis.parent)
  if (isAddressEqual(parent, zeroAddress)) {
    if (!isAddressEqual(predictUserAccount(header.user), header.account)) {
      throw new CompactContractError('Account__HeaderMismatch', [header.account])
    }
    return USER_GENESIS_NONCE
  }
  if (!isAddressEqual(predictUserAccount(header.user), parent)) {
    throw new CompactContractError('Account__InvalidUser', [])
  }
  const recovered = await recoverAddress({
    hash: genesisDigest({ account: header.account, parent }),
    signature: genesis.key
  })
  if (!isAddressEqual(recovered, header.account)) throw new CompactContractError('Account__InvalidSignature', [])
  return BODY_GENESIS_NONCE
}

export function verifyHeader(ctx: IHeaderContext, header: IAccountLib__IntentHeader): void {
  if (ctx.account === null || !isAddressEqual(ctx.account.user, header.user)) {
    throw new CompactContractError('Account__HeaderMismatch', [header.account])
  }
  if (header.nonce !== ctx.account.nonce) {
    throw new CompactContractError('Account__NonceMismatch', [header.account, ctx.account.nonce, header.nonce])
  }
  verifyDeadline(header.deadline)
  if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
}

export async function verifyHeaderOrGenesis(
  ctx: IGenesisContext & { chainId: ChainId },
  header: IAccountLib__IntentHeader,
  kind: IActionKind
): Promise<void> {
  if (ctx.account !== null) return verifyHeader(ctx, header)
  if (ctx.genesis === null) {
    throw new CompactError('GENESIS_MISSING', `${header.account} does not exist on chain ${ctx.chainId}; the intent needs its genesis`, 'hard')
  }
  if (ctx.chainId === HUB_CHAIN_ID && kind !== 'createFund' && !isAddressEqual(ctx.genesis.parent, zeroAddress)) {
    throw new CompactError(
      'GENESIS_BURNS_FUND',
      `${header.account} would be born as a body on the hub by a ${kind}; genesis is single-use, so it could never open a fund. A body's first hub action must be createFund`,
      'hard'
    )
  }
  const born = await verifyGenesis(header, ctx.genesis)
  if (header.nonce !== born) throw new CompactContractError('Account__NonceMismatch', [header.account, born, header.nonce])
  verifyDeadline(header.deadline)
  if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
}

export const mandateOfRow = (row: IMandateRow): IAccountLib__Mandate => ({
  master: row.master,
  skin: row.skin,
  allocationRate: row.allocationRate,
  cooldownPeriod: row.cooldownPeriod,
  expiry: row.expiry
})
