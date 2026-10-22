import { type Address, hexToBytes } from 'viem'
import { GRID, SYMBOL_PATTERN } from '../account/createAccount.js'

export { GRID }
export const CELLS = GRID * GRID

export type ICells = readonly string[]

export const PALETTE = [
  '#ffffff',
  '#000000',
  '#9e9e9e',
  '#f4dd88',
  '#ecac73',
  '#e7786a',
  '#e875a1',
  '#ad7aca',
  '#c2e785',
  '#76c783',
  '#68d3ca',
  '#7ccaeb',
  '#5a90de'
] as const

export const rgbOf = (colour: string): [number, number, number] => [
  Number.parseInt(colour.slice(1, 3), 16),
  Number.parseInt(colour.slice(3, 5), 16),
  Number.parseInt(colour.slice(5, 7), 16)
]

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})

export function oklabOf(r: number, g: number, b: number): [number, number, number] {
  const lr = LINEAR[r]!
  const lg = LINEAR[g]!
  const lb = LINEAR[b]!
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

export const PALETTE_LAB = PALETTE.map(colour => oklabOf(...rgbOf(colour)))

const WHITE = PALETTE.indexOf('#ffffff')
const BLACK = PALETTE.indexOf('#000000')
const GREY = PALETTE.indexOf('#9e9e9e')
const YELLOW = PALETTE.indexOf('#f4dd88')
const ORANGE = PALETTE.indexOf('#ecac73')
const RED = PALETTE.indexOf('#e7786a')
const PINK = PALETTE.indexOf('#e875a1')
const LIME = PALETTE.indexOf('#c2e785')
const CHROMATIC = PALETTE.map((_, i) => i).filter(i => i !== WHITE && i !== BLACK && i !== GREY)
const GILDED = [YELLOW, ORANGE, LIME]

const labGap = (a: number, b: number): number =>
  Math.hypot(PALETTE_LAB[a]![0] - PALETTE_LAB[b]![0], PALETTE_LAB[a]![1] - PALETTE_LAB[b]![1], PALETTE_LAB[a]![2] - PALETTE_LAB[b]![2])
const lightness = (i: number): number => PALETTE_LAB[i]![0]

type IWeighted<T> = readonly (readonly [number, T])[]

interface IRobotHead {
  top: number
  half: readonly number[]
}

const ROBOT_HEADS: readonly IRobotHead[] = [
  { top: 3, half: [4, 4, 4, 4, 4, 4] },
  { top: 3, half: [3, 4, 4, 4, 4, 3] },
  { top: 2, half: [2, 3, 4, 4, 4, 4, 4] },
  { top: 4, half: [5, 5, 5, 5, 5] },
  { top: 2, half: [3, 3, 3, 3, 3, 3, 3] },
  { top: 3, half: [4, 4, 4, 4, 3, 2] },
  { top: 3, half: [2, 3, 4, 4, 3, 2] },
  { top: 3, half: [3, 4, 5, 5, 4, 3] },
  { top: 2, half: [5, 4, 4, 4, 4, 4, 4] },
  { top: 3, half: [1, 3, 4, 4, 4, 3] },
  { top: 4, half: [3, 4, 4, 4, 3] },
  { top: 3, half: [5, 5, 5, 5, 4, 3] }
]

const ROBOT_PAIR_EYES: IWeighted<readonly string[]> = [
  [7, ['e']],
  [5, ['e', 'e']],
  [5, ['ee']],
  [4, ['ee', 'ee']],
  [3, ['Ee', 'ee']],
  [3, ['e.', '.e']],
  [3, ['.e.', 'e.e']],
  [2, ['.e.', 'eEe', '.e.']]
]

const ROBOT_SOLID_EYES = 4

const ROBOT_CENTRE_EYES: IWeighted<readonly string[]> = [
  [3, ['e']],
  [3, ['eEe']],
  [2, ['eeeee']]
]

const ROBOT_MOUTHS: IWeighted<readonly string[]> = [[9, []], [3, ['mmm']], [2, ['mmmmm']], [2, ['m.m.m']], [2, ['m']], [1, ['mm.mm']]]

const ROBOT_WEAR: IWeighted<readonly (readonly string[])[]> = [
  [12, [[]]],
  [6, [['E', 'a', 'a'], ['E', 'a']]],
  [3, [['E...E', 'a...a', 'a...a'], ['E...E', 'a...a']]],
  [3, [['sEs']]],
  [2, [['E', 'sss']]],
  [2, [['..E', '.a.', 'a..'], ['.E', 'a.']]]
]

const ROBOT_BODIES: IWeighted<readonly string[]> = [
  [3, ['.....aaa.....', '..lbbbbbbbb..', '.lbbbbbbbbbb.', 'lbbbbbbbbbbbb']],
  [2, ['.....aaa.....', '...lbbbbbb...', '..lbbbbbbbb..', '.lbbbbbbbbbb.']],
  [2, ['......a......', '....lbbbb....', '...lbbbbbb...', '..lbbbbbbbb..']]
]

const ROBOT_CHEST: IWeighted<readonly string[]> = [
  [10, []],
  [3, ['......E......']],
  [2, ['.....E.E.....']],
  [2, ['......E......', '.....EEE.....']]
]

type IRobotFlair = 'none' | 'laser' | 'noggles' | 'coins' | 'chain' | 'pendant' | 'crown' | 'halo' | 'gem' | 'upOnly' | 'hoodie'

const ROBOT_FLAIRS: IWeighted<IRobotFlair> = [
  [60, 'none'],
  [4, 'laser'],
  [5, 'noggles'],
  [4, 'coins'],
  [5, 'chain'],
  [4, 'pendant'],
  [3, 'crown'],
  [3, 'halo'],
  [4, 'gem'],
  [4, 'upOnly'],
  [4, 'hoodie']
]

const FLAIR_WEAR: Partial<Record<IRobotFlair, { rows: readonly string[]; gap: number }>> = {
  crown: { rows: ['o.o.o', 'ooooo'], gap: 0 },
  halo: { rows: ['ooooo', 'o...o'], gap: 1 },
  gem: { rows: ['EOE', '.E.'], gap: 1 }
}

const FLAIR_CHEST: Partial<Record<IRobotFlair, readonly string[]>> = {
  chain: ['...o.....o...', '....o...o....', '.....oOo.....'],
  pendant: ['...o.....o...', '....o...o....', '.....ooo.....'],
  upOnly: ['......E......', '.....EEE.....', '....EEEEE....']
}

const HOODIE = ['..HHHHHHHHH..', '.HHHHdHdHHHH.', 'HHHHHdHdHHHHH', 'HHHHHHHHHHHHH']
const NOGGLES = ['..ffff.ffff..', 'fffWKfffWKf..', '..ffff.ffff..']
const COIN = ['ooo', 'o.o', 'ooo']

const APE_HEAD = ['....sssss....', '...sfffffs...', '..sfffffffs..', 'aasfsffssfsaa', 'ansfffnfffsna']
const APE_MOUTHS = [
  ['.asfwwwwwfsa.', '..sfwfffwfs..', '...sffpffs...', '...swfpfws...', '...sfwwwfs...', '....sssss....'],
  ['.asfwwwwwfsg.', '..sfwwwwwfsg.', '...sffffcccr.', '...swwwwws...', '...sfwwwfs...', '....sssss....'],
  ['.asfwwwwwfsa.', '..sfwwwwffs..', '...sffffps...', '...swwwwps...', '...sfwwwfs...', '....sssss....']
]
const APE_EYES = 3
const APE_CHEST = ['......E......', '.....EEE.....']
const APE_ODDS = 16

const ROBOT_ROLLS = 16
const MIDDLE = (GRID - 1) / 2

const inCircle = (x: number, y: number): boolean => (x - MIDDLE) ** 2 + (y - MIDDLE) ** 2 <= (GRID / 2) ** 2
const centred = (row: string): number => MIDDLE - (row.length - 1) / 2
const mirror = (shape: readonly string[]): string[] => shape.map(row => [...row].reverse().join(''))

function robotCells(dice: Uint8Array): string[] {
  if (dice.length < ROBOT_ROLLS) throw new Error(`a robot needs ${ROBOT_ROLLS} bytes to roll, got ${dice.length}`)
  const weigh = <T>(list: IWeighted<T>, at: number): T => {
    let left = dice[at]! % list.reduce((sum, [weight]) => sum + weight, 0)
    for (const [weight, value] of list) {
      if (left < weight) return value
      left -= weight
    }
    throw new Error(`roll ${at} fell past its weighted list`)
  }

  const groundMode = (['white', 'white', 'tint', 'tint', 'tint', 'tint', 'black'] as const)[dice[2]! % 7]!
  const ape = dice[15]! % APE_ODDS === 0
  const apeGrounds = CHROMATIC.filter(colour => lightness(colour) <= 0.77 && CHROMATIC.some(frame => lightness(frame) >= 0.79 && labGap(frame, colour) >= 0.2))
  const ground =
    groundMode === 'black' ? BLACK : ape ? apeGrounds[dice[1]! % apeGrounds.length]! : groundMode === 'white' ? WHITE : CHROMATIC[dice[1]! % CHROMATIC.length]!
  const shells = CHROMATIC.filter(colour => colour !== ground && labGap(colour, ground) >= 0.2 && (!ape || lightness(colour) >= 0.79))
  const shell = shells[dice[0]! % shells.length]!
  const shade =
    CHROMATIC.filter(colour => colour !== shell && lightness(colour) <= lightness(shell) - 0.04 && labGap(colour, shell) <= 0.17).sort(
      (a, b) => labGap(a, shell) - labGap(b, shell)
    )[0] ?? shell
  const glows = [WHITE, ...CHROMATIC].filter(colour => lightness(colour) >= 0.65 && labGap(colour, shell) >= 0.15 && labGap(colour, ground) >= 0.15)
  const glow = glows[dice[3]! % glows.length]!
  const laser = [RED, PINK].find(colour => labGap(colour, ground) >= 0.15)
  const head = ROBOT_HEADS[dice[4]! % ROBOT_HEADS.length]!

  const isHead = (x: number, y: number): boolean => {
    const r = y - head.top
    return r >= 0 && r < head.half.length && Math.abs(x - MIDDLE) <= head.half[r]!
  }
  const interior = (x: number, y: number): boolean =>
    isHead(x, y) && isHead(x - 1, y) && isHead(x + 1, y) && isHead(x, y - 1) && isHead(x, y + 1)
  const faceHalf = (y: number): number => {
    let reach = -1
    for (let d = 0; d <= MIDDLE; d++) if (interior(MIDDLE + d, y)) reach = d
    return reach
  }
  const eyeRow = head.top + (head.half.length >= 7 ? 3 : head.half.length >= 6 ? 2 : 1)
  const mouthRow = eyeRow + 2

  const fits = (flair: IRobotFlair): boolean => {
    if (flair === 'laser') return laser !== undefined
    if (flair === 'hoodie') return !ape
    if (flair === 'noggles') return !ape
    if (ape && FLAIR_CHEST[flair] !== undefined) return false
    if (flair === 'coins') return !ape && [eyeRow - 1, eyeRow, eyeRow + 1].every(y => faceHalf(y) >= 3)
    const wear = FLAIR_WEAR[flair]
    return wear === undefined || (!ape && wear.rows.length + wear.gap <= head.top)
  }
  const flair = weigh(ROBOT_FLAIRS.filter(([, candidate]) => fits(candidate)), 5)

  const gilded = GILDED.includes(shell) || GILDED.includes(ground)
  const tone = {
    shell: PALETTE[shell]!,
    shade: PALETTE[shade]!,
    screen: PALETTE[BLACK]!,
    glare: PALETTE[GREY]!,
    glow: PALETTE[glow]!,
    core: PALETTE[WHITE]!,
    metal: PALETTE[labGap(GREY, ground) >= 0.15 ? GREY : BLACK]!,
    ink: PALETTE[BLACK]!,
    precious: PALETTE[gilded ? (ground === WHITE ? GREY : WHITE) : YELLOW]!,
    ground: PALETTE[ground]!,
    hood: PALETTE[ground === BLACK ? GREY : BLACK]!
  }

  const face = flair === 'noggles' ? 'bare' : weigh<'screen' | 'visor' | 'bare'>([[3, 'screen'], [4, 'visor'], [3, 'bare']], 6)
  const pairEyes = weigh(face === 'bare' ? ROBOT_PAIR_EYES.slice(0, ROBOT_SOLID_EYES) : ROBOT_PAIR_EYES, 7)
  const centreEyes = face !== 'bare' && dice[8]! % 5 === 0 ? weigh(ROBOT_CENTRE_EYES, 9) : null
  const mouth = weigh(ROBOT_MOUTHS, 10)
  const wearings = weigh(ROBOT_WEAR, 11)
  const ears = weigh<'none' | 'bolt' | 'phones'>([[6, 'none'], [3, 'bolt'], [2, 'phones']], 12)
  const body = weigh(ROBOT_BODIES, 13)
  const chest = weigh(ROBOT_CHEST, 14)

  const cells: string[] = Array.from({ length: CELLS }, () => tone.ground)
  const set = (x: number, y: number, colour: string): void => {
    if (x >= 0 && x < GRID && y >= 0 && y < GRID) cells[y * GRID + x] = colour
  }
  const paint = (rows: readonly string[], left: number, top: number, roles: Record<string, string>): void =>
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) if (row[i] !== '.') set(left + i, top + r, roles[row[i]!]!)
    })
  const paintCentred = (rows: readonly string[], top: number, roles: Record<string, string>): void => {
    for (const [r, row] of rows.entries()) paint([row], centred(row), top + r, roles)
  }

  if (ape) {
    const warm = [ORANGE, PINK, YELLOW, RED].find(colour => labGap(colour, shell) >= 0.15)
    if (warm === undefined) throw new Error(`no warm colour clears the shell ${PALETTE[shell]}`)
    const apeMouth = APE_MOUTHS[dice[10]! % APE_MOUTHS.length]!
    const roles: Record<string, string> = { s: tone.shell, f: PALETTE[BLACK]!, a: ground === BLACK ? tone.shell : PALETTE[BLACK]!, n: PALETTE[warm]!, w: tone.core, p: PALETTE[PINK]!, c: PALETTE[warm]! }
    if (apeMouth === APE_MOUTHS[1]) {
      const ember = [RED, ORANGE, YELLOW, PINK, WHITE].find(colour => colour !== warm && labGap(colour, ground) >= 0.15)
      const smoke = [GREY, WHITE].find(colour => labGap(colour, ground) >= 0.15)
      if (ember === undefined || smoke === undefined) throw new Error(`no cigar ember or smoke contrasts the ground ${PALETTE[ground]}`)
      roles.r = PALETTE[ember]!
      roles.g = PALETTE[smoke]!
    }
    const hueGap = (colour: number): number => {
      const turn = Math.abs(Math.atan2(PALETTE_LAB[colour]![2], PALETTE_LAB[colour]![1]) - Math.atan2(PALETTE_LAB[shell]![2], PALETTE_LAB[shell]![1]))
      return Math.min(turn, 2 * Math.PI - turn)
    }
    const coat = CHROMATIC.filter(colour => colour !== shell && colour !== ground && lightness(colour) <= lightness(shell) - 0.04 && labGap(colour, ground) >= 0.12).sort(
      (a, b) => hueGap(a) - hueGap(b)
    )[0]
    if (coat === undefined) throw new Error(`no coat darker than the shell ${PALETTE[shell]} clears the ground ${PALETTE[ground]}`)
    paint(ROBOT_BODIES[0]![1].slice(1, 3), 0, 11, { b: PALETTE[coat]!, l: tone.shell })
    paint(APE_CHEST, 0, 11, { E: labGap(glow, coat) >= 0.2 ? tone.glow : tone.core })
    paint([...APE_HEAD, ...apeMouth], 0, 0, roles)
    const eyes = APE_EYES
    if (flair === 'laser') {
      if (laser === undefined) throw new Error(`laser eyes were picked on a ground no laser colour contrasts`)
      for (let x = 0; x < GRID; x++) if (x < MIDDLE - 1 || x > MIDDLE + 1) set(x, eyes, PALETTE[laser]!)
      set(MIDDLE - 1, eyes, tone.core)
      set(MIDDLE + 1, eyes, tone.core)
    } else if (flair === 'noggles') {
      paint(NOGGLES, 0, eyes - 1, { f: tone.glow, W: tone.core, K: tone.ink })
    } else if (flair === 'coins') {
      paint(COIN, MIDDLE - 3, eyes - 1, { o: tone.precious })
      paint(COIN, MIDDLE + 1, eyes - 1, { o: tone.precious })
    }
    return cells
  }

  if (flair === 'hoodie') paint(HOODIE, 0, 9, { H: tone.hood, d: tone.shell })
  else {
    paint(body, 0, 9, { a: tone.metal, b: tone.shade, l: tone.shell })
    paint(FLAIR_CHEST[flair] ?? chest, 0, 10, { o: tone.precious, O: tone.core, E: tone.glow })
  }

  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      if (isHead(x, y)) set(x, y, isHead(x, y - 1) && (!isHead(x, y + 1) || !isHead(x + 1, y)) ? tone.shade : tone.shell)
    }
  if (flair === 'hoodie') {
    for (const r of [head.half.length - 2, head.half.length - 1]) {
      set(MIDDLE - head.half[r]! - 1, head.top + r, tone.hood)
      set(MIDDLE + head.half[r]! + 1, head.top + r, tone.hood)
    }
  }

  const eyeTopOf = (shape: readonly string[]): number => eyeRow - (shape.length === 3 ? 1 : 0)
  const pairAt = (shape: readonly string[], spread: number): (readonly [readonly string[], number])[] => [
    [shape, MIDDLE - spread - shape[0]!.length + 1],
    [mirror(shape), MIDDLE + spread]
  ]
  const spreadOf = (shape: readonly string[]): number => {
    for (let spread = 1 + (dice[9]! % 3); spread >= 1; spread--) {
      const onFace = pairAt(shape, spread).every(([rows, left]) =>
        rows.every((row, r) => [...row].every((c, i) => c === '.' || interior(left + i, eyeTopOf(shape) + r)))
      )
      if (onFace) return spread
    }
    return 0
  }
  const pairShape = spreadOf(pairEyes) > 0 ? pairEyes : ['e']
  const pairSpread = spreadOf(pairShape)
  if (pairSpread === 0) throw new Error(`no eye placement fits the face of the head starting at row ${head.top}`)
  const [bandTop, bandRows] =
    flair === 'coins' ? [eyeRow - 1, 3] : flair === 'laser' || centreEyes !== null ? [eyeRow, 1] : [eyeTopOf(pairShape), pairShape.length]
  const onFace = (y: number): boolean => face === 'screen' || (face === 'visor' && y >= bandTop && y < bandTop + bandRows)
  let glared = face !== 'screen'
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++)
      if (interior(x, y) && onFace(y)) {
        set(x, y, glared ? tone.screen : tone.glare)
        glared = true
      }

  const ink = { e: face === 'bare' ? tone.ink : tone.glow, E: face === 'bare' ? tone.ink : tone.core }
  if (flair === 'laser') {
    if (laser === undefined) throw new Error(`laser eyes were picked on a ground no laser colour contrasts`)
    const spread = Math.min(2, faceHalf(eyeRow))
    for (let x = 0; x < GRID; x++) if (x < MIDDLE - spread || x > MIDDLE + spread) set(x, eyeRow, PALETTE[laser]!)
    set(MIDDLE - spread, eyeRow, tone.core)
    set(MIDDLE + spread, eyeRow, tone.core)
  } else if (flair === 'noggles') {
    paint(NOGGLES, 0, eyeRow - 1, { f: tone.glow, W: tone.core, K: tone.ink })
  } else if (flair === 'coins') {
    paint(COIN, MIDDLE - 3, eyeRow - 1, { o: tone.precious })
    paint(COIN, MIDDLE + 1, eyeRow - 1, { o: tone.precious })
  } else if (centreEyes !== null) {
    paintCentred(centreEyes[0]!.length > 2 * faceHalf(eyeRow) + 1 ? ['e'] : centreEyes, eyeRow, ink)
  } else {
    for (const [rows, left] of pairAt(pairShape, pairSpread)) paint(rows, left, eyeTopOf(pairShape), ink)
  }

  if (mouth.length > 0 && flair !== 'noggles' && flair !== 'coins') {
    paintCentred(mouth[0]!.length > 2 * faceHalf(mouthRow) + 1 ? ['m'] : mouth, mouthRow, { m: face === 'screen' ? tone.glow : tone.ink })
  }

  if (ears !== 'none') {
    for (const y of ears === 'bolt' ? [eyeRow] : [eyeRow, eyeRow + 1]) {
      const reach = head.half[y - head.top]! + 1
      set(MIDDLE - reach, y, ears === 'bolt' ? tone.metal : tone.glow)
      set(MIDDLE + reach, y, ears === 'bolt' ? tone.metal : tone.glow)
    }
  }

  const crowning = FLAIR_WEAR[flair]
  if (crowning !== undefined) {
    paintCentred(crowning.rows, head.top - crowning.rows.length - crowning.gap, { o: tone.precious, E: tone.glow, O: tone.core })
  } else {
    const wear =
      wearings.find(rows => rows.every((row, r) => [...row].every((c, i) => c === '.' || inCircle(centred(row) + i, head.top - rows.length + r)))) ?? []
    paintCentred(wear, head.top - wear.length, { a: tone.metal, E: tone.glow, s: tone.shade })
  }

  return cells
}

export const randomCells = (): string[] => robotCells(crypto.getRandomValues(new Uint8Array(ROBOT_ROLLS)))

export const robotCellsOf = (address: Address): string[] => robotCells(hexToBytes(address))

export const avatarSvg = (cells: ICells): string => {
  const side = Math.sqrt(cells.length)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">${cells
    .map((colour, i) => `<rect x="${i % side}" y="${Math.floor(i / side)}" width="1" height="1" fill="${colour}"/>`)
    .join('')}</svg>`
}

const SYMBOL_LEAD = ['ZAP', 'BOLT', 'NEON', 'VOLT', 'MEGA', 'ROBO', 'PIXL', 'GIGA', 'NANO']
const SYMBOL_TAIL = ['BOT', 'PUP', 'BIT', 'CORE', 'UNIT', 'MECH', 'GEAR', 'CHIP', 'BYTE']

const unfit = SYMBOL_LEAD.flatMap(lead => SYMBOL_TAIL.map(tail => `${lead}${tail}`)).filter(symbol => !SYMBOL_PATTERN.test(symbol))
if (unfit.length > 0) throw new Error(`generated fund symbols must satisfy ${SYMBOL_PATTERN}; these do not: ${unfit.join(', ')}`)

export const randomSymbol = (): string => {
  const [lead, tail] = crypto.getRandomValues(new Uint8Array(2))
  return `${SYMBOL_LEAD[lead! % SYMBOL_LEAD.length]}${SYMBOL_TAIL[tail! % SYMBOL_TAIL.length]}`
}
