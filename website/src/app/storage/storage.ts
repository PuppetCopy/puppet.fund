import { type IDeviceStore, RECORDS_FINGERPRINT } from '@puppet/sdk/client'
import { decode, encode } from '@puppet/sdk/compact'
import { awaitPromises, continueWith, type IStream, just, map, op } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'

const NAME = `device:${RECORDS_FINGERPRINT}`
const STORED_AT = 'x-stored-at'
const EXPIRES_AT = 'x-expires-at'
const urlOf = (key: string): string => `/device/${encodeURIComponent(key)}`
const expired = (held: Response, now: number): boolean => {
  const expires = held.headers.get(EXPIRES_AT)
  return expires !== null && Number(expires) <= now
}

export const device: IDeviceStore = {
  async read<T>(key: string): Promise<{ value: T; at: number } | null> {
    if (typeof caches === 'undefined') return null
    try {
      const cache = await caches.open(NAME)
      const held = await cache.match(urlOf(key))
      if (held === undefined) return null
      if (expired(held, Date.now())) {
        await cache.delete(urlOf(key))
        return null
      }
      return { value: decode(await held.text()) as T, at: Number(held.headers.get(STORED_AT)) }
    } catch (err) {
      reportFailure(err)
      return null
    }
  },
  async write(key: string, value: unknown, ttlMs?: number): Promise<void> {
    if (typeof caches === 'undefined') return
    const now = Date.now()
    await caches
      .open(NAME)
      .then(cache => cache.put(urlOf(key), new Response(encode(value), { headers: { [STORED_AT]: String(now), ...(ttlMs === undefined ? {} : { [EXPIRES_AT]: String(now + ttlMs) }) } })))
      .catch(reportFailure)
  }
}

export async function dropStaleDevice(): Promise<void> {
  if (typeof caches === 'undefined') return
  for (const name of await caches.keys()) {
    if (name.startsWith('device:') && name !== NAME) await caches.delete(name)
  }
  const cache = await caches.open(NAME)
  const now = Date.now()
  await Promise.all(
    (await cache.keys()).map(async request => {
      const held = await cache.match(request)
      if (held !== undefined && expired(held, now)) await cache.delete(request)
    })
  )
}

let lastFailure: unknown = null
const failureWatchers = new Set<(error: unknown) => void>()

export const reportFailure = (error: unknown): void => {
  lastFailure = error
  for (const watch of failureWatchers) watch(error)
}

export const storageFailure: IStream<unknown> = fromCallback(emit => {
  if (lastFailure !== null) emit(lastFailure)
  failureWatchers.add(emit)
  return () => {
    failureWatchers.delete(emit)
  }
})

export const replayWrite = <T>(key: string, initial: T, changes: IStream<T>): IStream<T> =>
  op(
    just(key),
    map(at => device.read<T>(at).then(held => (held === null ? initial : held.value))),
    awaitPromises,
    continueWith(() =>
      awaitPromises(
        map(async (value: T) => {
          await device.write(key, value)
          return value
        }, changes)
      )
    )
  )
