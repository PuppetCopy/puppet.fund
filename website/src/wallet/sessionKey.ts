import { deriveSessionKey, SIGNER_DERIVATION_MESSAGE, signerProofDigest } from '@puppet/sdk/account'
import { type Address, type Hex, serializeSignature, type WalletClient } from 'viem'
import { sign as ecdsaSign, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

const STORAGE_VERSION = 2

interface IStoredSessionKey {
  v: number
  user: Address
  sig: Hex
  signerProof: Hex
}

export interface ISessionKey {
  user: Address
  signer: Address
  privateKey: Hex
  account: PrivateKeyAccount
  bindSig: Hex
  // ECDSA sig over `signerProofDigest(user)` by the session priv key. Required
  // by the contract's deploy-auth check to prove `params.signer ==
  // ECDSA_address(keccak256(bindSig))` — a leaked bindSig alone can't substitute
  // a different signer because forging a valid signerProof needs the matching
  // ECDSA priv key, which is exactly the value the contract verifies via
  // ecrecover against this digest.
  signerProof: Hex
}

// localStorage keys stay lowercase: opaque storage format, backward-compatible
// with sessions written before checksum normalization was enforced.
const storageKey = (user: Address) => `puppet:session-key:${user.toLowerCase()}`
const cache = new Map<Address, ISessionKey>()

function read(user: Address): IStoredSessionKey | null {
  try {
    const raw = localStorage.getItem(storageKey(user))
    if (!raw) return null
    const parsed = JSON.parse(raw) as IStoredSessionKey
    if (parsed.v !== STORAGE_VERSION) return null
    if (parsed.user.toLowerCase() !== user.toLowerCase()) return null
    return parsed
  } catch {
    return null
  }
}

function write(user: Address, sig: Hex, signerProof: Hex): void {
  const entry: IStoredSessionKey = { v: STORAGE_VERSION, user, sig, signerProof }
  localStorage.setItem(storageKey(user), JSON.stringify(entry))
}

async function buildSessionKey(user: Address, sig: Hex): Promise<ISessionKey> {
  const privateKey = deriveSessionKey(sig)
  const account = privateKeyToAccount(privateKey)
  const signerProof = serializeSignature(await ecdsaSign({ hash: signerProofDigest(user), privateKey }))
  return { user, signer: account.address, privateKey, account, bindSig: sig, signerProof }
}

function buildSessionKeyFromStored(user: Address, sig: Hex, signerProof: Hex): ISessionKey {
  const privateKey = deriveSessionKey(sig)
  const account = privateKeyToAccount(privateKey)
  return { user, signer: account.address, privateKey, account, bindSig: sig, signerProof }
}

export function getStoredSessionKey(user: Address): ISessionKey | null {
  const cached = cache.get(user)
  if (cached) return cached
  const stored = read(user)
  if (!stored) return null
  const key = buildSessionKeyFromStored(user, stored.sig, stored.signerProof)
  cache.set(user, key)
  return key
}

export async function ensureSessionKey(user: Address, walletClient: WalletClient): Promise<ISessionKey> {
  const existing = getStoredSessionKey(user)
  if (existing) return existing

  const sig = await walletClient.signMessage({ account: user, message: SIGNER_DERIVATION_MESSAGE })
  const key = await buildSessionKey(user, sig)
  write(user, sig, key.signerProof)
  cache.set(user, key)
  return key
}

export function revokeSessionKey(user: Address): void {
  cache.delete(user)
  localStorage.removeItem(storageKey(user))
}
