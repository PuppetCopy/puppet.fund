import type { Address } from 'viem/accounts'

/**
 * GENERIC multi-layer avatar engine.
 *
 * A character is an ordered Z-STACK of LAYERS composited back→front. Each layer
 * is a directive with weighted OPTIONS; one option is deterministically chosen
 * per layer from the seed address. The robo avatar is the sibling reference for
 * the conventions encoded here (see ./roboAvatar.ts and ./roboTraits.ts) — the
 * pixel grid + INK sentinel + power-law rarity primitives are adapted from it,
 * generalised so each animal "kind" lives in its own self-contained abstraction.
 */

/** Pixel grid art. Same shape as IRoboArt: rows of base-36 palette indices,
 *  '.'/' ' = transparent. `x`/`y` offset the grid within the kind canvas. */
export type IArt = { x?: number; y?: number; palette: string[]; rows: string[] }

/** INK sentinel — replaced at render time with an auto-contrast ink color
 *  (dark on light fur, light on dark) so outlines/features read on any tone. */
export const INK = '@ink'

/** A weighted choice within a layer. */
export type ILayerOption = { name: string; art: IArt; weight?: number }

/** An ordered layer in the kind's z-stack. `optional` adds an implicit empty
 *  "none" option (weight defaults so most characters skip it). */
export type ILayer = { name: string; z: number; optional?: boolean; options: ILayerOption[] }

/** A self-contained character kind: its own canvas, base tone and layer stack.
 *  Kinds NEVER share option pools — each lives in its own file under kinds/. */
export type IKind = { name: string; canvas: number; baseTone: string; layers: ILayer[] }

/** Implicit empty option mixed into every `optional` layer. */
const NONE_NAME = 'none'
const NONE_WEIGHT = 6
const NONE_ART: IArt = { palette: [], rows: [] }
const noneOption: ILayerOption = { name: NONE_NAME, art: NONE_ART, weight: NONE_WEIGHT }

// ── deterministic hashing (FNV-1a, adapted from robo) ───────────────────────

const hashKey = (key: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** [0,1) unit float derived from a salted key. */
const unit = (key: string): number => hashKey(key) / 0x100000000

// ── auto-contrast ink (adapted from robo's inkFor) ──────────────────────────

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

/** Dark ink on light fur, light ink on dark — whichever contrasts more. */
const inkFor = (baseTone: string): string => {
  const lum = relativeLuminance(baseTone)
  return contrastRatio(relativeLuminance(INK_LIGHT), lum) >= contrastRatio(relativeLuminance(INK_DARK), lum)
    ? INK_LIGHT
    : INK_DARK
}

// ── weighted pick (adapted from robo's weightedPick) ────────────────────────

/** Layer-local options including the implicit "none" when `optional`. */
const optionsOf = (layer: ILayer): ILayerOption[] => (layer.optional ? [noneOption, ...layer.options] : layer.options)

/** Deterministically choose one option for a layer, salted by
 *  `${seed}:${kind.name}:${layer.name}`. Respects per-option weights and the
 *  implicit 'none' option on optional layers. */
const weightedPick = (kind: IKind, layer: ILayer, seed: string): ILayerOption => {
  const opts = optionsOf(layer)
  const total = opts.reduce((sum, o) => sum + (o.weight ?? 1), 0)
  let cursor = unit(`${seed}:${kind.name}:${layer.name}`) * total
  for (const o of opts) {
    cursor -= o.weight ?? 1
    if (cursor < 0) return o
  }
  return opts[opts.length - 1]
}

/** Probability the chosen option had, used for rarity scoring. */
const probabilityOf = (layer: ILayer, chosenName: string): number => {
  const opts = optionsOf(layer)
  const total = opts.reduce((sum, o) => sum + (o.weight ?? 1), 0)
  const chosen = opts.find(o => o.name === chosenName)
  return chosen ? (chosen.weight ?? 1) / total : 1
}

// ── deterministic hue-jitter (adapted from robo conventions) ────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const hexToRgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

const hslToHex = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rp = 0
  let gp = 0
  let bp = 0
  if (h < 60) {
    rp = c
    gp = x
  } else if (h < 120) {
    rp = x
    gp = c
  } else if (h < 180) {
    gp = c
    bp = x
  } else if (h < 240) {
    gp = x
    bp = c
  } else if (h < 300) {
    rp = x
    bp = c
  } else {
    rp = c
    bp = x
  }
  const to = (v: number) =>
    Math.round(clamp01(v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(rp)}${to(gp)}${to(bp)}`
}

/** A pure color transform: shifts hue by ±18° deterministically from the seed,
 *  salted independently of layer picks so identical option-combos still render
 *  uniquely per address. Applied ONLY to final emitted colors. The INK sentinel
 *  and any non-#rrggbb token (e.g. #rrggbbaa alpha colors) pass through. */
const makeHueJitter = (seed: Address): ((color: string) => string) => {
  const shift = (unit(`${seed.toLowerCase()}:hue`) * 2 - 1) * 18
  return (color: string): string => {
    if (color === INK) return color
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color
    const [r, g, b] = hexToRgb(color)
    const [h, s, l] = rgbToHsl(r, g, b)
    let nh = h + shift
    if (nh < 0) nh += 360
    if (nh >= 360) nh -= 360
    return hslToHex(nh, s, l)
  }
}

// ── art → svg (adapted from robo's artToSvg) ────────────────────────────────

/** Render a single pixel-grid art to SVG path bodies, one path per emitted
 *  color. INK is resolved to `ink`; every other color is run through `jitter`. */
const artToSvg = (art: IArt, ink: string, jitter: (color: string) => string): string => {
  const ox = art.x ?? 0
  const oy = art.y ?? 0
  const pathByColor = new Map<string, string>()
  art.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.' || ch === ' ') continue
      const slot = art.palette[Number.parseInt(ch, 36)]
      if (!slot) continue
      const color = slot === INK ? ink : jitter(slot)
      pathByColor.set(color, `${pathByColor.get(color) ?? ''}M${ox + c} ${oy + r}h1v1h-1z`)
    }
  })
  let body = ''
  for (const [color, d] of pathByColor) body += `<path fill="${color}" d="${d}"/>`
  return body
}

// ── public API ──────────────────────────────────────────────────────────────

/** Deterministically choose one option per layer. Returns layerName → option name. */
export const pickLayers = (kind: IKind, seed: Address): Record<string, string> => {
  const lower = seed.toLowerCase()
  const chosen: Record<string, string> = {}
  for (const layer of kind.layers) chosen[layer.name] = weightedPick(kind, layer, lower).name
  return chosen
}

/** Composite the kind's layers back→front into a single crisp pixel-art SVG. */
export const renderAvatarSvg = (kind: IKind, seed: Address): string => {
  const chosen = pickLayers(kind, seed)
  const ink = inkFor(kind.baseTone)
  const jitter = makeHueJitter(seed)

  const ordered = [...kind.layers].sort((a, b) => a.z - b.z)
  let body = ''
  for (const layer of ordered) {
    const option = optionsOf(layer).find(o => o.name === chosen[layer.name])
    if (!option) continue
    body += artToSvg(option.art, ink, jitter)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${kind.canvas} ${kind.canvas}" shape-rendering="crispEdges" width="100%" height="100%">${body}</svg>`
}

/** Shared TIER ladder: rarity score = Σ −log2(prob) across layers, then bucketed.
 *  Reuses robo's power-law rarity idea — rarer option-combos score higher. */
const TIERS: { tier: string; min: number }[] = [
  { tier: 'mythic', min: 22 },
  { tier: 'legendary', min: 16 },
  { tier: 'epic', min: 11 },
  { tier: 'rare', min: 7 },
  { tier: 'uncommon', min: 4 },
  { tier: 'common', min: 0 }
]

export const avatarRarity = (kind: IKind, seed: Address): { score: number; tier: string } => {
  const chosen = pickLayers(kind, seed)
  let score = 0
  for (const layer of kind.layers) {
    const p = probabilityOf(layer, chosen[layer.name])
    if (p > 0) score += -Math.log2(p)
  }
  const bucket = TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1]
  return { score, tier: bucket.tier }
}
