import type { IIAccount__Call } from '@puppet/contracts/types'
import type { Address, Hex, PublicClient, TypedDataDefinition } from 'viem'
import type { IBodySignRequest } from '../account/createAccount.js'
import type { ITokenProfile } from '../core/token.js'
import type { ChainId } from '../const/index.js'
import type { IGetRate } from '../evaluate/types.js'
import type { IPositionRow } from '../schema/index.js'

export interface IGuardReason {
  code: string
  detail: string
}

export interface IGuardResult {
  ok: boolean
  reasons: IGuardReason[]
}

export interface IVenueMarket {
  indexToken: Address
  longToken: Address
  shortToken: Address
}

export interface IVenueFacts {
  markets: ReadonlyMap<Address, IVenueMarket>
  tokens: ReadonlyMap<Address, ITokenProfile>
  owners: ReadonlyMap<Address, Address | null>
}

export interface IScreenContext {
  chainId: ChainId
  account: Address
  registeredTokens: readonly Address[]
  facts: IVenueFacts
}

export interface IDappScreenReason {
  code:
    | 'DAPP_DOMAIN_NOT_ADMITTED'
    | 'DAPP_ACTION_NOT_ADMITTED'
    | 'DAPP_EXIT_DESTINATION'
    | 'DAPP_EXIT_ABOVE_AVAILABLE'
    | 'DAPP_MESSAGE_NOT_ADMITTED'
    | 'ASSET_NOT_PRICEABLE'
    | 'ORDER_BOOK_THIN'
    | 'ORDER_PRICE_BOUND'
    | 'REFERRAL_BOUND'
  detail: string
}

export interface IDappTypedData {
  domain?: { name?: string; version?: string; chainId?: number | bigint | string; verifyingContract?: string }
  types?: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}

interface IVenueFlow {
  token: Address
  delta: bigint
  exact: boolean
}

export interface IStepField {
  label: string
  value: string
}

export interface IVenueStep {
  kind: 'venue'
  venueId: string
  label: string
  call: string
  fields: readonly IStepField[]
  key: Hex | null
  flows: readonly IVenueFlow[]
  fees: readonly { payee: 'venue' | 'route'; token: Address; amount: bigint; expected: bigint | null }[]
}

export type IOperateStep =
  | IVenueStep
  | { kind: 'release'; token: Address | null; to: Address; amount: bigint }
  | { kind: 'approve'; token: Address; spender: Address; amount: bigint }
  | { kind: 'fee'; token: Address; amount: bigint }
  | { kind: 'call'; target: Address; selector: Hex; value: bigint }

export interface IVenueExchange {
  spent: { token: Address; amount: bigint }[]
  received: { token: Address; amount: bigint }[]
}

export interface IVenueContract {
  chainId: ChainId
  address: Address
  name: string
  detail: string
  pullsTokens?: boolean
  standing?: boolean
}

export interface IVenueGrant {
  ledger: Address
  token: Address
  spender: Address
  amount: bigint
}

export interface IVenueValueParams {
  chainId: ChainId
  account: Address
  blockNumber: bigint
  blockTimestamp: number
  nowSec: number
  clients: Readonly<Record<number, PublicClient>>
  getRate: IGetRate
  freshness: number
  sharedReads: boolean
}

export interface IVenueOutcomeParams {
  chainId: ChainId
  account: Address
  key: Hex
  fromBlock: bigint
  publicClient: PublicClient
}

export type IPositionKind = 'perp' | 'spot' | 'outcome' | 'cash' | 'transit' | 'order' | 'pending' | 'vault' | 'lend'

export type IVenuePosition = Omit<IPositionRow, 'id' | 'account' | 'venue' | 'kind'> & { kind: IPositionKind }

export interface IVenueDeposit {
  chainId: ChainId
  token: Address
  min: bigint
  creditSec: number
  callsOf(account: Address, amount: bigint): IIAccount__Call[]
}

export interface IVenueWithdrawContext {
  clients: Readonly<Record<number, PublicClient>>
}

export interface IVenueCredentials {
  key: string
  secret: string
  passphrase: string
}

export interface IVenueWithdraw {
  chainId: ChainId
  token: Address
  balance(ctx: IVenueWithdrawContext, account: Address): Promise<{ total: bigint; free: bigint }>
  feeOf(amount: bigint): bigint
  typedData(ctx: IVenueWithdrawContext, account: Address, amount: bigint, time: number): Promise<TypedDataDefinition>
  landing(client: PublicClient, account: Address, typedData: TypedDataDefinition, due: bigint, fromBlock: bigint): Promise<{ block: bigint; txHash: Hex } | { expired: string } | null>
}

export type IVenueIntentInput =
  | { kind: 'choice'; name: string; label: string; options: readonly { value: string; label: string }[] }
  | { kind: 'side'; name: string; label: string }
  | { kind: 'amount'; name: string; label: string; symbol: string; decimals: number; min: bigint }
  | { kind: 'leverage'; name: string; label: string; max: number }
  | { kind: 'position'; name: string; label: string }

export type IVenueIntentParams = Readonly<Record<string, string>>

export interface IVenueIntent {
  intent: string
  label: string
  inputs: readonly IVenueIntentInput[]
  summary(params: IVenueIntentParams): string
  typedData(ctx: IVenueWithdrawContext, account: Address, params: IVenueIntentParams, time: number): Promise<TypedDataDefinition>
  landing(client: PublicClient, account: Address, typedData: TypedDataDefinition, fromBlock: bigint): Promise<{ block: bigint; txHash: Hex } | { expired: string } | null>
}

export interface IVenueIntents {
  chainId: number
  list: readonly IVenueIntent[]
  prerequisite?(ctx: IVenueWithdrawContext, account: Address, time: number): Promise<{ intent: string; params: IVenueIntentParams } | null>
}

export interface IVenue {
  venueId: string
  name: string
  chains: readonly ChainId[]
  contracts: readonly IVenueContract[]
  claims(ctx: IScreenContext, call: IIAccount__Call): boolean
  screen(ctx: IScreenContext, call: IIAccount__Call): IGuardReason[]
  outflows(account: Address, call: IIAccount__Call): { token: Address; amount: bigint }[]
  transit?(chainId: ChainId, account: Address, call: IIAccount__Call): { destinationChainId: bigint; inputToken: Address; inputAmount: bigint; outputToken: Address; outputAmount: bigint } | null
  grants?(chainId: ChainId, call: IIAccount__Call): IVenueGrant[]
  exchange(chainId: ChainId, account: Address, call: IIAccount__Call): IVenueExchange
  resolve?(client: PublicClient, callList: readonly IIAccount__Call[], blockNumber: bigint | undefined): Promise<IVenueFacts>
  describe(chainId: ChainId, account: Address | null, callList: readonly IIAccount__Call[], resultList: readonly Hex[] | undefined, facts: IVenueFacts): ReadonlyMap<number, IOperateStep[]>
  typedData?(account: Address, typedData: IDappTypedData): IDappScreenReason[] | null
  readableTypedData?(clients: Readonly<Record<number, PublicClient>>, account: Address, nowSec: bigint, signedMessage: (message: Hex) => Hex | null, typedData: IDappTypedData): Promise<IDappTypedData | null>
  presign?(account: Address, typedData: IDappTypedData): IBodySignRequest[]
  attestTypedData?(clients: Readonly<Record<number, PublicClient>>, account: Address, typedData: IDappTypedData): Promise<IDappScreenReason[]>
  submit?(typedData: IDappTypedData, signature: Hex, credentials: IVenueCredentials | null): Promise<void>
  attestOperate?(clients: Readonly<Record<number, PublicClient>>, chainId: ChainId, account: Address, callList: readonly IIAccount__Call[]): Promise<IGuardReason[]>
  exitsInto?: readonly string[]
  message(account: Address, text: string): IDappScreenReason[] | null
  positions?(params: IVenueValueParams): Promise<IVenuePosition[]>
  outcome?(params: IVenueOutcomeParams): Promise<string | null>
  deposit?: IVenueDeposit
  withdraw?: IVenueWithdraw
  intents?: IVenueIntents
  dapp?: { hosts: readonly string[]; chains: readonly number[] }
}
