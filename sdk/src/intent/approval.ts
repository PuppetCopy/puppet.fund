import { MAX_SESSION_TTL } from '@puppet/contracts/intents'
import { type Address, decodeAbiParameters, type Hex, hashTypedData, isAddressEqual, type PublicClient, size, slice } from 'viem'
import { verifyTypedData } from 'viem/actions'
import { sessionTypedData } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'
import { recoverAccountSigner } from './verify.js'

interface IApproval {
  kind: 'wallet' | 'session'
  signer: Address
}

const SESSION_ENVELOPE = [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }] as const

export const approverOf = (coSig: Hex): Hex => {
  if (size(coSig) < 130) throw new CompactContractError('Account__InvalidSignature', [])
  return slice(coSig, 0, size(coSig) - 65)
}

export interface IApprovalAuthority {
  user: Address
  epoch: bigint
  revokedAt: bigint
}

export async function verifyApproval(
  client: PublicClient,
  account: Address,
  state: IApprovalAuthority,
  digest: Hex,
  approver: Hex,
  nowSec: bigint
): Promise<IApproval> {
  if (size(approver) === 65) {
    const recovered = await recoverAccountSigner(digest, approver)
    if (recovered === null || !isAddressEqual(recovered, state.user)) {
      throw new CompactError('APPROVAL_NOT_USER', `${account} was approved by ${recovered ?? 'an unrecoverable signature'}, not its wallet ${state.user}`, 'hard')
    }
    return { kind: 'wallet', signer: state.user }
  }
  const [signer, issuedAt, expiry, grant, inner] = decodeAbiParameters(SESSION_ENVELOPE, approver)
  if (issuedAt > nowSec) throw new CompactError('SESSION_NOT_YET_ISSUED', `the session of ${signer} is dated ${issuedAt}, ahead of the chain clock ${nowSec}`, 'hard')
  if (nowSec > expiry) throw new CompactError('SESSION_EXPIRED', `the session of ${signer} expired at ${expiry}`, 'hard')
  if (expiry > nowSec + MAX_SESSION_TTL) {
    throw new CompactError('SESSION_TOO_LONG', `the session of ${signer} runs to ${expiry}, past the ${MAX_SESSION_TTL}s the gate accepts`, 'hard')
  }
  if (issuedAt <= state.revokedAt) {
    throw new CompactError(
      'SESSION_REVOKED',
      `the session of ${signer} was granted at ${issuedAt}, at or before the revocation at ${state.revokedAt} on one of this account's chains; grant a new session`,
      'hard'
    )
  }
  const granted = await verifyTypedData(client, {
    address: state.user,
    ...sessionTypedData({ user: state.user, signer, issuedAt, expiry, epoch: state.epoch }),
    signature: grant
  })
  if (!granted) {
    throw new CompactError(
      'SESSION_NOT_GRANTED',
      `the session of ${signer} carries no grant from ${state.user} at epoch ${state.epoch}; a revoke on this chain invalidates every earlier grant`,
      'hard'
    )
  }
  const signed = await recoverAccountSigner(digest, inner)
  if (signed === null || !isAddressEqual(signed, signer)) {
    throw new CompactError('SESSION_SIGNER_MISMATCH', `the intent was signed by ${signed ?? 'an unrecoverable signature'}, not the granted signer ${signer}`, 'hard')
  }
  return { kind: 'session', signer }
}

export const sessionDigest = (user: Address, signer: Address, issuedAt: bigint, expiry: bigint, epoch: bigint): Hex =>
  hashTypedData(sessionTypedData({ user, signer, issuedAt, expiry, epoch }))
