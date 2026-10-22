import { type IColumns, type InferRow, type IQuery, type ITable, type IWhere, isTable, reviveRow, rowKey } from './schema.js'

export * from './schema.js'

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

export const QUERY_PAGE_ROWS = 500
export const QUERY_SEQ_HEADER = 'x-chronicle-seq'
const LISTING_ATTEMPTS = 3
type ICacheMode = NonNullable<RequestInit['cache']>

export interface IDigestClient {
  select<Cols extends IColumns>(table: ITable<Cols>, opts?: Omit<IQuery<Cols>, 'table'>): Promise<InferRow<Cols>[]>
  find<Cols extends IColumns>(table: ITable<Cols>, where: IWhere<Cols>): Promise<InferRow<Cols> | undefined>
  cached<Cols extends IColumns>(table: ITable<Cols>, opts?: Omit<IQuery<Cols>, 'table'>): Promise<InferRow<Cols>[] | null>
}

export async function readChronicleChains(storageUrl: string, timeoutMs: number): Promise<Map<number, { folded: { block: number; log: number }; lastPass: number | null }>> {
  const res = await fetch(`${storageUrl}/status`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`chronicle ${storageUrl}/status ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as { chains: { chainId: number; folded: { block: number; log: number }; lastPass: number | null }[] }
  return new Map(body.chains.map(chain => [chain.chainId, chain]))
}

interface ICreateClient {
  storageUrl: string
  schema: Record<string, unknown>
  timeoutMs: number
}

export function createClient({ storageUrl, schema, timeoutMs }: ICreateClient): IDigestClient {
  const nameOf = new Map<ITable<IColumns>, string>(
    Object.entries(schema)
      .filter(([, v]) => isTable(v))
      .map(([name, v]) => [v as ITable<IColumns>, name])
  )
  const page = async <Cols extends IColumns>(
    table: ITable<Cols>,
    q: Omit<IQuery<Cols>, 'table'>,
    limit: number,
    at: { offset: number } | { after: string | undefined },
    cache: ICacheMode
  ): Promise<{ seq: string | null; rows: InferRow<Cols>[] }> => {
    const t = nameOf.get(table as unknown as ITable<IColumns>)
    if (!t) throw new Error('table is not part of the client schema')
    const params = new URLSearchParams({ t })
    if (q.where !== undefined) params.set('where', JSON.stringify(q.where, bigintReplacer))
    if (q.orderBy !== undefined) params.set('orderBy', JSON.stringify(q.orderBy))
    params.set('limit', String(limit))
    if ('offset' in at && at.offset > 0) params.set('offset', String(at.offset))
    if ('after' in at && at.after !== undefined) params.set('after', at.after)
    const res = await fetch(`${storageUrl}/query?${params.toString()}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache,
      ...(cache === 'only-if-cached' ? { mode: 'same-origin' as const } : {})
    })
    if (!res.ok) throw new Error(`Data is temporarily unavailable (${res.status})`)
    return { seq: res.headers.get(QUERY_SEQ_HEADER), rows: ((await res.json()) as Record<string, unknown>[]).map(r => reviveRow(table, r)) }
  }
  const exec = async <Cols extends IColumns>(table: ITable<Cols>, q: Omit<IQuery<Cols>, 'table'>, cache: ICacheMode): Promise<InferRow<Cols>[]> => {
    if (q.offset === undefined && (q.orderBy === undefined ? q.where === undefined : table.columns[q.orderBy.col]!.flags.sorted)) {
      const out: InferRow<Cols>[] = []
      for (;;) {
        const take = q.limit === undefined ? QUERY_PAGE_ROWS : Math.min(QUERY_PAGE_ROWS, q.limit - out.length)
        const got = await page(table, q, take, { after: out.length === 0 ? undefined : rowKey(table, out[out.length - 1]!) }, cache)
        out.push(...got.rows)
        if (got.rows.length < take || (q.limit !== undefined && out.length >= q.limit)) return out
      }
    }
    for (let attempt = 0; attempt < LISTING_ATTEMPTS; attempt++) {
      const out: InferRow<Cols>[] = []
      let seq: string | null | undefined
      let moved = false
      for (;;) {
        const take = q.limit === undefined ? QUERY_PAGE_ROWS : Math.min(QUERY_PAGE_ROWS, q.limit - out.length)
        const got = await page(table, q, take, { offset: (q.offset ?? 0) + out.length }, cache)
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
    select: (table, opts = {}) => exec(table, opts, 'default'),
    find: async (table, where) => (await exec(table, { where, limit: 1 }, 'default'))[0],
    cached: (table, opts = {}) =>
      exec(table, opts, 'only-if-cached').then(
        rows => rows,
        () => null
      )
  }
}
