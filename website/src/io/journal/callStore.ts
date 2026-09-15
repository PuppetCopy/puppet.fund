import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import type { IReceiptLog } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import { type Address, getAddress, type Hex } from 'viem'

export interface IStoredAccountCall {
  modulePrevBlock: bigint
  accountPrevBlock: bigint
  source: Address
  digest: Hex
  signature: Hex
  executionData: Hex
  value: bigint
  logs: IReceiptLog[]
  resultList: Hex[]
  callList: IIAccount__Call[]
  blockNumber: bigint
  blockTimestamp: number
  logIndex: number
  transactionHash: Hex
}

const DB_NAME = 'journal'
const CALLS = 'account-calls'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, Number(PROTOCOL.version) * 100 + 9)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name)
      db.createObjectStore(CALLS)
    }
    req.onblocked = () => reject(new Error('journal DB upgrade blocked by another tab; reload'))
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('journal indexedDB open failed'))
  })
  return dbPromise
}

const listKey = (chainId: ChainId, account: Address): string => `${chainId}:${getAddress(account)}`

export async function readAccountCalls(chainId: ChainId, account: Address): Promise<IStoredAccountCall[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(CALLS, 'readonly').objectStore(CALLS).get(listKey(chainId, account))
    req.onsuccess = () => resolve((req.result as IStoredAccountCall[] | undefined) ?? [])
    req.onerror = () => reject(req.error ?? new Error('journal read failed'))
  })
}

export async function writeAccountCalls(chainId: ChainId, account: Address, entries: IStoredAccountCall[]): Promise<void> {
  if (entries.length === 0) return
  const db = await openDb()
  const key = listKey(chainId, account)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CALLS, 'readwrite')
    const store = tx.objectStore(CALLS)
    const getReq = store.get(key)
    getReq.onsuccess = () => {
      const held = (getReq.result as IStoredAccountCall[] | undefined) ?? []
      const byEntry = new Map<string, IStoredAccountCall>()
      for (const e of [...held, ...entries]) byEntry.set(`${e.transactionHash}-${e.logIndex}`, e)
      const merged = [...byEntry.values()].sort((a, b) =>
        a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex
      )
      store.put(merged, key)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('journal write failed'))
  })
}
