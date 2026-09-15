import type { IBodySigner } from '@puppet/sdk/account'
import { SESSION_TTL_MS, sessionTypedData } from '@puppet/sdk/account'
import { bodyBindingTypedData, bodyKeyMaterial, bodyKeyTypedData, createMpcClient } from '@puppet/sdk/mpc'
import { type Address, getAddress, type Hex, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicKeyToAddress } from 'viem/utils'
import type { IConnectedWallet } from './connectedWallet.js'
import type { IBodyKeyRecord, IBodyKeys } from './root.js'

const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const shareKey = (user: Address): string => `puppet:body-share:${user.toLowerCase()}`

const readKeys = (user: Address): IBodyKeyRecord | null => {
  const key = shareKey(getAddress(user))
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  const cached = JSON.parse(raw) as IBodyKeyRecord & { expiresAt: number }
  if (
    cached.expiresAt > Date.now() &&
    cached.signer !== undefined &&
    cached.session !== undefined &&
    cached.sessionExpiry !== undefined &&
    cached.user !== undefined &&
    cached.funded !== undefined
  ) {
    return {
      share: cached.share,
      signer: cached.signer,
      user: getAddress(cached.user),
      session: cached.session,
      sessionExpiry: BigInt(cached.sessionExpiry),
      funded: { chainId: cached.funded.chainId, token: getAddress(cached.funded.token) }
    }
  }
  localStorage.removeItem(key)
  return null
}

export function createBodyKeys(mpcUrl: string, fundedOf: (user: Address) => Promise<{ chainId: number; token: Address }>): IBodyKeys {
  const mpc = createMpcClient(mpcUrl)
  const claimOf = async (keys: IBodyKeyRecord, signerAccount: ReturnType<typeof privateKeyToAccount>) => ({
    ...keys.funded,
    user: keys.user,
    signer: signerAccount.address,
    expiry: keys.sessionExpiry,
    session: keys.session,
    request: await signerAccount.signTypedData(bodyBindingTypedData(keys.share.sid))
  })

  const signerOf = (keys: IBodyKeyRecord): IBodySigner => {
    const signerAccount = privateKeyToAccount(keys.signer)
    return {
      account: publicKeyToAddress(keys.share.pk),
      signer: signerAccount.address,
      signIntent: (digest: Hex) => signerAccount.sign({ hash: digest }),
      sign: async request => mpc.sign(keys.share, request, await claimOf(keys, signerAccount))
    }
  }

  return {
    async derive(wallet: IConnectedWallet, named?: { chainId: number; token: Address }, onSigned?: (step: 'key' | 'session') => void) {
      const user = getAddress(wallet.address)
      const funded = named === undefined ? await fundedOf(wallet.address) : { chainId: named.chainId, token: getAddress(named.token) }
      const signature = await wallet.walletClient.signTypedData({ account: wallet.address, ...bodyKeyTypedData() })
      onSigned?.('key')
      const { sid, sk, signer } = bodyKeyMaterial(signature)
      const signerAccount = privateKeyToAccount(toHex(signer, { size: 32 }))
      const sessionExpiry = BigInt(Math.floor((Date.now() + SESSION_TTL_MS) / 1000))
      const session = await wallet.walletClient.signTypedData({
        account: wallet.address,
        ...sessionTypedData({ user, signer: signerAccount.address, expiry: sessionExpiry })
      })
      const share = await mpc.keygen(sid, sk, {
        ...funded,
        user,
        signer: signerAccount.address,
        expiry: sessionExpiry,
        session,
        request: await signerAccount.signTypedData(bodyBindingTypedData(sid))
      })
      onSigned?.('session')
      const keys: IBodyKeyRecord = { share, signer: toHex(signer, { size: 32 }), user, session, sessionExpiry, funded }
      localStorage.setItem(shareKey(wallet.address), JSON.stringify({ ...keys, sessionExpiry: keys.sessionExpiry.toString(), expiresAt: Date.now() + SHARE_TTL_MS }))
      return signerOf(keys)
    },
    accountOf(user: Address) {
      const keys = readKeys(user)
      return keys === null ? null : publicKeyToAddress(keys.share.pk)
    },
    async signerOf(user: Address) {
      const keys = readKeys(user)
      return keys === null ? null : signerOf(keys)
    },
    keysOf: readKeys
  }
}
