import { type IColumns, type InferRow, type IQuery, type ITable, type IWhere, isTable, reviveRow } from './schema.js'

// The table/column/query abstraction (t, table, InferRow, runRows, …) lives alongside the read client now; re-export it
// so `@puppet/sdk/datastore` is the single entry for both the schema primitives and the client that reads against them.
export * from './schema.js'

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

// The lean datastore read client, instantiated with { storageUrl, schema }: `storageUrl` is the datastore endpoint (the
// matchmaker for the MVP; a user's own local datastore later); `schema` is the tables namespace (`import * as schema`).
// The wire `t: name` is the table's export-const key, resolved via the schema's table→name map (no name on the object).
// Reads are methods over those tables — client.select(table, { where, orderBy, … }) for a list, client.find(table, where)
// for a single row. Both THROW on failure: an unreadable datastore must never masquerade as an empty result (a downed
// journal once rendered as a legitimately empty leaderboard). A caller that can honestly degrade catches explicitly at
// its own call site, to a value that reads as "unknown" (`null`), never a fabricated empty.
export interface IDigestClient {
  select<Cols extends IColumns>(table: ITable<Cols>, opts?: Omit<IQuery<Cols>, 'table'>): Promise<InferRow<Cols>[]>
  find<Cols extends IColumns>(table: ITable<Cols>, where: IWhere<Cols>): Promise<InferRow<Cols> | undefined>
}

interface ICreateClient {
  storageUrl: string
  schema: Record<string, unknown>
  // Per-query deadline; on timeout the fetch aborts and the read rejects. Without it a hung datastore (stuck DB
  // socket) never resolves and never surfaces the failure.
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
    // GET the descriptor as query params (cacheable, no body): `t` plain, `where`/`orderBy` JSON-encoded (bigints to
    // decimal strings via bigintReplacer, exactly as the body did), `limit`/`offset` numeric.
    const params = new URLSearchParams({ t })
    if (q.where !== undefined) params.set('where', JSON.stringify(q.where, bigintReplacer))
    if (q.orderBy !== undefined) params.set('orderBy', JSON.stringify(q.orderBy))
    if (q.limit !== undefined) params.set('limit', String(q.limit))
    if (q.offset !== undefined) params.set('offset', String(q.offset))
    const res = await fetch(`${storageUrl}/query?${params.toString()}`, { signal: AbortSignal.timeout(timeoutMs) })
    // This message renders VERBATIM in the UI ($intermediatePromise's error card shows the throw-site phrasing, no
    // editorializing) — phrase it for the user; the status code stays for diagnostics.
    if (!res.ok) throw new Error(`Data is temporarily unavailable (${res.status})`)
    return ((await res.json()) as Record<string, unknown>[]).map(r => reviveRow(table, r))
  }
  return {
    select: (table, opts = {}) => exec(table, opts),
    find: async (table, where) => (await exec(table, { where, limit: 1 }))[0]
  }
}
