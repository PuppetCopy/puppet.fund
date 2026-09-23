import { getAddress, type Hex } from 'viem'

export interface IColumn<T = unknown, Opt extends boolean = false, Ix extends boolean = false> {
  readonly __t?: T
  readonly __opt?: Opt
  readonly __ix?: Ix
  sqlType: 'text' | 'numeric' | 'integer'
  encode(v: T): string | number
  parse(raw: unknown): T
  flags: { pk: boolean; indexed: boolean; optional: boolean }
}

type IColumnType = 'text' | 'hex' | 'address' | 'bigint' | 'int' | 'bool' | 'bigint[]' | 'int[]' | 'hex[]'

interface ITypeMap {
  text: string
  hex: Hex
  address: Hex
  bigint: bigint
  int: number
  bool: boolean
  'bigint[]': bigint[]
  'int[]': number[]
  'hex[]': Hex[]
}

interface ICodec<T> {
  sqlType: IColumn['sqlType']
  encode: (v: T) => string | number
  parse: (raw: unknown) => T
}

const codecs: { [K in IColumnType]: ICodec<ITypeMap[K]> } = {
  text: { sqlType: 'text', encode: v => v, parse: v => v as string },
  hex: { sqlType: 'text', encode: v => v, parse: v => v as Hex },
  address: { sqlType: 'text', encode: v => getAddress(v), parse: v => getAddress(v as string) },
  bigint: { sqlType: 'numeric', encode: v => v.toString(), parse: v => BigInt(v as string | number) },
  int: { sqlType: 'integer', encode: v => v, parse: v => v as number },
  bool: { sqlType: 'integer', encode: v => (v ? 1 : 0), parse: v => v === true || v === 1 },
  'bigint[]': {
    sqlType: 'text',
    encode: v => JSON.stringify(v.map(x => x.toString())),
    parse: v => (v as (string | number)[]).map(x => BigInt(x))
  },
  'int[]': { sqlType: 'text', encode: v => JSON.stringify(v), parse: v => v as number[] },
  'hex[]': { sqlType: 'text', encode: v => JSON.stringify(v), parse: v => v as Hex[] }
}

export function t<const Ty extends IColumnType, const Opt extends boolean = false, const Ix extends boolean = false>(
  type: Ty,
  opts?: { pk?: boolean; optional?: Opt; indexed?: Ix }
): IColumn<ITypeMap[Ty], Opt, Ix> {
  const codec = codecs[type] as ICodec<ITypeMap[Ty]>
  return {
    sqlType: codec.sqlType,
    encode: codec.encode,
    parse: codec.parse,
    flags: { pk: opts?.pk ?? false, indexed: opts?.indexed ?? false, optional: opts?.optional ?? false }
  }
}

export type IColumns = Record<string, IColumn<any, boolean, boolean>>

type ColType<C> = C extends { __t?: infer T } ? T : never
type IsOpt<C> = C extends { __opt?: true } ? true : false
type ReqKeys<Cols extends IColumns> = { [K in keyof Cols]: IsOpt<Cols[K]> extends true ? never : K }[keyof Cols]
type OptKeys<Cols extends IColumns> = { [K in keyof Cols]: IsOpt<Cols[K]> extends true ? K : never }[keyof Cols]

export type InferRow<Cols extends IColumns> = { [K in ReqKeys<Cols>]: ColType<Cols[K]> } & {
  [K in OptKeys<Cols>]?: ColType<Cols[K]>
}


export const TABLE: unique symbol = Symbol.for('puppet.digest.table')

export interface ITable<Cols extends IColumns> {
  [TABLE]: true
  columns: Cols
  key?: (row: InferRow<Cols>) => string
}

export function table<Cols extends IColumns>(
  columns: Cols,
  opts?: { key?: (row: InferRow<Cols>) => string }
): ITable<Cols> {
  return { [TABLE]: true, columns, key: opts?.key }
}

export const isTable = (v: unknown): v is ITable<IColumns> =>
  typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[TABLE] === true

type IFilter<V> = V | { in: readonly V[] } | { gte: number } | { lte: number }
export type IWhere<Cols extends IColumns> = { [K in keyof Cols]?: IFilter<ColType<Cols[K]>> }

export interface IQuery<Cols extends IColumns> {
  table: ITable<Cols>
  where?: IWhere<Cols>
  orderBy?: { col: keyof Cols & string; dir?: 'asc' | 'desc' }
  limit?: number
  offset?: number
}

const isOp = (f: unknown): f is { in?: readonly unknown[]; gte?: number; lte?: number } =>
  typeof f === 'object' && f !== null && ('in' in f || 'gte' in f || 'lte' in f)

const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

export function runRows<Cols extends IColumns>(
  table: ITable<Cols>,
  rows: readonly InferRow<Cols>[],
  q: Omit<IQuery<Cols>, 'table'>
): InferRow<Cols>[] {
  let out = [...rows]
  if (q.where) {
    const entries = (Object.entries(q.where) as [string, IFilter<unknown>][]).filter(([, f]) => f !== undefined)
    out = out.filter(row =>
      entries.every(([k, f]) => {
        const col = table.columns[k]
        const rv = (row as Record<string, unknown>)[k]
        if (rv === undefined) return false
        const enc = (v: unknown): string | number => col.encode(v as never)
        if (isOp(f)) {
          if (f.in) return f.in.some(v => enc(rv) === enc(v))
          if (f.gte !== undefined) return Number(rv) >= f.gte
          if (f.lte !== undefined) return Number(rv) <= f.lte
          return true
        }
        return enc(rv) === enc(f)
      })
    )
  }
  if (q.orderBy) {
    const { col, dir } = q.orderBy
    const sign = dir === 'asc' ? 1 : -1
    out.sort((a, b) => sign * cmp((a as Record<string, unknown>)[col], (b as Record<string, unknown>)[col]))
  }
  const offset = q.offset ?? 0
  return q.limit === undefined ? out.slice(offset) : out.slice(offset, offset + q.limit)
}

export function reviveRow<Cols extends IColumns>(table: ITable<Cols>, raw: Record<string, unknown>): InferRow<Cols> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(table.columns)) {
    const v = raw[k]
    out[k] = v === undefined || v === null ? v : table.columns[k].parse(v)
  }
  return out as InferRow<Cols>
}
