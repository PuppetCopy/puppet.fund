import { ROBO_LAYERS } from './roboTraits.js'

const FUND_NAME_MARKER = '\x01'

const LAYER_COUNT = ROBO_LAYERS.length

export interface IAccountName {
  displayName: string
  indices: number[] | null
}

export const decodeAccountName = (raw: string): IAccountName => {
  if (!raw.startsWith(FUND_NAME_MARKER)) return { displayName: raw, indices: null }
  const parts = raw.slice(1).split(':')
  if (parts.length <= LAYER_COUNT) return { displayName: parts.slice(LAYER_COUNT).join(':'), indices: null }
  const indices = parts.slice(0, LAYER_COUNT).map(part => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  return { displayName: parts.slice(LAYER_COUNT).join(':'), indices }
}
