// This file is auto-generated from Solidity struct definitions. Do not edit manually.

import type { Address, Hex } from 'viem'

export interface IAccountGate__BridgeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  tokenId: Hex
  provider: Address
  providerCallData: Hex
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  expires: number
  fillDeadline: number
}

export interface IAccountGate__RecognizeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  tokenId: Hex
  amount: bigint
}

export interface IAccountLib__AccountInitParams {
  user: Address
  signer: Address
}

export interface IAccountModule__CreatePuppetAccountIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  tokenId: Hex
  initialDepositAmount: bigint
}

export interface IAllocateModule__AllocateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  share: IShareLib__ShareInitParams
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

export interface IBaseGate__Config {
  attestor: Address
  feeReceiver: Address
  transferGasLimit: bigint
  maxBlockDelay: bigint
  maxRelayFeeBps: bigint
}

export interface IHubGate__WithdrawToBridgeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  tokenId: Hex
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  destinationChainId: bigint
  provider: Address
  providerCallData: Hex
  expires: number
  fillDeadline: number
}

export interface IHubGate__WithdrawToWalletIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  tokenId: Hex
  amount: bigint
}

export interface IIAccount__Call {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}

export interface IIAccount__SignTransfer {
  tokenId: Hex
  token: Address
  amountIn: bigint
  amountOut: bigint
}

export interface IMasterGate__CreateFundAccountIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  tokenId: Hex
  sweepAmount: bigint
}

export interface IMasterGate__OperateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  callList: IIAccount__Call[]
  transferList: IIAccount__SignTransfer[]
}

export interface IRedeemModule__ClaimIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  share: IShareLib__ShareInitParams
  amount: bigint
}

export interface IRedeemModule__FulfillIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  share: IShareLib__ShareInitParams
  sharesOut: bigint
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
  share: IShareLib__ShareInitParams
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
  fund: Address
  body: Hex
  mandate: Hex
}

export interface IShareLib__ShareInitParams {
  master: Address
  baseTokenId: Hex
  name: Hex
}

export interface ISubscribeModule__SubscribeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  baseTokenId: Hex
  rules: IRuleLib__Rule[]
}
