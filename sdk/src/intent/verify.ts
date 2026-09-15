import { type Address, compactSignatureToSignature, type Hex, hexToNumber, isAddressEqual, parseCompactSignature, recoverAddress, serializeSignature, size, slice, zeroHash } from 'viem'

export async function recoverAccountSigner(digest: Hex, signature: Hex): Promise<Address | null> {
  if (size(signature) !== 65) return null
  const v = hexToNumber(slice(signature, 64, 65))
  if (v !== 27 && v !== 28) return null
  return recoverAddress({ hash: digest, signature })
}

export const landedSignature = (signature: Hex): Hex =>
  size(signature) === 64 ? serializeSignature(compactSignatureToSignature(parseCompactSignature(signature))) : signature

export interface IBodyAuthority {
  signer: Address
  attestor: Address
}

export type IAccountCallProof =
  | { kind: 'key' }
  | { kind: 'record' }
  | { kind: 'mandate'; signer: Address }
  | { kind: 'pair'; attestor: Address }

export async function verifyAccountCall(
  entry: { account: Address; nonce: bigint; digest: Hex; signature: Hex },
  authority: IBodyAuthority
): Promise<IAccountCallProof | null> {
  if (entry.digest === zeroHash) return null
  const signature = landedSignature(entry.signature)
  if (size(signature) === 0) return { kind: 'record' }
  if (size(signature) === 65) {
    const recovered = await recoverAddress({ hash: entry.digest, signature })
    if (isAddressEqual(recovered, entry.account)) return { kind: 'key' }
    if (isAddressEqual(recovered, authority.signer)) return { kind: 'mandate', signer: recovered }
    throw new Error(
      `entry ${entry.account}#${entry.nonce}: 65-byte signature recovered to ${recovered}, which is neither the body's own key nor its signer ${authority.signer}`
    )
  }
  if (size(signature) < 130) throw new Error(`entry ${entry.account}#${entry.nonce}: ${size(signature)}-byte signature is neither a key signature nor a pair`)
  const signer = await recoverAddress({ hash: entry.digest, signature: slice(signature, 0, 65) })
  if (!isAddressEqual(signer, authority.signer)) {
    throw new Error(`entry ${entry.account}#${entry.nonce}: pair signed by ${signer}, not the body's signer ${authority.signer}`)
  }
  const attestation = slice(signature, 65)
  if (size(attestation) !== 65) {
    throw new Error(`entry ${entry.account}#${entry.nonce}: the attestor half is ${size(attestation)} bytes; only a 65-byte attestor signature can be verified off-chain`)
  }
  const attestor = await recoverAddress({ hash: entry.digest, signature: attestation })
  if (!isAddressEqual(attestor, authority.attestor)) {
    throw new Error(`entry ${entry.account}#${entry.nonce}: attested by ${attestor}, not the gate's attestor ${authority.attestor}`)
  }
  return { kind: 'pair', attestor }
}
