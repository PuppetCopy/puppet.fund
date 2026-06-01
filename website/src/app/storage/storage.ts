import { awaitPromises, continueWith, type IStream, just, map, op } from 'aelea/stream'

export interface IStreamStoreKey<T> {
  readonly dbName: string
  readonly storeName: string
  readonly key: string
  readonly initialValue: T
}

export type IStoreDefinition<TStore extends Record<string, Record<string, unknown>>> = {
  [P in keyof TStore]: { [K in keyof TStore[P]]: IStreamStoreKey<TStore[P][K]> }
}

const dbConnectionMap = new Map<string, Promise<IDBDatabase>>()

const META_STORE = '__schema_meta__'
const META_KEY = 'previousDeclared'

const wrapError = (e: unknown, fallback: string): Error => (e instanceof Error ? e : new Error(fallback))

function openConnection(name: string, version: number, storeNames: readonly string[]): Promise<IDBDatabase> {
  const cached = dbConnectionMap.get(name)
  if (cached) return cached

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }

    const request = indexedDB.open(name, version)

    // Two-generation retention: orphaned stores survive one upgrade as a
    // backup, then get removed on the next. The meta store remembers what
    // was declared last upgrade so this one can tell "newly orphaned" from
    // "already-2-gen-old".
    request.onupgradeneeded = () => {
      const db = request.result
      const upgradeTx = request.transaction
      const declared = new Set<string>(storeNames)

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }

      const metaStore = upgradeTx?.objectStore(META_STORE)
      const prevReq = metaStore?.get(META_KEY)

      const applyMigration = (previousDeclared: ReadonlySet<string>) => {
        // Delete stores that are neither declared now nor were declared at
        // the last upgrade — they're at least two generations old.
        for (const existing of Array.from(db.objectStoreNames)) {
          if (existing === META_STORE) continue
          if (declared.has(existing)) continue
          if (previousDeclared.has(existing)) continue
          db.deleteObjectStore(existing)
        }
        for (const storeName of storeNames) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName)
          }
        }
        metaStore?.put(storeNames.slice(), META_KEY)
      }

      if (!prevReq) {
        applyMigration(new Set())
      } else {
        prevReq.onsuccess = () => {
          const value = prevReq.result
          const list = Array.isArray(value) ? (value as string[]) : []
          applyMigration(new Set(list))
        }
      }
    }

    request.onsuccess = () => {
      const db = request.result
      // Yield this connection so another tab's higher-version upgrade isn't blocked.
      db.onversionchange = () => {
        db.close()
        if (dbConnectionMap.get(name) === promise) dbConnectionMap.delete(name)
      }
      db.onclose = () => {
        if (dbConnectionMap.get(name) === promise) dbConnectionMap.delete(name)
      }
      resolve(db)
    }

    request.onerror = () => reject(wrapError(request.error, `IndexedDB open failed: ${name}`))
    request.onblocked = () => reject(new Error(`IndexedDB upgrade for "${name}" blocked by another open tab`))
  })

  dbConnectionMap.set(name, promise)
  promise.catch(() => {
    if (dbConnectionMap.get(name) === promise) dbConnectionMap.delete(name)
  })
  return promise
}

async function requireDb(dbName: string): Promise<IDBDatabase> {
  const cached = dbConnectionMap.get(dbName)
  if (!cached) {
    throw new Error(`uiStorage: db "${dbName}" was not initialised — call createStoreDefinition first`)
  }
  return cached
}

async function getValue<T>(storeKey: IStreamStoreKey<T>): Promise<T> {
  const db = await requireDb(storeKey.dbName)

  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(storeKey.storeName, 'readonly')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        resolve(storeKey.initialValue)
        return
      }
      reject(wrapError(e, 'IndexedDB transaction failed'))
      return
    }

    const req = tx.objectStore(storeKey.storeName).get(storeKey.key)
    req.onsuccess = () => {
      const value = req.result
      resolve(value === undefined ? storeKey.initialValue : (value as T))
    }
    req.onerror = () => reject(wrapError(req.error, 'IndexedDB read failed'))
  })
}

async function putValue<T>(storeKey: IStreamStoreKey<T>, value: T): Promise<void> {
  const db = await requireDb(storeKey.dbName)

  return new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(storeKey.storeName, 'readwrite')
    } catch (e) {
      reject(wrapError(e, 'IndexedDB transaction failed'))
      return
    }
    tx.objectStore(storeKey.storeName).put(value, storeKey.key)
    // Resolve on commit, not request-success — the write isn't durable until oncomplete.
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(wrapError(tx.error, 'IndexedDB write failed'))
    tx.onabort = () => reject(wrapError(tx.error, 'IndexedDB write aborted'))
  })
}

export function createStoreDefinition<TStore extends Record<string, Record<string, unknown>>>(
  dbName: string,
  dbVersion: number,
  storeDefinitions: TStore
): IStoreDefinition<TStore> {
  const storeNames = Object.keys(storeDefinitions)

  void openConnection(dbName, dbVersion, storeNames).catch(err => {
    console.error('[uiStorage] failed to open database', dbName, err)
  })

  const result = {} as Record<string, Record<string, IStreamStoreKey<unknown>>>
  for (const storeName of storeNames) {
    const initial = storeDefinitions[storeName] as Record<string, unknown>
    const storeKeys: Record<string, IStreamStoreKey<unknown>> = {}
    for (const key of Object.keys(initial)) {
      storeKeys[key] = { dbName, storeName, key, initialValue: initial[key] }
    }
    result[storeName] = storeKeys
  }
  return result as IStoreDefinition<TStore>
}

export function readStoreKey<T>(storeKey: IStreamStoreKey<T>): IStream<T> {
  return awaitPromises(
    just(
      getValue(storeKey).catch(err => {
        console.error('[uiStorage] read failed', storeKey, err)
        return storeKey.initialValue
      })
    )
  )
}

export function writeStoreKey<T>(storeKey: IStreamStoreKey<T>, source: IStream<T>): IStream<T> {
  return awaitPromises(
    map(async (value: T) => {
      try {
        await putValue(storeKey, value)
      } catch (err) {
        console.error('[uiStorage] write failed', storeKey, err)
      }
      return value
    }, source)
  )
}

export function replayWrite<T>(storeKey: IStreamStoreKey<T>, source: IStream<T>): IStream<T> {
  return op(
    readStoreKey(storeKey),
    continueWith(() => writeStoreKey(storeKey, source))
  )
}
