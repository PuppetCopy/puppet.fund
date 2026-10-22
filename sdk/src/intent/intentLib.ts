import { PROTOCOL } from '@puppet/contracts/const'
import type { Address } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { PRECISION, PRICED_DEADLINE_SEC } from '../const/common.js'
import type { ChainId } from '../const/index.js'
import { tokenMetaOf } from '../state/tokenRegistry.js'

export function verifyDeadline(deadline: bigint, now: bigint): void {
  if (now > deadline) {
    throw new CompactContractError('Intent__ExpiredDeadline', [deadline, now])
  }
  if (deadline > now + PROTOCOL.maxIntentTtlSec) {
    throw new CompactContractError('Intent__DeadlineTooFar', [deadline, now, PROTOCOL.maxIntentTtlSec])
  }
}

export function verifyPricedDeadline(deadline: bigint, now: bigint): void {
  if (deadline > now + BigInt(PRICED_DEADLINE_SEC)) {
    throw new CompactError(
      'DEADLINE_TOO_FAR',
      `this intent carries a price, so it may stay landable for ${PRICED_DEADLINE_SEC}s at most; its deadline ${deadline} is ${deadline - now}s past the chain clock ${now}`,
      'hard'
    )
  }
}

export function verifyRelayFeeRatio(relayFee: bigint, extractable: bigint, maxRelayFeeBps: bigint): void {
  if (relayFee * PRECISION.basisPoints > extractable * maxRelayFeeBps) {
    throw new CompactContractError('Intent__RelayFeeRatioExceeded', [relayFee, extractable, maxRelayFeeBps])
  }
}

export function verifyOracleFed(chainId: ChainId, token: Address): void {
  tokenMetaOf(chainId, token)
}
