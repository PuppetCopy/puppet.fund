import { PRECISION } from '@puppet/contracts/const'
import type { IAccountLib__Mandate } from '@puppet/contracts/types'
import type { Hex } from 'viem'
import { CompactContractError } from '../compact/error.js'

export const backingRoom = (collateral: bigint, skin: bigint): bigint => (collateral * skin) / PRECISION.basisPoints

export function backingCap(mandate: Pick<IAccountLib__Mandate, 'skin' | 'allocationRate'>, collateral: bigint, matchable: bigint): bigint {
  const skinCap = (collateral * mandate.skin) / PRECISION.basisPoints
  const rateCap = (matchable * mandate.allocationRate) / PRECISION.basisPoints
  return rateCap < skinCap ? rateCap : skinCap
}

export const listsToken = (mandate: Pick<IAccountLib__Mandate, 'tokenIdList'>, tokenId: Hex): boolean =>
  mandate.tokenIdList.some(id => id === tokenId)

export function verifySkin(backed: bigint, collateral: bigint, skin: bigint): void {
  if (skin > PRECISION.basisPoints) throw new CompactContractError('Gate__InvalidAllocationRate', [skin])
  if (backed > backingRoom(collateral, skin)) throw new CompactContractError('Operate__SkinExceeded', [backed, collateral])
}

export const settleNet = (amount: bigint, performanceFee: bigint): bigint => amount - (amount * performanceFee) / PRECISION.basisPoints
