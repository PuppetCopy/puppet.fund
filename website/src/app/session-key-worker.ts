import type { ISessionKeyAsk, ISessionKeyReply, ISessionKeyRequest } from '@puppet/sdk/client'
import { bytesToHex, concat, type Hex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const opening = indexedDB.open('session-keys', 1)
opening.onupgradeneeded = () => opening.result.createObjectStore('keys')
const database = settled(opening)

const wrapping = (async (): Promise<CryptoKey> => {
  const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const keys = (await database).transaction('keys', 'readwrite').objectStore('keys')
  const held = await settled<CryptoKey | undefined>(keys.get('wrap'))
  if (held !== undefined) return held
  await settled(keys.add(fresh, 'wrap'))
  return fresh
})()

const answer = async (ask: ISessionKeyAsk): Promise<{ value: Hex } | { lost: string }> => {
  const wrap = await wrapping
  if (ask.op === 'mint') {
    const key = generatePrivateKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrap, new Uint8Array(hexToBytes(key)))
    return { value: concat([privateKeyToAccount(key).address, bytesToHex(iv), bytesToHex(new Uint8Array(sealed))]) }
  }
  const sealed = hexToBytes(ask.sealed)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(20, 32) }, wrap, sealed.slice(32)).then(
    async key => ({ value: await privateKeyToAccount(bytesToHex(new Uint8Array(key))).sign({ hash: ask.digest }) }),
    (error: unknown) => ({ lost: `this browser can no longer open the session key it stored (${error instanceof Error ? error.name : String(error)}); sign a new session` })
  )
}

self.onmessage = ({ data }: MessageEvent<ISessionKeyRequest>) => {
  answer(data).then(
    reply => self.postMessage({ id: data.id, ...reply } satisfies ISessionKeyReply),
    (error: unknown) => self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies ISessionKeyReply)
  )
}
