import { ROBO_LAYERS } from './roboTraits.js'

export const FUND_NAME_MARKER = '\x01'

export const ROBO_LAYER_NAMES: string[] = ROBO_LAYERS.map(category => category.name)

const LAYER_COUNT = ROBO_LAYERS.length

export interface IFundName {
  displayName: string
  indices: number[] | null
}

export const encodeFundName = (displayName: string, indices: number[]): string => {
  const packed = ROBO_LAYERS.map((_, layer) => Math.max(0, Math.trunc(indices[layer] ?? 0))).join(':')
  return `${FUND_NAME_MARKER}${packed}:${displayName}`
}

export const decodeFundName = (raw: string): IFundName => {
  if (raw.charCodeAt(0) !== 1) return { displayName: raw, indices: null }
  const parts = raw.slice(1).split(':')
  if (parts.length <= LAYER_COUNT) return { displayName: parts.slice(LAYER_COUNT).join(':'), indices: null }
  const indices = parts.slice(0, LAYER_COUNT).map(part => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  return { displayName: parts.slice(LAYER_COUNT).join(':'), indices }
}
