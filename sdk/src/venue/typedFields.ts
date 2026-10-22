import { type Address, isAddress, isAddressEqual } from 'viem'
import type { IDappScreenReason, IDappTypedData } from './types.js'

export type ITypeList = readonly { readonly name: string; readonly type: string }[]

export function sameTypes(actual: unknown, expected: ITypeList): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((field, i) => typeof field === 'object' && field !== null && field.name === expected[i]!.name && field.type === expected[i]!.type)
  )
}

export function exactTypes(td: IDappTypedData, expected: Record<string, ITypeList>): boolean {
  const types = td.types ?? {}
  const names = Object.keys(types)
  return names.length === Object.keys(expected).length && names.every(name => Object.hasOwn(expected, name) && sameTypes(types[name], expected[name]!))
}

export function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return BigInt(value)
  return null
}

export const sameAddress = (value: unknown, expected: Address): boolean => typeof value === 'string' && isAddress(value) && isAddressEqual(value, expected)

export const refuse = (code: IDappScreenReason['code'], detail: string): IDappScreenReason[] => [{ code, detail }]
