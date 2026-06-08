import type { Address } from 'viem/accounts'
import { type IGradientArt, INK, type IRoboCategory, type ITraitArt, ROBO_LAYERS } from './roboTraits.js'

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

const scaleColor = (hex: string, factor: number) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * factor)))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const artToSvg = (art: ITraitArt, idSuffix: string, ink: string): { defs: string; body: string } => {
  if (isGradient(art)) {
    const id = `bg${idSuffix}`
    const center = scaleColor(art.gradient[0], 1.12)
    const mid = art.gradient[1]
    const edge = scaleColor(art.gradient[1], 0.5)
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
  rainbow: 'Prism',
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

export const roboAvatarName = (address: Address): string => {
  const traits = roboTraitsFromAddress(address)
  const adjective = TRAIT_ADJECTIVE[traits.headwear !== 'none' ? traits.headwear : traits.eyes] ?? 'Mystery'
  return `${adjective} ${TYPE_NOUN[traits.head] ?? 'Pup'}`
}

export const roboAvatarSvg = (address: Address): string => {
  const seed = address.toLowerCase()
  const idSuffix = seed.slice(2, 8)
  const chosen = roboTraitsFromAddress(address)

  const headArt = ROBO_LAYERS[1].traits[chosen.head]
  const skin = isGradient(headArt) ? '#000000' : headArt.palette[0]
  const ink = inkFor(skin)
  const hideMouth = chosen.face === 'mask'

  let defs = ''
  let body = ''
  for (const category of ROBO_LAYERS) {
    if (category.name === 'mouth' && hideMouth) continue
    const part = artToSvg(category.traits[chosen[category.name]], idSuffix, ink)
    defs += part.defs
    body += part.body
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges" width="100%" height="100%"><defs>${defs}</defs>${body}</svg>`
}
