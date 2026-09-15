import type { Address } from 'viem/accounts'
import { inkFor, pixelArtToSvg, unit, weightedPick } from './avatarEngine.js'
import { type IGradientArt, INK, type ITraitArt, ROBO_LAYERS, shade } from './roboTraits.js'

const isGradient = (art: ITraitArt): art is IGradientArt => 'gradient' in art

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

  return { defs: '', body: pixelArtToSvg(art, slot => (slot === INK ? ink : slot)) }
}

export const roboTraitsFromAddress = (address: Address): Record<string, string> => {
  const seed = address.toLowerCase()
  const traits: Record<string, string> = {}
  for (const category of ROBO_LAYERS)
    traits[category.name] = weightedPick(
      Object.entries(category.traits),
      ([, art]) => art.weight ?? 1,
      unit(`${seed}:${category.name}`)
    )[0]
  return traits
}

export const ROBO_LAYER_KEYS: string[][] = ROBO_LAYERS.map(category => Object.keys(category.traits))

const roboTraitsFromIndices = (indices: number[]): Record<string, string> => {
  const traits: Record<string, string> = {}
  ROBO_LAYERS.forEach((category, layer) => {
    const keys = ROBO_LAYER_KEYS[layer]
    const idx = indices[layer]
    traits[category.name] = (idx != null && keys[idx]) || keys[0]
  })
  return traits
}

const roboIndicesFromTraits = (traits: Record<string, string>): number[] =>
  ROBO_LAYERS.map((category, layer) => {
    const at = ROBO_LAYER_KEYS[layer].indexOf(traits[category.name])
    return at < 0 ? 0 : at
  })

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

const SKIN_LADDER: string[] = traitRollOdds('skin').map(o => o.key)

const HEADWEAR_LADDER: string[] = traitRollOdds('headwear').map(o => o.key)

const tierFromPercentile = (percentile: number, ladderLength: number): number =>
  Math.max(0, Math.min(ladderLength - 1, Math.floor(percentile * ladderLength)))

export interface IAccountRank {
  pnlPercentile: number | null
  roiPercentile: number | null
}

export const roboTraitsFromRank = (
  indices: number[] | null,
  address: Address,
  rank: IAccountRank
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

export const renderRoboAvatar = (chosen: Record<string, string>, idSuffix: string): string => {
  const skinArt = ROBO_LAYERS[1].traits[chosen.skin]
  const skin = isGradient(skinArt) ? '#000000' : skinArt.palette[0]
  const ink = inkFor(skin)

  let defs = ''
  let body = ''
  for (const category of ROBO_LAYERS) {
    const part = artToSvg(category.traits[chosen[category.name]], idSuffix, ink)
    defs += part.defs
    body += part.body
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges" width="100%" height="100%"><defs>${defs}</defs>${body}</svg>`
}
