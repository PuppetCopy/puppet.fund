import { type IColumns, type InferRow, type IQuery, type ITable, type IWhere, isTable, reviveRow } from './schema.js'

export * from './schema.js'

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

export interface IDigestClient {
  select<Cols extends IColumns>(table: ITable<Cols>, opts?: Omit<IQuery<Cols>, 'table'>): Promise<InferRow<Cols>[]>
  find<Cols extends IColumns>(table: ITable<Cols>, where: IWhere<Cols>): Promise<InferRow<Cols> | undefined>
}

interface ICreateClient {
  storageUrl: string
  schema: Record<string, unknown>
  timeoutMs?: number
}

export function createClient({ storageUrl, schema, timeoutMs = 10_000 }: ICreateClient): IDigestClient {
  const nameOf = new Map<ITable<IColumns>, string>(
    Object.entries(schema)
      .filter(([, v]) => isTable(v))
      .map(([name, v]) => [v as ITable<IColumns>, name])
  )
  const exec = async <Cols extends IColumns>(
    table: ITable<Cols>,
    q: Omit<IQuery<Cols>, 'table'>
  ): Promise<InferRow<Cols>[]> => {
    const t = nameOf.get(table as unknown as ITable<IColumns>)
    if (!t) throw new Error('table is not part of the client schema')
    const params = new URLSearchParams({ t })
    if (q.where !== undefined) params.set('where', JSON.stringify(q.where, bigintReplacer))
    if (q.orderBy !== undefined) params.set('orderBy', JSON.stringify(q.orderBy))
    if (q.limit !== undefined) params.set('limit', String(q.limit))
    if (q.offset !== undefined) params.set('offset', String(q.offset))
    const res = await fetch(`${storageUrl}/query?${params.toString()}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`Data is temporarily unavailable (${res.status})`)
    return ((await res.json()) as Record<string, unknown>[]).map(r => reviveRow(table, r))
  }
  return {
    select: (table, opts = {}) => exec(table, opts),
    find: async (table, where) => (await exec(table, { where, limit: 1 }))[0]
  }
}
