import { puppetErrorAbi } from '@puppet/contracts'
import type { AbiParametersToPrimitiveTypes, ExtractAbiError, ExtractAbiErrorNames } from 'abitype'

declare module 'abitype' {
  interface Register {
    experimental_namedTuples: true
  }
}

type IErrorAbi = typeof puppetErrorAbi

export type ICompactContractErrorName = ExtractAbiErrorNames<IErrorAbi>

export type ICompactContractErrorArgs<N extends ICompactContractErrorName> = AbiParametersToPrimitiveTypes<
  ExtractAbiError<IErrorAbi, N>['inputs']
>

// 'server' — server-side fault, sender not at fault, do not penalize.
// 'soft'   — contention/retry path, cumulative rate-limit signal.
// 'hard'   — sender supplied a nonsensical request, immediate timeout.
export type IStrikeSeverity = 'server' | 'soft' | 'hard'

export class CompactError extends Error {
  readonly code: string
  readonly severity: IStrikeSeverity
  constructor(code: string, message: string, severity: IStrikeSeverity = 'soft') {
    super(`[${code}] ${message}`)
    this.code = code
    this.severity = severity
    this.name = 'CompactError'
  }
}

export class CompactContractError<N extends ICompactContractErrorName = ICompactContractErrorName> extends Error {
  readonly code: N
  readonly args: ICompactContractErrorArgs<N>
  readonly severity: IStrikeSeverity = 'soft'
  constructor(code: N, args: ICompactContractErrorArgs<N>) {
    super(
      `${code}(${(args as readonly unknown[])
        .map(v => (typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? v : String(v)))
        .join(', ')})`
    )
    this.name = 'CompactContractError'
    this.code = code
    this.args = args
  }
}

export function humanizeErrorCode(code: string): string {
  const tail = code.includes('__') ? (code.split('__').pop() ?? code) : code
  const spaced = tail.includes('_') ? tail.replace(/_/g, ' ') : tail.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export function humanizeContractError(code: string, args: readonly unknown[]): string {
  const head = humanizeErrorCode(code)
  if (args.length === 0) return head
  const def = puppetErrorAbi.find(e => e.type === 'error' && e.name === code) as
    | { inputs: readonly { name: string }[] }
    | undefined
  const inputs = def?.inputs ?? []
  const parts = args.map((v, i) => {
    const fieldName = inputs[i]?.name
    const fieldValue = typeof v === 'bigint' ? v.toString() : String(v)
    return fieldName ? `${fieldName}=${fieldValue}` : fieldValue
  })
  return `${head} (${parts.join(', ')})`
}

export function formatThrownError(err: unknown): string {
  if (err instanceof CompactContractError) return humanizeContractError(err.code, err.args)
  if (err instanceof CompactError) return err.message
  const data = (err as { cause?: { data?: { errorName?: string; args?: readonly unknown[] } } } | null)?.cause?.data
  if (data?.errorName) return humanizeContractError(data.errorName, data.args ?? [])
  if (err instanceof Error) {
    const short = (err as { shortMessage?: string }).shortMessage
    if (typeof short === 'string') return short
    return err.message.split('\n', 1)[0]
  }
  return String(err)
}
