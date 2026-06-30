import type { Address } from 'viem/accounts'
import {
  type IGradientArt,
  INK,
  MYSTERY,
  MYSTERY_SKIN,
  type IRoboCategory,
  type ITraitArt,
  ROBO_LAYERS,
  ROLLED_CATEGORIES,
  shade
} from './roboTraits.js'

const isGradient = (art: ITraitArt): art is IGradientArt => 'gradient' in art

const hashKey = (key: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const INK_LIGHT = '#f4f6fb'
const INK_DARK = '#15161a'

const channelLuminance = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const relativeLuminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return (
    0.2126 * channelLuminance((n >> 16) & 255) +
    0.7152 * channelLuminance((n >> 8) & 255) +
    0.0722 * channelLuminance(n & 255)
  )
}

const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

const inkFor = (skin: string) => {
  const skinLum = relativeLuminance(skin)
  return contrastRatio(relativeLuminance(INK_LIGHT), skinLum) >= contrastRatio(relativeLuminance(INK_DARK), skinLum)
    ? INK_LIGHT
    : INK_DARK
}

const weightedPick = (seed: string, category: IRoboCategory) => {
  const entryList = Object.entries(category.traits)
  const total = entryList.reduce((sum, [, art]) => sum + (art.weight ?? 1), 0)
  let cursor = (hashKey(`${seed}:${category.name}`) / 0x100000000) * total
  for (const [name, art] of entryList) {
    cursor -= art.weight ?? 1
    if (cursor < 0) return name
  }
  return entryList[entryList.length - 1][0]
}

const artToSvg = (art: ITraitArt, idSuffix: string, ink: string): { defs: string; body: string } => {
  if (isGradient(art)) {
    const id = `bg${idSuffix}`
    const center = shade(art.gradient[0], 1.12)
    const mid = art.gradient[1]
    const edge = shade(art.gradient[1], 0.5)
    return {
      defs: `<radialGradient id="${id}" cx="50%" cy="42%" r="78%"><stop offset="0" stop-color="${center}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${edge}"/></radialGradient>`,
      body: `<rect width="24" height="24" fill="url(#${id})"/>`
    }
  }

  const ox = art.x ?? 0
  const oy = art.y ?? 0
  const pathByColor = new Map<string, string>()
  art.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.' || ch === ' ') continue
      const slot = art.palette[Number.parseInt(ch, 36)]
      if (!slot) continue
      const color = slot === INK ? ink : slot
      pathByColor.set(color, `${pathByColor.get(color) ?? ''}M${ox + c} ${oy + r}h1v1h-1z`)
    }
  })

  let body = ''
  for (const [color, d] of pathByColor) body += `<path fill="${color}" d="${d}"/>`
  return { defs: '', body }
}

export const roboTraitsFromAddress = (address: Address): Record<string, string> => {
  const seed = address.toLowerCase()
  const traits: Record<string, string> = {}
  for (const category of ROBO_LAYERS) traits[category.name] = weightedPick(seed, category)
  return traits
}

export const ROBO_LAYER_KEYS: string[][] = ROBO_LAYERS.map(category => Object.keys(category.traits))

export const roboTraitsFromIndices = (indices: number[]): Record<string, string> => {
  const traits: Record<string, string> = {}
  ROBO_LAYERS.forEach((category, layer) => {
    const keys = ROBO_LAYER_KEYS[layer]
    const idx = indices[layer]
    traits[category.name] = (idx != null && keys[idx]) || keys[0]
  })
  return traits
}

export const roboIndicesFromTraits = (traits: Record<string, string>): number[] =>
  ROBO_LAYERS.map((category, layer) => {
    const at = ROBO_LAYER_KEYS[layer].indexOf(traits[category.name])
    return at < 0 ? 0 : at
  })

export const roboIndicesFromAddress = (address: Address): number[] => roboIndicesFromTraits(roboTraitsFromAddress(address))

export const roboTraitsFromNameAndAddress = (indices: number[] | null, address: Address): Record<string, string> => {
  const fromAddress = roboTraitsFromAddress(address)
  if (!indices) return fromAddress
  const picked = roboTraitsFromIndices(indices)
  const traits: Record<string, string> = {}
  for (const category of ROBO_LAYERS)
    traits[category.name] = ROLLED_CATEGORIES.has(category.name) ? fromAddress[category.name] : picked[category.name]
  return traits
}

export const roboPreviewTraits = (indices: number[]): Record<string, string> => {
  const picked = roboTraitsFromIndices(indices)
  const traits: Record<string, string> = {}
  for (const category of ROBO_LAYERS)
    traits[category.name] = ROLLED_CATEGORIES.has(category.name) ? MYSTERY : picked[category.name]
  return traits
}

export interface ITraitOdds {
  key: string
  percent: number
}

export const traitRollOdds = (categoryName: string): ITraitOdds[] => {
  const category = ROBO_LAYERS.find(c => c.name === categoryName)
  if (!category) return []
  const entryList = Object.entries(category.traits)
  const total = entryList.reduce((sum, [, art]) => sum + (art.weight ?? 1), 0)
  return entryList
    .map(([key, art]) => ({ key, percent: ((art.weight ?? 1) / total) * 100 }))
    .sort((a, b) => b.percent - a.percent)
}

export const SKIN_LADDER: string[] = traitRollOdds('skin').map(o => o.key)

export const HEADWEAR_LADDER: string[] = traitRollOdds('headwear').map(o => o.key)

export const tierFromPercentile = (percentile: number, ladderLength: number): number =>
  Math.max(0, Math.min(ladderLength - 1, Math.floor(percentile * ladderLength)))

export interface IFundRank {
  pnlPercentile: number | null
  roiPercentile: number | null
}

export const roboTraitsFromRank = (
  indices: number[] | null,
  address: Address,
  rank: IFundRank
): Record<string, string> => {
  const base = indices ? roboTraitsFromIndices(indices) : roboTraitsFromAddress(address)
  const traits: Record<string, string> = { ...base }
  traits.skin =
    rank.pnlPercentile == null ? SKIN_LADDER[0] : SKIN_LADDER[tierFromPercentile(rank.pnlPercentile, SKIN_LADDER.length)]
  traits.headwear =
    rank.roiPercentile == null
      ? HEADWEAR_LADDER[0]
      : HEADWEAR_LADDER[tierFromPercentile(rank.roiPercentile, HEADWEAR_LADDER.length)]
  return traits
}

const TYPE_NOUN: Record<string, string> = {
  black: 'Shadow',
  zombie: 'Zombie',
  robot: 'Bot',
  monkey: 'Ape',
  alien: 'Alien',
  skeleton: 'Bones',
  vampire: 'Vamp',
  gold: 'Goldie',
  ice: 'Frost',
  demon: 'Demon',
  invisible: 'Ghost'
}

const TRAIT_ADJECTIVE: Record<string, string> = {
  horns: 'Wicked',
  halo: 'Holy',
  crown: 'Royal',
  cap: 'Sporty',
  beanie: 'Cozy',
  tophat: 'Dapper',
  mohawk: 'Punk',
  bow: 'Cute',
  antenna: 'Wired',
  durag: 'Slick',
  party: 'Festive',
  cowboy: 'Rowdy',
  headphones: 'Tuned',
  flower: 'Sunny',
  sprout: 'Sprouty',
  grad: 'Scholarly',
  santa: 'Jolly',
  headband: 'Athletic',
  flames: 'Blazing',
  kingcrown: 'Regal',
  wizard: 'Arcane',
  purpletophat: 'Velvet',
  propeller: 'Whirly',
  catears: 'Feline',
  bunny: 'Hoppy',
  afro: 'Funky',
  chef: 'Gourmet',
  jester: 'Zany',
  antlers: 'Stag',
  viking: 'Norse',
  pirate: 'Salty',
  unicorn: 'Magical',
  arrow: 'Pierced',
  raincloud: 'Stormy',
  cone: 'Conehead',
  mushroom: 'Shroomy',
  helmet: 'Cosmic',
  brain: 'Cerebral',
  shades: 'Cool',
  bigshades: 'Shady',
  tintshades: 'Tinted',
  prism: 'Prismatic',
  blaze: 'Fiery',
  rainbowshades: 'Dazzling',
  visor: 'Cyber',
  laser: 'Laser',
  heart: 'Lovestruck',
  star: 'Starry',
  cyclops: 'One-Eyed',
  wink: 'Cheeky',
  angry: 'Furious',
  specs: 'Brainy',
  money: 'Loaded',
  vr: 'Plugged',
  sleepy: 'Drowsy',
  dots: 'Curious',
  glow: 'Spectral',
  dead: 'Wasted'
}

export const roboAvatarNameFromTraits = (traits: Record<string, string>): string => {
  const adjective = TRAIT_ADJECTIVE[traits.headwear !== 'none' ? traits.headwear : traits.eyes] ?? 'Mystery'
  return `${adjective} ${TYPE_NOUN[traits.skin] ?? 'Pup'}`
}

export const roboAvatarName = (address: Address): string => roboAvatarNameFromTraits(roboTraitsFromAddress(address))

export const renderRoboAvatar = (chosen: Record<string, string>, idSuffix: string): string => {
  const skinArt = chosen.skin === MYSTERY ? MYSTERY_SKIN : ROBO_LAYERS[1].traits[chosen.skin]
  const skin = isGradient(skinArt) ? '#000000' : skinArt.palette[0]
  const ink = inkFor(skin)
  const hideMouth = chosen.face === 'mask'

  let defs = ''
  let body = ''
  for (const category of ROBO_LAYERS) {
    if (category.name === 'mouth' && hideMouth) continue
    const key = chosen[category.name]
    if (key === MYSTERY) {
      if (category.name !== 'skin') continue
      const part = artToSvg(MYSTERY_SKIN, idSuffix, ink)
      defs += part.defs
      body += part.body
      continue
    }
    const part = artToSvg(category.traits[key], idSuffix, ink)
    defs += part.defs
    body += part.body
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges" width="100%" height="100%"><defs>${defs}</defs>${body}</svg>`
}

export const roboAvatarSvg = (address: Address): string =>
  renderRoboAvatar(roboTraitsFromAddress(address), address.toLowerCase().slice(2, 8))

export const roboAvatarSvgFromTraits = (chosen: Record<string, string>, idSuffix: string): string =>
  renderRoboAvatar(chosen, idSuffix)
