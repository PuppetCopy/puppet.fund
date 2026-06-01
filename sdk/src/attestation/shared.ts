import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
import type {
  IAccountModule__CreateMasterAccountIntent,
  IAccountModule__CreatePuppetAccountIntent,
  IAllocateModule__AllocateIntent,
  ICoreGate__SignTransientRouteBalanceIntent,
  ICoreGate__WithdrawIntent,
  IHubGate__BridgeToWalletIntent,
  IRedeemModule__ClaimIntent,
  IRedeemModule__FulfillIntent,
  IRedeemModule__SellIntent,
  ISpokeGate__BridgeHubIntent,
  ISpokeGate__BridgeIntent,
  ISpokeGate__OperateIntent,
  ISubscribeModule__SubscribeIntent
} from '@puppet/contracts/types'
import { type Address, getAddress } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { IAccountStateRow } from '../state/metric.js'
import { type IIndexerClient, selectOne } from '../state/shared.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'

export { CORE_GATE_DOMAIN_MAP, SPOKE_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
export const HUB_DOMAIN = HUB_GATE_DOMAIN_MAP[HUB_CHAIN_ID]

export interface IIntentByKind {
  subscribe: ISubscribeModule__SubscribeIntent
  allocate: IAllocateModule__AllocateIntent
  sell: IRedeemModule__SellIntent
  claim: IRedeemModule__ClaimIntent
  fulfill: IRedeemModule__FulfillIntent
  createPuppetAccount: IAccountModule__CreatePuppetAccountIntent
  createMasterAccount: IAccountModule__CreateMasterAccountIntent
  createMaster: IAllocateModule__AllocateIntent
  operate: ISpokeGate__OperateIntent
  signTransientRouteBalance: ICoreGate__SignTransientRouteBalanceIntent
  walletWithdraw: ICoreGate__WithdrawIntent
  walletWithdrawWnt: ICoreGate__WithdrawIntent
  bridgeHub: ISpokeGate__BridgeHubIntent
  bridge: ISpokeGate__BridgeIntent
  bridgeToWallet: IHubGate__BridgeToWalletIntent
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
): Promise<IAccountStateRow | undefined> {
  return selectOne(sql, 'AccountState', {
    where: { account: { _eq: getAddress(account) }, chainId: { _eq: BigInt(chainId) } }
  })
}

export async function fetchAccountOrThrow(
  sql: IIndexerClient,
  account: Address,
  chainId: ChainId | number | bigint
): Promise<IAccountStateRow> {
  const row = await fetchAccount(sql, account, chainId)
  if (!row) throw new CompactContractError('Account__NotDeployed', [account])
  return row
}
