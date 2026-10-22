import { PROTOCOL } from '@puppet/contracts/const'
import type { IFundStore__Credit } from '@puppet/contracts/types'
import { CompactContractError, CompactError } from '../compact/error.js'
import { verifyRelayFeeRatio } from './intentLib.js'
import { type IEscrowCredit, openEscrowOf } from './terms.js'

export function verifyFulfil(
  escrow: Pick<IEscrowCredit, 'escrowed' | 'released' | 'returned'>,
  released: IFundStore__Credit,
  input: IFundStore__Credit
): { amount: bigint; fee: bigint } {
  if (input.total <= released.total) throw new CompactContractError('Escrow__InvalidFulfil', [released.total, input.total])
  if (input.feeTotal < released.feeTotal) {
    throw new CompactError('BAD_REQUEST', `the fee total ${input.feeTotal} is below the ${released.feeTotal} this release already paid`, 'hard')
  }
  const amount = input.total - released.total
  const fee = input.feeTotal - released.feeTotal
  const open = openEscrowOf(escrow)
  if (amount > open) throw new CompactContractError('Balance__InsufficientBalance', [open, amount])
  verifyRelayFeeRatio(fee, amount, PROTOCOL.maxRelayFeeBps)
  return { amount, fee }
}
