import type { Address } from 'viem/accounts'
import type { IRequestPagePositionApi, IRequestSortApi, IResponsePageApi } from './types.js'

export const getUnixTimestamp = () => Math.floor(Date.now() / 1000)

export const ETH_ADDRESS_REGEXP = /^0x[a-fA-F0-9]{40}$/i
export const TX_HASH_REGEX = /^0x([A-Fa-f0-9]{64})$/i

export function isAddress(address: any): address is Address {
  return ETH_ADDRESS_REGEXP.test(address)
}

export type IPagingQueryParams = (IRequestPagePositionApi & IRequestSortApi) | IRequestPagePositionApi

export function pagingQuery<T, TParams extends IPagingQueryParams>(
  queryParams: TParams,
  res: T[],
  customComperator?: (a: T, b: T) => number
): IResponsePageApi<T> {
  let list = res
  if ('selector' in queryParams) {
    list = res.sort(
      customComperator ??
        ((a: any, b: any) =>
          queryParams.direction === 'desc'
            ? Number(b[queryParams.selector]) - Number(a[queryParams.selector])
            : Number(a[queryParams.selector]) - Number(b[queryParams.selector]))
    )
  }

  const page = list.slice(queryParams.offset, queryParams.offset + queryParams.pageSize)
  return { ...queryParams, page }
}

interface ICacheItem<T> {
  item: Promise<T>
  lifespanFn: () => boolean
}

export const cacheMap =
  (cacheMap: { [k: string]: ICacheItem<any> }) =>
  <T>(key: string, lifespan: number, cacheFn: () => Promise<T>): Promise<T> => {
    const cacheEntry = cacheMap[key]

    if (cacheEntry && !cacheMap[key].lifespanFn()) {
      return cacheEntry.item
    }
    let lastTimePasses = getUnixTimestamp()
    const lifespanFn =
      cacheMap[key]?.lifespanFn ??
      (() => {
        const nowTime = getUnixTimestamp()
        const delta = nowTime - lastTimePasses
        if (delta > lifespan) {
          lastTimePasses = nowTime
          return true
        }
        return false
      })
    const newLocal = { item: cacheFn(), lifespanFn }
    cacheMap[key] = newLocal
    return cacheMap[key].item
  }

export function groupManyList<const T extends readonly any[], K extends keyof T[number]>(
  list: T,
  key: K
): { [P in T[number][K] & PropertyKey]: Extract<T[number], { [Q in K]: P }>[] } {
  const gmap = {} as { [P in T[number][K] & PropertyKey]: Extract<T[number], { [Q in K]: P }>[] }

  for (const item of list) {
    const keyValue = item[key] as T[number][K] & PropertyKey
    if (keyValue === undefined) {
      throw new Error(`Key "${String(key)}" is undefined`)
    }

    gmap[keyValue] ??= []
    gmap[keyValue].push(item as any)
  }

  return gmap
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

export function groupListMap<
  const T extends readonly any[],
  K extends keyof T[number],
  const V extends T[number][K] & PropertyKey,
  R
>(
  list: T,
  key: K,
  mapFn: (item: Extract<T[number], { [Q in K]: V }>, keyValue: V, index: number) => R
): { [P in T[number][K] & PropertyKey]: R } {
  const result = {} as any

  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const keyValue = item[key]

    if (keyValue === undefined) throw new Error(`Key "${String(key)}" is undefined for item at index ${i}`)
    if (keyValue in result) {
      throw new Error(`Duplicate key "${String(keyValue)}" found when grouping by "${String(key)}"`)
    }

    result[keyValue] = mapFn(item as any, keyValue as any, i)
  }

  return result
}

export function getMappedValue<TMap extends Record<PropertyKey, any>>(map: TMap, prop: PropertyKey): TMap[keyof TMap] {
  if (prop in map) return map[prop as keyof TMap]
  throw new Error(`Property '${String(prop)}' does not exist in object`)
}

export function getMappedValueFallback<TMap extends Record<PropertyKey, any>, TFallback>(
  map: TMap,
  prop: PropertyKey,
  fallbackValue: TFallback
): TMap[keyof TMap] | TFallback {
  if (prop in map) return map[prop as keyof TMap]
  return fallbackValue
}

export function easeInExpo(x: number) {
  return x === 0 ? 0 : 2 ** (10 * x - 10)
}

export function getClosestNumber<T extends readonly number[]>(arr: T, chosen: number): T[number] {
  return arr.reduce((a, b) => (b - chosen < chosen - a ? b : a))
}

export function lst<T>(a: readonly T[]): T {
  if (a.length === 0) throw new Error('empty array')
  return a[a.length - 1]
}
