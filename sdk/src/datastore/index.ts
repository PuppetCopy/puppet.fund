import { type IColumns, type InferRow, type IQuery, type ITable, type IWhere, isTable, reviveRow } from './schema.js'

export * from './schema.js'

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

export const QUERY_PAGE_ROWS = 500
export const QUERY_SEQ_HEADER = 'x-chronicle-seq'
const LISTING_ATTEMPTS = 3

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
  const page = async <Cols extends IColumns>(
    table: ITable<Cols>,
    q: Omit<IQuery<Cols>, 'table'>,
    limit: number,
    offset: number
  ): Promise<{ seq: string | null; rows: InferRow<Cols>[] }> => {
    const t = nameOf.get(table as unknown as ITable<IColumns>)
    if (!t) throw new Error('table is not part of the client schema')
    const params = new URLSearchParams({ t })
    if (q.where !== undefined) params.set('where', JSON.stringify(q.where, bigintReplacer))
    if (q.orderBy !== undefined) params.set('orderBy', JSON.stringify(q.orderBy))
    params.set('limit', String(limit))
    if (offset > 0) params.set('offset', String(offset))
    const res = await fetch(`${storageUrl}/query?${params.toString()}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`Data is temporarily unavailable (${res.status})`)
    return { seq: res.headers.get(QUERY_SEQ_HEADER), rows: ((await res.json()) as Record<string, unknown>[]).map(r => reviveRow(table, r)) }
  }
  const exec = async <Cols extends IColumns>(table: ITable<Cols>, q: Omit<IQuery<Cols>, 'table'>): Promise<InferRow<Cols>[]> => {
    for (let attempt = 0; attempt < LISTING_ATTEMPTS; attempt++) {
      const out: InferRow<Cols>[] = []
      let seq: string | null | undefined
      let moved = false
      for (;;) {
        const take = q.limit === undefined ? QUERY_PAGE_ROWS : Math.min(QUERY_PAGE_ROWS, q.limit - out.length)
        const got = await page(table, q, take, (q.offset ?? 0) + out.length)
        if (seq !== undefined && got.seq !== seq) {
          moved = true
          break
        }
        seq = got.seq
        out.push(...got.rows)
        if (got.rows.length < take || (q.limit !== undefined && out.length >= q.limit)) return out
      }
      if (!moved) return out
    }
    throw new Error('the data changed under a multi-page listing on every attempt; retry')
  }
  return {
    select: (table, opts = {}) => exec(table, opts),
    find: async (table, where) => (await exec(table, { where, limit: 1 }))[0]
  }
}
