export type IArt = { x?: number; y?: number; palette: string[]; rows: string[] }

export const INK = '@ink'

const hashKey = (key: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const unit = (key: string): number => hashKey(key) / 0x100000000

const INK_LIGHT = '#f4f6fb'
const INK_DARK = '#15161a'

const channelLuminance = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const relativeLuminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return (
    0.2126 * channelLuminance((n >> 16) & 255) +
    0.7152 * channelLuminance((n >> 8) & 255) +
    0.0722 * channelLuminance(n & 255)
  )
}

const contrastRatio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

export const inkFor = (baseTone: string): string => {
  const lum = relativeLuminance(baseTone)
  return contrastRatio(relativeLuminance(INK_LIGHT), lum) >= contrastRatio(relativeLuminance(INK_DARK), lum)
    ? INK_LIGHT
    : INK_DARK
}

export const weightedPick = <T>(list: readonly T[], weightOf: (item: T) => number, u: number): T => {
  const total = list.reduce((sum, item) => sum + weightOf(item), 0)
  let cursor = u * total
  for (const item of list) {
    cursor -= weightOf(item)
    if (cursor < 0) return item
  }
  return list[list.length - 1]
}

export const pixelArtToSvg = (art: IArt, colorOf: (slot: string) => string): string => {
  const ox = art.x ?? 0
  const oy = art.y ?? 0
  const pathByColor = new Map<string, string>()
  art.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.' || ch === ' ') continue
      const slot = art.palette[Number.parseInt(ch, 36)]
      if (!slot) continue
      const color = colorOf(slot)
      pathByColor.set(color, `${pathByColor.get(color) ?? ''}M${ox + c} ${oy + r}h1v1h-1z`)
    }
  })
  let body = ''
  for (const [color, d] of pathByColor) body += `<path fill="${color}" d="${d}"/>`
  return body
}
