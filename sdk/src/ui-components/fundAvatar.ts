import { type Address, hexToBytes } from 'viem'
import { SYMBOL_PATTERN } from '../account/createAccount.js'

export const GRID = 11
export const CELLS = GRID * GRID

export type ICells = readonly string[]

export const PALETTE = [
  '#ffffff',
  '#000000',
  '#f4dd88',
  '#ecac73',
  '#e7786a',
  '#e875a1',
  '#ad7aca',
  '#c2e785',
  '#76c783',
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
export const DARKEST = PALETTE_LAB.reduce((best, lab, i) => (lab[0] < PALETTE_LAB[best]![0] ? i : best), 0)
export const LIGHTEST = PALETTE_LAB.reduce((best, lab, i) => (lab[0] > PALETTE_LAB[best]![0] ? i : best), 0)

interface IRobotPart {
  y: number
  rows: readonly string[]
}

const SQUARE_WEAR: readonly IRobotPart[] = [
  { y: 0, rows: ['.....t.....', '.....a.....'] },
  { y: 0, rows: ['...t...t...', '...a...a...'] },
  { y: 0, rows: ['.......t...', '.......a...'] },
  { y: 4, rows: ['.a.......a.', '.a.......a.'] },
  { y: 1, rows: ['..ttttttt..'] },
  { y: 0, rows: ['....ttt....', '..ttttttt..'] },
  { y: 1, rows: ['..t.....t..'] },
  { y: 1, rows: ['...t.t.t...'] },
  { y: 0, rows: [] }
]

const ROUNDED_WEAR: readonly IRobotPart[] = [
  { y: 0, rows: ['.....t.....', '.....a.....'] },
  { y: 0, rows: ['...t...t...', '...a...a...'] },
  { y: 0, rows: ['.......t...', '.......a...'] },
  { y: 4, rows: ['.a.......a.', '.a.......a.'] },
  { y: 0, rows: ['....ttt....', '...aaaaa...'] },
  { y: 1, rows: ['...t...t...'] },
  { y: 1, rows: ['...t.t.t...'] },
  { y: 0, rows: [] }
]

const ROBOT_HEADS: readonly (IRobotPart & { wear: readonly IRobotPart[] })[] = [
  {
    y: 2,
    rows: ['..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..'],
    wear: SQUARE_WEAR
  },
  {
    y: 2,
    rows: ['...hhhhh...', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '...hhhhh...'],
    wear: ROUNDED_WEAR
  },
  {
    y: 3,
    rows: ['.hhhhhhhhh.', '.hhhhhhhhh.', '.hhhhhhhhh.', '.hhhhhhhhh.', '..hhhhhhh..'],
    wear: [
      { y: 1, rows: ['.....t.....', '.....a.....'] },
      { y: 1, rows: ['...t...t...', '...a...a...'] },
      { y: 0, rows: ['.....t.....', '.....a.....', '.....a.....'] },
      { y: 1, rows: ['.......t...', '.......a...'] },
      { y: 2, rows: ['..ttttttt..'] },
      { y: 1, rows: ['....ttt....', '.ttttttttt.'] },
      { y: 2, rows: ['.t.......t.'] },
      { y: 0, rows: [] }
    ]
  },
  {
    y: 2,
    rows: ['....hhh....', '...hhhhh...', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..'],
    wear: [
      { y: 0, rows: ['.....t.....', '.....a.....'] },
      { y: 4, rows: ['.a.......a.', '.a.......a.'] },
      { y: 1, rows: ['....ttt....'] },
      { y: 2, rows: ['...t...t...'] },
      { y: 0, rows: [] }
    ]
  },
  {
    y: 1,
    rows: ['..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..', '..hhhhhhh..'],
    wear: [
      { y: 0, rows: ['.....t.....'] },
      { y: 0, rows: ['...t...t...'] },
      { y: 0, rows: ['.......t...'] },
      { y: 3, rows: ['.a.......a.', '.a.......a.'] },
      { y: 0, rows: ['...t.t.t...'] },
      { y: 0, rows: [] }
    ]
  },
  {
    y: 2,
    rows: ['..hhhhhhh..', '..hfffffh..', '..hfffffh..', '..hfffffh..', '..hfffffh..', '..hfffffh..'],
    wear: SQUARE_WEAR
  },
  {
    y: 2,
    rows: ['...hhhhh...', '..hfffffh..', '..hfffffh..', '..hfffffh..', '..hfffffh..', '..hfffffh..'],
    wear: ROUNDED_WEAR
  },
  {
    y: 2,
    rows: ['..hhhhhhh..', '.hhhhhhhhh.', '.hhhhhhhhh.', '.hhhhhhhhh.', '.hhhhhhhhh.', '..hhhhhhh..'],
    wear: [
      { y: 0, rows: ['.....t.....', '.....a.....'] },
      { y: 0, rows: ['...t...t...', '...a...a...'] },
      { y: 0, rows: ['.......t...', '.......a...'] },
      { y: 1, rows: ['..ttttttt..'] },
      { y: 0, rows: ['....ttt....', '..ttttttt..'] },
      { y: 1, rows: ['...t.t.t...'] },
      { y: 0, rows: [] }
    ]
  }
]

const ROBOT_EYES: readonly IRobotPart[] = [
  { y: 4, rows: ['...e...e...'] },
  { y: 4, rows: ['...ep.ep...'] },
  { y: 4, rows: ['...pe.pe...'] },
  { y: 4, rows: ['...eeeee...'] },
  { y: 4, rows: ['...epepe...'] },
  { y: 3, rows: ['....eee....', '....epe....'] },
  { y: 3, rows: ['...e...e...', '...p...p...'] },
  { y: 3, rows: ['...ee.ee...', '...ep.ep...'] },
  { y: 4, rows: ['....e.e....'] },
  { y: 3, rows: ['....e.e....', '....p.p....'] },
  { y: 3, rows: ['...ee......', '...ee..e...'] },
  { y: 3, rows: ['...ee.ee...', '...ee.ee...'] },
  { y: 3, rows: ['...pp.pp...', '...ee.ee...'] }
]

const ROBOT_MOUTHS: readonly IRobotPart[] = [
  { y: 6, rows: ['....mmm....'] },
  { y: 6, rows: ['...m.m.m...'] },
  { y: 6, rows: ['...mmmmm...'] },
  { y: 6, rows: ['.....m.....'] },
  { y: 6, rows: ['...m...m...', '....mmm....'] },
  { y: 6, rows: ['....m.m....'] },
  { y: 6, rows: ['....mmm....', '...m...m...'] },
  { y: 6, rows: ['...mmmmm...', '....m.m....'] },
  { y: 6, rows: ['.....mm....'] },
  { y: 6, rows: ['...m.m.m...', '....m.m....'] }
]

const ROBOT_BODIES: readonly IRobotPart[] = [
  { y: 8, rows: ['....nnn....', '..bbbbbbb..', '..bbbbbbb..'] },
  { y: 8, rows: ['....nnn....', '..bbbcbbb..', '..bbbbbbb..'] },
  { y: 8, rows: ['.....n.....', '...bbbbb...', '..bbbbbbb..'] },
  { y: 8, rows: ['....nnn....', '..bbcbcbb..', '..bbbbbbb..'] },
  { y: 8, rows: ['.bb.nnn.bb.', '.bbbbbbbbb.', '..bbbbbbb..'] },
  { y: 8, rows: ['....nnn....', '..bbcccbb..', '..bbcccbb..'] },
  { y: 8, rows: ['....nnn....', '..bbbbbbb..', '..bcccccb..'] },
  { y: 8, rows: ['....nnn....', '..bbbcbbb..', '..bbbcbbb..'] },
  { y: 8, rows: ['...nnnnn...', '..bbbbbbb..', '..bbbbbbb..'] }
]

const ROBOT_CONTRAST = 0.2
const ROBOT_INK = 0.4

const ROBOT_ROLLS = 16

function robotCells(dice: Uint8Array): string[] {
  if (dice.length < ROBOT_ROLLS) throw new Error(`a robot needs ${ROBOT_ROLLS} bytes to roll, got ${dice.length}`)
  let rolled = 0
  const pick = <T>(list: readonly T[]): T => list[dice[rolled++]! % list.length]!
  const colours = PALETTE_LAB.map((_, colour) => colour)
  const apart = (from: readonly number[], least: number): number[] =>
    colours.filter(colour =>
      from.every(other => Math.hypot(PALETTE_LAB[colour]![0] - PALETTE_LAB[other]![0], PALETTE_LAB[colour]![1] - PALETTE_LAB[other]![1], PALETTE_LAB[colour]![2] - PALETTE_LAB[other]![2]) >= least)
    )
  const inked = (on: number): number[] => colours.filter(colour => Math.abs(PALETTE_LAB[colour]![0] - PALETTE_LAB[on]![0]) >= ROBOT_INK)

  const ground = pick(colours)
  const head = pick(apart([ground], ROBOT_CONTRAST))
  const plate = pick(apart([ground, head], ROBOT_CONTRAST))
  const body = pick(apart([ground], ROBOT_CONTRAST))
  const tip = pick(apart([ground], ROBOT_CONTRAST).filter(colour => colour !== head))
  const shape = pick(ROBOT_HEADS)
  const parts = [pick(ROBOT_BODIES), shape, pick(shape.wear), pick(ROBOT_EYES), pick(ROBOT_MOUTHS)]
  const face = shape.rows.some(row => row.includes('f')) ? plate : head
  const eye = pick(inked(face))
  const role: Record<string, number> = {
    h: head,
    f: plate,
    e: eye,
    p: PALETTE_LAB[eye]![0] > 0.5 ? DARKEST : LIGHTEST,
    m: pick(inked(face)),
    a: pick([head, body]),
    t: tip,
    n: pick([head, body, tip]),
    b: body,
    c: pick(inked(body))
  }

  const cells: number[] = Array.from({ length: CELLS }, () => ground)
  for (const part of parts) {
    part.rows.forEach((row, r) => {
      for (let x = 0; x < GRID; x++) {
        if (row[x] !== '.') cells[(part.y + r) * GRID + x] = role[row[x]!]!
      }
    })
  }
  return cells.map(colour => PALETTE[colour]!)
}

export const randomCells = (): string[] => robotCells(crypto.getRandomValues(new Uint8Array(ROBOT_ROLLS)))

export const robotCellsOf = (address: Address): string[] => robotCells(hexToBytes(address))

export const avatarSvg = (cells: ICells): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">${cells
    .map((colour, i) => `<rect x="${i % GRID}" y="${Math.floor(i / GRID)}" width="1" height="1" fill="${colour}"/>`)
    .join('')}</svg>`

const SYMBOL_LEAD = ['ZAP', 'BOLT', 'NEON', 'VOLT', 'MEGA', 'ROBO', 'PIXL', 'GIGA', 'NANO']
const SYMBOL_TAIL = ['BOT', 'PUP', 'BIT', 'CORE', 'UNIT', 'MECH', 'GEAR', 'CHIP', 'BYTE']

const unfit = SYMBOL_LEAD.flatMap(lead => SYMBOL_TAIL.map(tail => `${lead}${tail}`)).filter(symbol => !SYMBOL_PATTERN.test(symbol))
if (unfit.length > 0) throw new Error(`generated fund symbols must satisfy ${SYMBOL_PATTERN}; these do not: ${unfit.join(', ')}`)

const symbolFrom = (dice: Uint8Array): string => `${SYMBOL_LEAD[dice[0]! % SYMBOL_LEAD.length]}${SYMBOL_TAIL[dice[1]! % SYMBOL_TAIL.length]}`

export const randomSymbol = (): string => symbolFrom(crypto.getRandomValues(new Uint8Array(2)))

export const symbolOf = (address: Address): string => symbolFrom(hexToBytes(address).subarray(ROBOT_ROLLS))
