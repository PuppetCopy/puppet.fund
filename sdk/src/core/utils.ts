import type { Address } from 'viem/accounts'

export const getUnixTimestamp = () => Math.floor(Date.now() / 1000)

const ETH_ADDRESS_REGEXP = /^0x[a-fA-F0-9]{40}$/i

export function isAddress(address: any): address is Address {
  return ETH_ADDRESS_REGEXP.test(address)
}

export function groupList<const T extends readonly any[], K extends keyof T[number]>(
  list: T,
  key: K
): { [P in T[number][K] & PropertyKey]: Extract<T[number], { [Q in K]: P }> } {
  const result = {} as any
  for (const item of list) {
    const keyValue = item[key]
    if (keyValue in result) {
      throw new Error(`Duplicate key "${String(keyValue)}" found when grouping by "${String(key)}"`)
    }
    result[keyValue] = item
  }
  return result
}

export function getMappedValue<TMap extends Record<PropertyKey, any>>(map: TMap, prop: PropertyKey): TMap[keyof TMap] {
  if (prop in map) return map[prop as keyof TMap]
  throw new Error(`Property '${String(prop)}' does not exist in object`)
}
