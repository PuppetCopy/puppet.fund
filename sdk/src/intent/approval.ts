import { secp256k1 } from '@noble/curves/secp256k1.js'
import { FUND_APPROVAL, MAX_SESSION_BYTES, MAX_SESSION_TTL, SESSION_ENVELOPE, SESSION_REVOKE_DELAY } from '@puppet/contracts/intents'
import { type Address, BaseError, bytesToHex, decodeAbiParameters, type Hex, hashTypedData, hexToBytes, hexToNumber, isAddressEqual, size, slice, zeroAddress } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { sessionTypedData } from '../account/createAccount.js'
import { CompactContractError, CompactError } from '../compact/error.js'

export function recoverAccountSigner(digest: Hex, signature: Hex): Address | null {
  if (size(signature) !== 65) return null
  const v = hexToNumber(slice(signature, 64, 65))
  if (v !== 27 && v !== 28) return null
  try {
    const point = secp256k1.Signature.fromBytes(hexToBytes(slice(signature, 0, 64)), 'compact').addRecoveryBit(v - 27).recoverPublicKey(hexToBytes(digest))
    return publicKeyToAddress(bytesToHex(point.toBytes(false)))
  } catch {
    return null
  }
}

export const approverOf = (coSig: Hex): Hex => {
  if (size(coSig) < 130) throw new CompactContractError('Account__InvalidSignature', [])
  return slice(coSig, 0, size(coSig) - 65)
}

export const revokedAtIn = (rows: readonly { revokedAt: number }[]): bigint =>
  rows.reduce((latest, row) => (BigInt(row.revokedAt) > latest ? BigInt(row.revokedAt) : latest), 0n)

export function verifyRevokeSettled(user: Address, revokedAt: bigint, nowSec: bigint): void {
  const closes = revokedAt + 2n * SESSION_REVOKE_DELAY
  if (nowSec < closes) {
    throw new CompactError(
      'REVOKE_WINDOW',
      `${user} revoked its sessions at ${revokedAt}; nothing is co-signed for it until its wallet's withdraw window closes at ${closes}`,
      'soft'
    )
  }
}

export interface IApprovalAuthority {
  user: Address
  epoch: bigint
  revokedAt: bigint
}

export function verifyApprovalSignature(account: Address, user: Address, digest: Hex, approver: Hex) {
  if (BigInt(size(approver)) > MAX_SESSION_BYTES) {
    throw new CompactError('SIGNATURE_TOO_LARGE', `${account} was approved by a ${size(approver)}-byte signature, above the ${MAX_SESSION_BYTES} bytes a session may carry`, 'hard')
  }
  if (size(approver) === 65) {
    const signed = recoverAccountSigner(digest, approver)
    if (signed === null || !isAddressEqual(signed, user)) {
      throw new CompactError('APPROVAL_NOT_USER', `${account} was approved by a signature its wallet ${user} did not make with its own key`, 'hard')
    }
    return null
  }
  const envelope = sessionEnvelopeOf(approver)
  if (envelope === null) {
    throw new CompactError(
      'APPROVAL_NOT_USER',
      `${account} was approved by neither its wallet's own key nor a session that key granted; Puppet accepts only wallets that sign with their own key, not contract wallets such as multisigs or passkey wallets`,
      'hard'
    )
  }
  const [signer, issuedAt, expiry, epoch, fund, grant, inner] = envelope
  if (signer === zeroAddress) throw new CompactError('SESSION_SIGNER_ZERO', `${account} was approved by a session naming no signer`, 'hard')
  const granter = recoverAccountSigner(sessionDigest(user, signer, issuedAt, expiry, epoch, fund), grant)
  if (granter === null || !isAddressEqual(granter, user)) {
    throw new CompactError('SESSION_NOT_GRANTED', `the session of ${signer} carries no grant made by the own key of ${user}; a contract wallet's grant is not accepted`, 'hard')
  }
  const signed = recoverAccountSigner(digest, inner)
  if (signed === null || !isAddressEqual(signed, signer)) {
    throw new CompactError('SESSION_SIGNER_MISMATCH', `the intent was signed by ${signed ?? 'an unrecoverable signature'}, not the granted signer ${signer}`, 'hard')
  }
  return { signer, issuedAt, expiry, epoch }
}

export function verifyApproval(account: Address, state: IApprovalAuthority, digest: Hex, approver: Hex, nowSec: bigint, until: bigint): void {
  const session = verifyApprovalSignature(account, state.user, digest, approver)
  if (session === null) return
  const { signer, issuedAt, expiry, epoch } = session
  if (issuedAt > nowSec) throw new CompactError('SESSION_NOT_YET_ISSUED', `the session of ${signer} is dated ${issuedAt}, ahead of the chain clock ${nowSec}`, 'hard')
  if (nowSec > expiry || until > expiry) {
    throw new CompactError('SESSION_EXPIRED', `the session of ${signer} expires at ${expiry}, before ${until}, the last moment its approval must hold on chain`, 'hard')
  }
  if (expiry > issuedAt + MAX_SESSION_TTL) {
    throw new CompactError('SESSION_TOO_LONG', `the session of ${signer} runs ${expiry - issuedAt}s from its grant, past the ${MAX_SESSION_TTL}s the gate accepts`, 'hard')
  }
  if (issuedAt <= state.revokedAt) {
    throw new CompactError(
      'SESSION_REVOKED',
      `the session of ${signer} was granted at ${issuedAt}, at or before the revocation at ${state.revokedAt} on one of this account's chains; grant a new session`,
      'hard'
    )
  }
  if (epoch !== state.epoch) {
    throw new CompactError(
      'SESSION_NOT_GRANTED',
      `the session of ${signer} was granted at epoch ${epoch}, but ${account} is at epoch ${state.epoch}; a revoke retires every earlier grant`,
      'hard'
    )
  }
}

export function sessionEnvelopeOf(signature: Hex) {
  try {
    return decodeAbiParameters(SESSION_ENVELOPE, signature)
  } catch (err) {
    if (err instanceof BaseError) return null
    throw err
  }
}

export function verifyFundApproval(user: Address, fund: Address, approval: Hex): void {
  const [signer, issuedAt, expiry, epoch, grant] = decodeAbiParameters(FUND_APPROVAL, approval)
  const granter = recoverAccountSigner(sessionDigest(user, signer, issuedAt, expiry, epoch, fund), grant)
  if (granter === null || !isAddressEqual(granter, user)) {
    throw new CompactError('APPROVAL_NOT_USER', `${fund} carries no grant made by the own key of ${user} naming it, so its account cannot be created; a contract wallet's grant is not accepted`, 'hard')
  }
}

export const sessionDigest = (user: Address, signer: Address, issuedAt: bigint, expiry: bigint, epoch: bigint, fund: Address): Hex =>
  hashTypedData(sessionTypedData({ user, signer, issuedAt, expiry, epoch, fund }))
