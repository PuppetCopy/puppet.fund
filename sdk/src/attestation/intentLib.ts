import { BASIS_POINTS, PROTOCOL_CONFIG } from '@puppet/contracts/const'
import type { Address, Hex } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { type ITokenRegistryMap, tokenInfoFor } from '../state/tokenRegistry.js'

export function verifyChainId(intentChainId: bigint, expectedChainId: bigint): void {
  if (intentChainId !== expectedChainId) {
    throw new CompactContractError('Intent__InvalidChainId', [intentChainId, expectedChainId])
  }
}

export function verifyDeadline(deadline: bigint): void {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  if (nowSec > deadline) {
    throw new CompactContractError('Intent__ExpiredDeadline', [deadline, nowSec])
  }
}

export function verifyTimeBounds(blockNumber: bigint, deadline: bigint, currentBlock: bigint): void {
  verifyDeadline(deadline)
  if (blockNumber > currentBlock) {
    throw new CompactContractError('Intent__StaleSignature', [blockNumber, currentBlock, 0n])
  }
  if (currentBlock > blockNumber + PROTOCOL_CONFIG.maxBlockDelay) {
    throw new CompactContractError('Intent__StaleSignature', [blockNumber, currentBlock, PROTOCOL_CONFIG.maxBlockDelay])
  }
}

export function verifyTokenAndCap(
  registry: ITokenRegistryMap,
  chainId: ChainId,
  baseTokenId: Hex,
  amount: bigint
): Address {
  const info = tokenInfoFor(registry, chainId, baseTokenId)
  if (info.cap > 0n && amount > info.cap) {
    throw new CompactContractError('Intent__AmountExceedsCap', [amount, info.cap])
  }
  return info.token
}

export function verifyRelayFee(acceptableRelayFee: bigint, amount: bigint): void {
  if (amount > 0n && acceptableRelayFee * BASIS_POINTS > amount * PROTOCOL_CONFIG.maxRelayFeeBps) {
    throw new CompactContractError('Intent__RelayFeeRatioExceeded', [
      acceptableRelayFee,
      amount,
      PROTOCOL_CONFIG.maxRelayFeeBps
    ])
  }
}

export interface ICommonAttestContext {
  chainId: ChainId
  currentBlock: bigint
  tokenRegistry: ITokenRegistryMap
}

export interface IVerifyCommonIntentParams {
  blockNumber: bigint
  deadline: bigint
  intentChainId?: bigint
  baseTokenId: Hex
  lookupChain: ChainId
  capAmount: bigint
  acceptableRelayFee: bigint
  relayFeeDenominator?: bigint
}

export function verifyCommonIntent(ctx: ICommonAttestContext, params: IVerifyCommonIntentParams): Address {
  if (params.intentChainId !== undefined) {
    verifyChainId(params.intentChainId, BigInt(ctx.chainId))
  }
  verifyTimeBounds(params.blockNumber, params.deadline, ctx.currentBlock)
  const baseToken = verifyTokenAndCap(ctx.tokenRegistry, params.lookupChain, params.baseTokenId, params.capAmount)
  if (params.relayFeeDenominator !== undefined) {
    verifyRelayFee(params.acceptableRelayFee, params.relayFeeDenominator)
  }
  return baseToken
}

export function assertOutflowCovered(
  ctx: { signedBalance: bigint },
  amounts: { amountIn: bigint; amountOut: bigint }
): void {
  const signedSum = ctx.signedBalance + amounts.amountIn
  if (amounts.amountOut > signedSum) {
    throw new CompactContractError('Account__OutflowExceedsSigned', [amounts.amountOut, signedSum])
  }
}
