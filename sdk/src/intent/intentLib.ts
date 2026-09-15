import { PRECISION, PROTOCOL } from '@puppet/contracts/const'
import type { Address } from 'viem'
import { CompactContractError } from '../compact/error.js'
import type { ChainId } from '../const/index.js'
import { type ITokenRegistryMap, tokenInfoFor } from '../state/tokenRegistry.js'

export function verifyDeadline(deadline: bigint): void {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  if (nowSec > deadline) {
    throw new CompactContractError('Intent__ExpiredDeadline', [deadline, nowSec])
  }
  if (deadline > nowSec + PROTOCOL.maxIntentTtlSec) {
    throw new CompactContractError('Intent__DeadlineTooFar', [deadline, nowSec, PROTOCOL.maxIntentTtlSec])
  }
}

export function verifyRelayFeeRatio(relayFee: bigint, extractable: bigint): void {
  if (relayFee * PRECISION.basisPoints > extractable * PROTOCOL.maxRelayFeeBps) {
    throw new CompactContractError('Intent__RelayFeeRatioExceeded', [relayFee, extractable, PROTOCOL.maxRelayFeeBps])
  }
}

export function verifyRegisteredTokenCap(
  registry: ITokenRegistryMap,
  chainId: ChainId,
  token: Address,
  amount: bigint
): void {
  const info = tokenInfoFor(registry, chainId, token)
  if (info.registeredCap === 0n) {
    throw new CompactContractError('Intent__TokenNotValuable', [token])
  }
  if (amount > info.registeredCap) {
    throw new CompactContractError('Intent__AmountExceedsCap', [amount, info.registeredCap])
  }
}
