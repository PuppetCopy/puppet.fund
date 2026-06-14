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
  IRedeem__LiquidateIntent,
  IRedeem__RedeemIntent,
  IRedeem__SellIntent,
  ISubscribe__SubscribeIntent
} from '@puppet/contracts/types'
import type { ChainId } from '../const/index.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'

export { ACCOUNT_GATE_DOMAIN_MAP, MASTER_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
export const HUB_DOMAIN = HUB_GATE_DOMAIN_MAP[HUB_CHAIN_ID]
export const STAKE_RATIO_CAP = 1_000_000n

export interface IIntentByKind {
  subscribe: ISubscribe__SubscribeIntent
  allocate: IAllocate__AllocateIntent
  sell: IRedeem__SellIntent
  claim: IRedeem__ClaimIntent
  redeem: IRedeem__RedeemIntent
  liquidate: IRedeem__LiquidateIntent
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
