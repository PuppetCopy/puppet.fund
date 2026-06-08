import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
import type {
  IAccountModule__CreateMasterAccountIntent,
  IAccountModule__CreatePuppetAccountIntent,
  IAllocateModule__AllocateIntent,
  IHubGate__BridgeToWalletIntent,
  IMasterGate__BridgeIntent,
  IMasterGate__OperateIntent,
  IMasterGate__RecognizeIntent,
  IPuppetGate__BridgeIntent,
  IPuppetGate__RecognizeIntent,
  IPuppetGate__WithdrawIntent,
  IRedeemModule__ClaimIntent,
  IRedeemModule__FulfillIntent,
  IRedeemModule__SellIntent,
  ISubscribeModule__SubscribeIntent
} from '@puppet/contracts/types'
import { type Address, getAddress } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { IAccountStateRow } from '../state/metric.js'
import { type IIndexerClient, selectOne } from '../state/shared.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'

export { MASTER_GATE_DOMAIN_MAP, PUPPET_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
export const HUB_DOMAIN = HUB_GATE_DOMAIN_MAP[HUB_CHAIN_ID]

export interface IIntentByKind {
  subscribe: ISubscribeModule__SubscribeIntent
  allocate: IAllocateModule__AllocateIntent
  sell: IRedeemModule__SellIntent
  claim: IRedeemModule__ClaimIntent
  fulfill: IRedeemModule__FulfillIntent
  createPuppetAccount: IAccountModule__CreatePuppetAccountIntent
  createMasterAccount: IAccountModule__CreateMasterAccountIntent
  seedMasterAccount: IAllocateModule__AllocateIntent
  operate: IMasterGate__OperateIntent
  recognize: IPuppetGate__RecognizeIntent | IMasterGate__RecognizeIntent
  walletWithdraw: IPuppetGate__WithdrawIntent
  walletWithdrawWnt: IPuppetGate__WithdrawIntent
  bridge: IPuppetGate__BridgeIntent | IMasterGate__BridgeIntent
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
