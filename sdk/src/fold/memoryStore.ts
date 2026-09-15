import type { IColumns, InferRow, ITable } from '../datastore/index.js'
import type { IStore } from './fold.js'

type IAnyTable = ITable<IColumns>

const keyOf = (table: IAnyTable, row: Record<string, unknown>): string => {
  if (table.key) return table.key(row as never)
  const pk = Object.entries(table.columns).find(([, col]) => col.flags.pk)?.[0]
  if (!pk) throw new Error('table has neither a key function nor a primary key column')
  return String(row[pk])
}

export interface IMemoryStore extends IStore {
  rowsOf<Cols extends IColumns>(table: ITable<Cols>): InferRow<Cols>[]
}

export function memoryStore(): IMemoryStore {
  const tables = new Map<object, Map<string, unknown>>()
  const bucket = (table: IAnyTable): Map<string, unknown> => {
    const existing = tables.get(table)
    if (existing) return existing
    const created = new Map<string, unknown>()
    tables.set(table, created)
    return created
  }
  return {
    set(table, row) {
      bucket(table as IAnyTable).set(keyOf(table as IAnyTable, row as Record<string, unknown>), row)
    },
    async get(table, key) {
      const t = table as IAnyTable
      return bucket(t).get(typeof key === 'string' ? key : keyOf(t, key as Record<string, unknown>)) as never
    },
    async getOrCreate(table, row) {
      const t = table as IAnyTable
      const b = bucket(t)
      const k = keyOf(t, row as Record<string, unknown>)
      const found = b.get(k)
      if (found) return found as never
      b.set(k, row)
      return row
    },
    rowsOf(table) {
      return [...bucket(table as IAnyTable).values()] as never
    }
  }
}
