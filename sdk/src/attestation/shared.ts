import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
import type {
  IAccount__CreatePuppetAccountIntent,
  IAccountGate__BridgeIntent,
  IAccountGate__RecognizeIntent,
  IAllocate__AllocateIntent,
  IHubGate__WithdrawToBridgeIntent,
  IHubGate__WithdrawToWalletIntent,
  IMasterGate__CreateFundAccountIntent,
  IMasterGate__OperateIntent,
  IRedeem__ClaimIntent,
  IRedeem__RedeemIntent,
  IRedeem__SellIntent,
  ISubscribe__SubscribeIntent
} from '@puppet/contracts/types'
import { type Address, getAddress } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { IAccountRow } from '../state/metric.js'
import { type IIndexerClient, selectOne } from '../state/shared.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'

export { ACCOUNT_GATE_DOMAIN_MAP, MASTER_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
export const HUB_DOMAIN = HUB_GATE_DOMAIN_MAP[HUB_CHAIN_ID]

export interface IIntentByKind {
  subscribe: ISubscribe__SubscribeIntent
  allocate: IAllocate__AllocateIntent
  sell: IRedeem__SellIntent
  claim: IRedeem__ClaimIntent
  redeem: IRedeem__RedeemIntent
  createPuppetAccount: IAccount__CreatePuppetAccountIntent
  createFundAccount: IMasterGate__CreateFundAccountIntent
  operate: IMasterGate__OperateIntent
  recognize: IAccountGate__RecognizeIntent
  withdrawToWallet: IHubGate__WithdrawToWalletIntent
  bridge: IAccountGate__BridgeIntent
  withdrawToBridge: IHubGate__WithdrawToBridgeIntent
}

export type IActionKind = keyof IIntentByKind

export interface IDraftContext {
  chainId: ChainId
  tokenRegistry: ITokenRegistryMap
}

export async function fetchAccount(
  sql: IIndexerClient,
  account: Address,
  chainId: ChainId | number | bigint
): Promise<IAccountRow | undefined> {
  return selectOne(sql, 'Account', {
    where: { account: { _eq: getAddress(account) }, chainId: { _eq: BigInt(chainId) } }
  })
}

export async function fetchAccountOrThrow(
  sql: IIndexerClient,
  account: Address,
  chainId: ChainId | number | bigint
): Promise<IAccountRow> {
  const row = await fetchAccount(sql, account, chainId)
  if (!row) throw new CompactContractError('Account__NotDeployed', [account])
  return row
}
