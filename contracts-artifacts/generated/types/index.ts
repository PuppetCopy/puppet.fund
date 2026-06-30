// This file is auto-generated from Solidity struct definitions. Do not edit manually.

import type { Address, Hex } from 'viem'

export interface IAccountLib__AccountInitParams {
  user: Address
  signer: Address
}

export interface IAllocate__AllocateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  acceptableNetAssetValue: bigint
  totalShareSupply: bigint
  masterAmount: bigint
  puppetList: Address[]
  allocatedAmountList: bigint[]
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

export interface IFundAccountLib__FundAccountInitParams {
  master: Address
  baseToken: Address
  name: Hex
}

export interface IFundGate__OperateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  callList: IIAccount__Call[]
  transferList: IIAccount__SignTransfer[]
}

export interface IFundGate__RecognizeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  token: Address
  amount: bigint
}

export interface IFundGate__SwapIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  swap: ISwapLib__SwapParams
  destinationChainId: bigint
  fromRoute: boolean
}

export interface IHubGate__WithdrawIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
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

export interface IIAccount__Call {
  target: Address
  value: bigint
  gasLimit: bigint
  callData: Hex
}

export interface IIAccount__SignTransfer {
  token: Address
  amountIn: bigint
  amountOut: bigint
}

export interface IMandate__MandateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  baseToken: Address
  rules: IRuleLib__Rule[]
}

export interface IPuppetGate__RecognizeIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  token: Address
  amount: bigint
}

export interface IPuppetGate__SwapIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  swap: ISwapLib__SwapParams
  destinationChainId: bigint
}

export interface IRedeem__ClaimIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
}

export interface IRedeem__LiquidateIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  acceptableNetAssetValue: bigint
}

export interface IRedeem__RedeemIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  sharesOut: bigint
  assetsOut: bigint
  acceptableNetAssetValue: bigint
}

export interface IRedeem__SellIntent {
  params: IAccountLib__AccountInitParams
  blockNumber: bigint
  deadline: bigint
  acceptableRelayFee: bigint
  nonce: bigint
  chainId: bigint
  fundParams: IFundAccountLib__FundAccountInitParams
  sharesOut: bigint
}

export interface IRedeemStore__Pool {
  epoch: bigint
  accruedPerWeight: bigint
  weight: bigint
}

export interface IRedeemStore__Position {
  epoch: bigint
  weight: bigint
  cursor: bigint
}

export interface IRuleLib__Rule {
  fund: Address
  body: Hex
  mandate: Hex
}

export interface ISwapLib__SwapParams {
  inputToken: Address
  outputToken: Address
  provider: Address
  providerCallData: Hex
  inputAmount: bigint
  outputAmount: bigint
}
