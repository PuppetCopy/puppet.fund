import { CHAIN_META, PRECISION, PROTOCOL } from '@puppet/contracts/const'
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

export function blockDelayFor(chainId: number | bigint): bigint {
  const meta = (CHAIN_META as Record<number, { blockDelay: bigint } | undefined>)[Number(chainId)]
  if (meta === undefined) {
    throw new Error(`no CHAIN_META configured for chain ${chainId}`)
  }
  return meta.blockDelay
}

export function verifyTimeBounds(
  blockNumber: bigint,
  deadline: bigint,
  currentBlock: bigint,
  chainId: number | bigint
): void {
  verifyDeadline(deadline)
  if (blockNumber > currentBlock) {
    throw new CompactContractError('Intent__StaleSignature', [blockNumber, currentBlock, 0n])
  }
  const maxBlockDelay = blockDelayFor(chainId)
  if (currentBlock > blockNumber + maxBlockDelay) {
    throw new CompactContractError('Intent__StaleSignature', [blockNumber, currentBlock, maxBlockDelay])
  }
}

export function verifyTokenAndCap(
  registry: ITokenRegistryMap,
  chainId: ChainId,
  token: Address,
  amount: bigint
): void {
  const info = tokenInfoFor(registry, chainId, token)
  if (info.cap > 0n && amount > info.cap) {
    throw new CompactContractError('Intent__AmountExceedsCap', [amount, info.cap])
  }
}

export function verifyRelayFee(acceptableRelayFee: bigint, amount: bigint): void {
  if (amount > 0n && acceptableRelayFee * PRECISION.basisPoints > amount * PROTOCOL.maxRelayFeeBps) {
    throw new CompactContractError('Intent__RelayFeeRatioExceeded', [
      acceptableRelayFee,
      amount,
      PROTOCOL.maxRelayFeeBps
    ])
  }
}

interface ICommonAttestContext {
  chainId: ChainId
  currentBlock: bigint
  tokenRegistry: ITokenRegistryMap
}

interface IVerifyCommonIntentParams {
  blockNumber: bigint
  deadline: bigint
  intentChainId?: bigint
  baseToken: Address
  lookupChain: ChainId
  capAmount: bigint
  acceptableRelayFee: bigint
  relayFeeDenominator?: bigint
}

export function verifyCommonIntent(ctx: ICommonAttestContext, params: IVerifyCommonIntentParams): Address {
  if (params.intentChainId !== undefined) {
    verifyChainId(params.intentChainId, BigInt(ctx.chainId))
  }
  verifyTimeBounds(params.blockNumber, params.deadline, ctx.currentBlock, ctx.chainId)
  verifyTokenAndCap(ctx.tokenRegistry, params.lookupChain, params.baseToken, params.capAmount)
  if (params.relayFeeDenominator !== undefined) {
    verifyRelayFee(params.acceptableRelayFee, params.relayFeeDenominator)
  }
  return params.baseToken
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
