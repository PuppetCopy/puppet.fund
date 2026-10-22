import { secp256k1 } from '@noble/curves/secp256k1.js'
import { FUND_APPROVAL, MAX_SESSION_BYTES, MAX_SESSION_TTL, SESSION_ENVELOPE, SESSION_REVOKE_DELAY, WALLET_SIGNATURE_TAG } from '@puppet/contracts/intents'
import {
  type Address,
  BaseError,
  bytesToHex,
  decodeAbiParameters,
  ExecutionRevertedError,
  encodeFunctionData,
  type Hex,
  hashTypedData,
  hexToBytes,
  hexToNumber,
  isAddressEqual,
  type PublicClient,
  parseAbi,
  size,
  slice,
  zeroAddress
} from 'viem'
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

const ERC1271_ABI = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'])
const ERC1271_MAGIC = '0x1626ba7e'

async function signedBy(client: PublicClient, user: Address, digest: Hex, signature: Hex): Promise<boolean> {
  const recovered = recoverAccountSigner(digest, signature)
  if (recovered !== null && isAddressEqual(recovered, user)) return true
  const code = await client.getCode({ address: user })
  if (code === undefined || code === '0x') return false
  const answer = await client.call({ to: user, data: encodeFunctionData({ abi: ERC1271_ABI, functionName: 'isValidSignature', args: [digest, signature] }) }).then(
    result => result.data,
    (err: unknown) => {
      if (err instanceof BaseError && err.walk(cause => cause instanceof ExecutionRevertedError) !== null) return undefined
      throw err
    }
  )
  return answer !== undefined && size(answer) >= 4 && slice(answer, 0, 4) === ERC1271_MAGIC
}

interface IApproval {
  kind: 'wallet' | 'session'
  signer: Address
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

export async function verifyApproval(
  client: PublicClient,
  account: Address,
  state: IApprovalAuthority,
  digest: Hex,
  approver: Hex,
  nowSec: bigint,
  until: bigint
): Promise<IApproval> {
  if (BigInt(size(approver)) > MAX_SESSION_BYTES) {
    throw new CompactError('SIGNATURE_TOO_LARGE', `${account} was approved by a ${size(approver)}-byte signature, above the ${MAX_SESSION_BYTES} bytes a session may carry`, 'hard')
  }
  if (walletSigned(approver)) {
    throw new CompactError(
      'WALLET_SIGNATURE_UNRELAYED',
      `${account} was approved by its wallet's own tagged signature, which the account accepts but this relay does not co-sign yet; approve through a session`,
      'hard'
    )
  }
  if (size(approver) === 65) {
    if (!(await signedBy(client, state.user, digest, approver))) {
      throw new CompactError('APPROVAL_NOT_USER', `${account} was approved by a signature its wallet ${state.user} did not make`, 'hard')
    }
    return { kind: 'wallet', signer: state.user }
  }
  const [signer, issuedAt, expiry, epoch, fund, grant, inner] = decodeAbiParameters(SESSION_ENVELOPE, approver)
  if (signer === zeroAddress) throw new CompactError('SESSION_SIGNER_ZERO', `${account} was approved by a session naming no signer`, 'hard')
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
  if (!(await signedBy(client, state.user, sessionDigest(state.user, signer, issuedAt, expiry, epoch, fund), grant))) {
    throw new CompactError(
      'SESSION_NOT_GRANTED',
      `the session of ${signer} carries no grant from ${state.user} at epoch ${state.epoch}; a revoke on this chain invalidates every earlier grant`,
      'hard'
    )
  }
  const signed = recoverAccountSigner(digest, inner)
  if (signed === null || !isAddressEqual(signed, signer)) {
    throw new CompactError('SESSION_SIGNER_MISMATCH', `the intent was signed by ${signed ?? 'an unrecoverable signature'}, not the granted signer ${signer}`, 'hard')
  }
  return { kind: 'session', signer }
}

const walletSigned = (signature: Hex): boolean => size(signature) > 32 && slice(signature, 0, 32) === WALLET_SIGNATURE_TAG

export const sessionExpiryOf = (signature: Hex): bigint | null =>
  size(signature) === 65 || walletSigned(signature) ? null : decodeAbiParameters(SESSION_ENVELOPE, signature)[2]

export function sessionEnvelopeOf(signature: Hex) {
  if (walletSigned(signature)) return null
  try {
    return decodeAbiParameters(SESSION_ENVELOPE, signature)
  } catch (err) {
    if (err instanceof BaseError) return null
    throw err
  }
}

export function approvesWithoutCode(user: Address, digest: Hex, signature: Hex): boolean {
  if (size(signature) === 65) {
    const recovered = recoverAccountSigner(digest, signature)
    return recovered !== null && isAddressEqual(recovered, user)
  }
  const envelope = sessionEnvelopeOf(signature)
  if (envelope === null) return false
  const [signer, issuedAt, expiry, epoch, fund, grant] = envelope
  const granter = recoverAccountSigner(sessionDigest(user, signer, issuedAt, expiry, epoch, fund), grant)
  return granter !== null && isAddressEqual(granter, user)
}

export async function verifyFundApproval(client: PublicClient, user: Address, fund: Address, approval: Hex): Promise<void> {
  const [signer, issuedAt, expiry, epoch, grant] = decodeAbiParameters(FUND_APPROVAL, approval)
  if (!(await signedBy(client, user, sessionDigest(user, signer, issuedAt, expiry, epoch, fund), grant))) {
    throw new CompactError('APPROVAL_NOT_USER', `${fund} carries no grant from ${user} naming it, so its account cannot be created`, 'hard')
  }
}

export const sessionDigest = (user: Address, signer: Address, issuedAt: bigint, expiry: bigint, epoch: bigint, fund: Address): Hex =>
  hashTypedData(sessionTypedData({ user, signer, issuedAt, expiry, epoch, fund }))
