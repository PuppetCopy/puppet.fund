import { hubgateAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { ACCOUNT_DOMAIN, CHAINLESS_DOMAIN, CREDIT_TOTAL_TYPES, INTENTS } from '@puppet/contracts/intents'
import type {
  IAccountLib__Genesis,
  IAccountLib__IntentHeader,
  IDeposit__SwapIntent,
  IFund__AllocateIntent,
  IFund__Allocation,
  IFund__Credit,
  IHubGate__MandateIntent,
  ILiquidityGate__RetireEscrowIntent,
  IMandateLib__Mandate,
  IRedeem__RedeemIntent,
  IRedeem__SellIntent,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import type { AbiParameter, Address, Hex, TypedDataDefinition } from 'viem'
import { encodeAbiParameters, getAddress, isAddressEqual, keccak256, numberToHex, recoverAddress, zeroAddress } from 'viem'
import { genesisDigest, predictUserAccount } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { IMandateRow } from '../schema/index.js'
import { verifyDeadline } from './intentLib.js'
import type { IFundState } from './terms.js'

const ACTION_SCOPE = {
  operate: { derived: true },
  mandate: { derived: true },
  allocate: { derived: true },
  createFund: { derived: true },
  redeem: { derived: true },
  retireEscrow: { derived: true },
  sell: { derived: false },
  fundSwap: { derived: false },
  depositAcross: { derived: false },
  withdraw: { derived: false }
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
  depositAcross: IDeposit__SwapIntent
  withdraw: IDeposit__SwapIntent
  mandate: IHubGate__MandateIntent
  operate: ISpokeGate__OperateIntent
  fundSwap: IDeposit__SwapIntent
  createFund: IFund__AllocateIntent
  allocate: IFund__AllocateIntent
  sell: IRedeem__SellIntent
  redeem: IRedeem__RedeemIntent
  retireEscrow: ILiquidityGate__RetireEscrowIntent
}

type IIntentKind = keyof IIntentByKind

export function accountDomain(chainId: ChainId, account: Address) {
  return { ...ACCOUNT_DOMAIN, chainId, verifyingContract: account } as const
}

function intentField(abi: typeof hubgateAbi, fn: string, field: string): AbiParameter {
  const intent = (abi as readonly { type: string; name?: string; inputs?: readonly AbiParameter[] }[]).find(
    item => item.type === 'function' && item.name === fn
  )?.inputs?.[0]
  const param = intent && 'components' in intent ? intent.components.find(c => c.name === field) : undefined
  if (!param) throw new Error(`the ${fn} argument has no ${field} field in the gate ABI`)
  return param
}

const MANDATE_LIST_PARAM = intentField(hubgateAbi, 'mandate', 'mandateList')
const ALLOCATION_LIST_PARAM = intentField(hubgateAbi, 'allocate', 'allocationList')

const mandateListHash = (list: readonly IMandateLib__Mandate[]): Hex =>
  keccak256(encodeAbiParameters([MANDATE_LIST_PARAM], [list]))
const allocationListHash = (list: readonly IFund__Allocation[]): Hex =>
  keccak256(encodeAbiParameters([ALLOCATION_LIST_PARAM], [list]))

if (!('components' in MANDATE_LIST_PARAM)) throw new Error('the mandate argument names no Mandate fields in the gate ABI')
const MANDATE_PARAM = { type: 'tuple', components: MANDATE_LIST_PARAM.components }

export const mandateDigest = (mandate: IMandateLib__Mandate, epoch: bigint): Hex =>
  keccak256(encodeAbiParameters([MANDATE_PARAM, { type: 'uint256' }], [mandate, epoch]))

function intentMessage<K extends IIntentKind>(kind: K, intent: IIntentByKind[K]): Record<string, unknown> {
  if (kind === 'mandate') {
    const { mandateList, ...rest } = intent as IHubGate__MandateIntent
    return { ...rest, mandateListHash: mandateListHash(mandateList) }
  }
  if (kind === 'allocate' || kind === 'createFund') {
    const { allocationList, ...rest } = intent as IFund__AllocateIntent
    return { ...rest, allocationListHash: allocationListHash(allocationList) }
  }
  return intent as unknown as Record<string, unknown>
}

export function intentTypedData<K extends IIntentKind>(kind: K, chainId: ChainId, intent: IIntentByKind[K]): TypedDataDefinition {
  const spec = INTENTS[kind]
  if ((spec.gate === 'HubGate' && chainId !== HUB_CHAIN_ID) || (spec.gate === 'SpokeGate' && chainId === HUB_CHAIN_ID)) {
    throw new CompactContractError('Account__HeaderMismatch', [intent.header.account])
  }
  return {
    domain: {
      ...accountDomain(chainId, intent.header.account),
      salt: numberToHex((intent.header.deadline << 128n) | intent.header.nonce, { size: 32 })
    },
    primaryType: spec.primaryType,
    types: spec.types,
    message: intentMessage(kind, intent)
  }
}

export function creditTotalTypedData(owner: Address, master: Address, credit: IFund__Credit): TypedDataDefinition {
  return {
    domain: { ...CHAINLESS_DOMAIN, verifyingContract: owner },
    primaryType: 'CreditTotal',
    types: CREDIT_TOTAL_TYPES,
    message: { master, chainId: credit.chainId, token: credit.token, total: credit.total, feeTotal: credit.feeTotal }
  }
}

export interface IDraftContext {
  chainId: ChainId
}

export interface IAccountState {
  user: Address
  nonce: bigint
}

export interface IHeaderContext {
  account: IAccountState | null
  now: bigint
}

export interface IAccountBinding {
  account: Address
  user: Address
}

export interface IGenesisContext extends IHeaderContext {
  genesis: IAccountLib__Genesis | null
}

export const GENESIS_NONCE = 0n

async function verifyGenesis(header: IAccountBinding, genesis: IAccountLib__Genesis): Promise<void> {
  const parent = getAddress(genesis.parent)
  if (isAddressEqual(parent, zeroAddress)) {
    if (!isAddressEqual(predictUserAccount(header.user), header.account)) {
      throw new CompactContractError('Account__HeaderMismatch', [header.account])
    }
    return
  }
  if (!isAddressEqual(predictUserAccount(header.user), parent)) {
    throw new CompactContractError('Account__InvalidUser', [])
  }
  const recovered = await recoverAddress({
    hash: genesisDigest({ account: header.account, parent }),
    signature: genesis.key
  })
  if (!isAddressEqual(recovered, header.account)) throw new CompactContractError('Account__InvalidSignature', [])
}

export function verifyHeader(ctx: IHeaderContext, header: IAccountLib__IntentHeader): void {
  if (ctx.account === null || !isAddressEqual(ctx.account.user, header.user)) {
    throw new CompactContractError('Account__HeaderMismatch', [header.account])
  }
  if (header.nonce !== ctx.account.nonce) {
    throw new CompactContractError('Account__NonceMismatch', [header.account, ctx.account.nonce, header.nonce])
  }
  verifyDeadline(header.deadline, ctx.now)
  if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
}

export async function verifyHeaderOrGenesis(
  ctx: IGenesisContext & { chainId: ChainId },
  header: IAccountLib__IntentHeader,
  kind: IActionKind
): Promise<void> {
  if (ctx.account !== null) return verifyHeader(ctx, header)
  if (ctx.chainId === HUB_CHAIN_ID && (kind === 'allocate' || kind === 'redeem' || kind === 'sell' || kind === 'fundSwap')) {
    throw new CompactContractError('Account__HeaderMismatch', [header.account])
  }
  if (ctx.genesis === null) {
    throw new CompactError('GENESIS_MISSING', `${header.account} does not exist on chain ${ctx.chainId}; the intent needs its genesis`, 'hard')
  }
  await verifyGenesis(header, ctx.genesis)
  if (header.nonce !== GENESIS_NONCE) throw new CompactContractError('Account__NonceMismatch', [header.account, GENESIS_NONCE, header.nonce])
  verifyDeadline(header.deadline, ctx.now)
  if (header.fee === 0n) throw new CompactContractError('Intent__ZeroRelayFee', [header.account])
}

export function verifyFundShare(fund: IFundState | null, master: Address, shareToken: Address): asserts fund is IFundState {
  if (fund === null) {
    throw new CompactError('FUND_UNRECORDED', `the chronicle records no fund for ${master}; if it opened one, retry once the chronicle folds the opening`, 'soft')
  }
  if (!isAddressEqual(fund.shareToken, shareToken)) throw new CompactContractError('Fund__ShareMismatch', [master, shareToken])
}

export const mandateOfRow = (row: IMandateRow): IMandateLib__Mandate => ({
  master: row.master,
  skin: row.skin,
  allocationRate: row.allocationRate,
  exitCap: row.exitCap,
  cooldownPeriod: row.cooldownPeriod,
  expiry: row.expiry
})
