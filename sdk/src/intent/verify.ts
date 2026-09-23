import {
  type Address,
  compactSignatureToSignature,
  decodeAbiParameters,
  type Hex,
  hexToNumber,
  isAddressEqual,
  parseCompactSignature,
  recoverAddress,
  serializeSignature,
  size,
  slice,
  zeroHash
} from 'viem'
import { sessionDigest } from './approval.js'

export async function recoverAccountSigner(digest: Hex, signature: Hex): Promise<Address | null> {
  if (size(signature) !== 65) return null
  const v = hexToNumber(slice(signature, 64, 65))
  if (v !== 27 && v !== 28) return null
  return recoverAddress({ hash: digest, signature })
}

const landedSignature = (signature: Hex): Hex =>
  size(signature) === 64 ? serializeSignature(compactSignatureToSignature(parseCompactSignature(signature))) : signature

interface IAccountAuthority {
  user: Address
  attestor: Address
  epoch: bigint
}

type IAccountCallProof =
  | { kind: 'key' }
  | { kind: 'record' }
  | { kind: 'wallet'; attestor: Address }
  | { kind: 'session'; signer: Address; attestor: Address }

const SESSION_ENVELOPE = [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }] as const

export async function verifyAccountCall(
  entry: { account: Address; nonce: bigint; digest: Hex; signature: Hex },
  authority: IAccountAuthority
): Promise<IAccountCallProof | null> {
  if (entry.digest === zeroHash) return null
  const signature = landedSignature(entry.signature)
  const where = `entry ${entry.account}#${entry.nonce}`
  if (size(signature) === 0) return { kind: 'record' }
  if (size(signature) === 65) {
    const recovered = await recoverAddress({ hash: entry.digest, signature })
    if (isAddressEqual(recovered, entry.account)) return { kind: 'key' }
    throw new Error(`${where}: 65-byte signature recovered to ${recovered}, which is not the account's own key`)
  }
  if (size(signature) < 130) throw new Error(`${where}: ${size(signature)}-byte signature is neither a key signature nor a co-signature`)
  const attestation = slice(signature, size(signature) - 65)
  const attestor = await recoverAddress({ hash: entry.digest, signature: attestation })
  if (!isAddressEqual(attestor, authority.attestor)) {
    throw new Error(`${where}: attested by ${attestor}, not the gate's attestor ${authority.attestor}`)
  }
  const approver = slice(signature, 0, size(signature) - 65)
  if (size(approver) === 65) {
    const recovered = await recoverAddress({ hash: entry.digest, signature: approver })
    if (!isAddressEqual(recovered, authority.user)) {
      throw new Error(`${where}: approved by ${recovered}, not the account's wallet ${authority.user}`)
    }
    return { kind: 'wallet', attestor }
  }
  const [signer, issuedAt, expiry, grant, inner] = decodeAbiParameters(SESSION_ENVELOPE, approver)
  const granter = await recoverAccountSigner(sessionDigest(authority.user, signer, issuedAt, expiry, authority.epoch), grant)
  if (granter === null || !isAddressEqual(granter, authority.user)) {
    throw new Error(
      `${where}: the session of ${signer} carries no grant this device can recover to ${authority.user} at epoch ${authority.epoch}; a grant signed by a contract wallet can only be verified on chain`
    )
  }
  const signed = await recoverAccountSigner(entry.digest, inner)
  if (signed === null || !isAddressEqual(signed, signer)) {
    throw new Error(`${where}: signed by ${signed ?? 'an unrecoverable signature'}, not the granted signer ${signer}`)
  }
  return { kind: 'session', signer, attestor }
}
