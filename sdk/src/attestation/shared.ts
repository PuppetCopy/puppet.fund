import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { FUND_GATE_DOMAIN_MAP, HUB_GATE_DOMAIN_MAP, PUPPET_GATE_DOMAIN_MAP } from '@puppet/contracts/intents'
import type {
  IAllocate__AllocateIntent,
  IFundGate__OperateIntent,
  IFundGate__RecognizeIntent,
  IFundGate__SwapIntent,
  IFundGate__WrapIntent,
  IHubGate__WithdrawIntent,
  IMandate__MandateIntent,
  IPuppetGate__RecognizeIntent,
  IPuppetGate__SwapIntent,
  IRedeem__ClaimIntent,
  IRedeem__LiquidateIntent,
  IRedeem__RedeemIntent,
  IRedeem__SellIntent
} from '@puppet/contracts/types'
import type { Hex } from 'viem'
import { CompactError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import type { ITokenRegistryMap } from '../state/tokenRegistry.js'

// Cached deploy proofs for the create-on-missing overloads (recognize, swap, allocate, mandate).
// Empty when the account already exists; the dispatch layer appends them only when deploying, and they are
// never part of the signed digest.
export interface IDeployProof {
  userDeploySig: Hex
  userSignerProof: Hex
}

export { FUND_GATE_DOMAIN_MAP, PUPPET_GATE_DOMAIN_MAP }
export const HUB_DOMAIN = HUB_GATE_DOMAIN_MAP[HUB_CHAIN_ID]
export const WEIGHT_RATIO_CAP = 1_000_000n

export function puppetGateDomain(chainId: ChainId) {
  const domain = PUPPET_GATE_DOMAIN_MAP[chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${chainId}`)
  return domain
}

export function fundGateDomain(chainId: ChainId) {
  const domain = FUND_GATE_DOMAIN_MAP[chainId]
  if (!domain) throw new CompactError('BAD_REQUEST', `unsupported chain ${chainId}`)
  return domain
}

export interface IIntentByKind {
  mandate: IMandate__MandateIntent
  allocate: IAllocate__AllocateIntent
  sell: IRedeem__SellIntent
  claim: IRedeem__ClaimIntent
  redeem: IRedeem__RedeemIntent
  liquidate: IRedeem__LiquidateIntent
  operate: IFundGate__OperateIntent
  recognize: IPuppetGate__RecognizeIntent
  fundRecognize: IFundGate__RecognizeIntent
  swap: IPuppetGate__SwapIntent
  fundSwap: IFundGate__SwapIntent
  wrap: IFundGate__WrapIntent
  withdraw: IHubGate__WithdrawIntent
}

export type IActionKind = keyof IIntentByKind

export interface IDraftContext {
  chainId: ChainId
  tokenRegistry: ITokenRegistryMap
}
