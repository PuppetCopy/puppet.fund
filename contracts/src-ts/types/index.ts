// This file is auto-generated from Solidity struct definitions. Do not edit manually.

import type { Address, Hex } from 'viem'

export interface IAccountLib__AccountInitParams {
  user: Address
  name: Hex
  baseTokenId: Hex
  signer: Address
}

export interface IAccountModule__CreateMasterAccountIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  initialDepositAmount: bigint
}

export interface IAccountModule__CreatePuppetAccountIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  initialDepositAmount: bigint
}

export interface IAllocateModule__AllocateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  baseToken: Address
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  masterAmount: bigint
  puppetList: Address[]
  matchedAmountList: bigint[]
}

export interface IAllocateStore__PuppetState {
  mandate: Hex
  lastAllocatedAt: bigint
}

export interface ICoreGate__Config {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxBlockDelay: bigint
  maxRelayFeeBps: bigint
}

export interface ICoreGate__SignTransientRouteBalanceIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  amount: bigint
}

export interface ICoreGate__WithdrawIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  amount: bigint
}

export interface IHubGate__BridgeToWalletIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  bridgeFee: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
}

export interface IHubGate__Config {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxBlockDelay: bigint
  acrossSpokePool: Address
  maxRelayFeeBps: bigint
}

export interface IIAccount__Call {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}

export interface IRedeemModule__ClaimIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  masterParams: IAccountLib__AccountInitParams
  amount: bigint
}

export interface IRedeemModule__FulfillIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  acceptableShares: bigint
}

export interface IRedeemModule__SellIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  masterParams: IAccountLib__AccountInitParams
  sharesOut: bigint
}

export interface IRedeemStore__Pool {
  accruedPerStake: bigint
  totalStake: bigint
}

export interface IRedeemStore__Position {
  stake: bigint
  cursor: bigint
  accrued: bigint
}

export interface IRegisterModule__TokenInfo {
  token: Address
  cap: bigint
  hubToken: Address
}

export interface IRuleLib__Rule {
  masterParams: IAccountLib__AccountInitParams
  body: Hex
  mandate: Hex
}

export interface ISpokeGate__BridgeHubIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fromTransientRoute: boolean
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  bridgeFee: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
}

export interface ISpokeGate__BridgeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fromTransientRoute: boolean
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  bridgeFee: bigint
  destinationChainId: bigint
  exclusiveRelayer: Address
  quoteTimestamp: number
  fillDeadline: number
  exclusivityDeadline: number
}

export interface ISpokeGate__Config {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxBlockDelay: bigint
  acrossSpokePool: Address
  maxRelayFeeBps: bigint
}

export interface ISpokeGate__MasterSignRecordedBalanceIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fromTransientRoute: boolean
  amount: bigint
}

export interface ISpokeGate__OperateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  baseToken: Address
  callList: IIAccount__Call[]
  amountIn: bigint
  amountOut: bigint
}

export interface ISubscribeModule__SubscribeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  baseToken: Address
  rules: IRuleLib__Rule[]
}
