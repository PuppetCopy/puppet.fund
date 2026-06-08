import { type IArt, type IKind, type ILayer, INK } from '../avatarEngine.js'

const SIZE = 32
const PINK = '#f2a6c6'
const SHADOW_ROW_STEP = -1

type Spans = Record<number, [number, number][]>

const grid = (spans: Spans): string[] =>
  Array.from({ length: SIZE }, (_, r) => {
    const cells = Array<string>(SIZE).fill('.')
    for (const [a, b] of spans[r] ?? []) for (let c = a; c <= b; c++) cells[c] = '#'
    return cells.join('')
  })

const mask = (rows: string[]): boolean[][] => rows.map(row => Array.from({ length: SIZE }, (_, c) => row[c] === '#'))

const paint = (rows: string[], color: string): IArt => ({
  palette: [color],
  rows: rows.map(row => Array.from(row, ch => (ch === '#' ? '0' : '.')).join(''))
})

const layered = (palette: string[], parts: [number, Spans][]): IArt => {
  const cells = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'))
  for (const [idx, spans] of parts)
    for (const key of Object.keys(spans)) {
      const r = Number(key)
      for (const [a, b] of spans[r]) for (let c = a; c <= b; c++) cells[r][c] = idx.toString(36)
    }
  return { palette, rows: cells.map(row => row.join('')) }
}

const darken = (hex: string, amount: number): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift: number) => {
    const v = Math.max(0, Math.round(((n >> shift) & 255) * (1 - amount)))
    return v.toString(16).padStart(2, '0')
  }
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

const HEAD_SIL = mask(
  grid({
    7: [[12, 19]],
    8: [[9, 22]],
    9: [[7, 24]],
    10: [[7, 24]],
    11: [[6, 25]],
    12: [[6, 25]],
    13: [[6, 25]],
    14: [[7, 24]],
    15: [[7, 24]],
    16: [[8, 23]],
    17: [[8, 23]],
    18: [[9, 22]],
    19: [[10, 21]],
    20: [[11, 20]],
    21: [[12, 19]],
    22: [[13, 18]],
    23: [[14, 17]],
    24: [[15, 16]]
  })
)

const SHADOW: boolean[][] = Array.from({ length: SIZE }, (_, r) =>
  Array.from({ length: SIZE }, (_, c) => {
    if (HEAD_SIL[r][c]) return false
    for (let k = 1; c - k >= 0; k++) {
      const sr = r + SHADOW_ROW_STEP * k
      if (sr < 0 || sr >= SIZE) break
      if (HEAD_SIL[sr][c - k]) return true
    }
    return false
  })
)

const bgArt = (bg: string): IArt => ({
  palette: [bg, darken(bg, 0.26)],
  rows: SHADOW.map(row => row.map(s => (s ? '1' : '0')).join(''))
})

const MUZZLE = grid({
  13: [[13, 18]],
  14: [[12, 19]],
  15: [[11, 20]],
  16: [[11, 20]],
  17: [[11, 20]],
  18: [[11, 20]],
  19: [[12, 19]],
  20: [[12, 19]],
  21: [[13, 18]],
  22: [[14, 17]]
})

const eyeShaded = (spansBlack: Spans, spansPink: Spans): IArt =>
  layered(
    [INK, PINK],
    [
      [0, spansBlack],
      [1, spansPink]
    ]
  )

const EYES: Record<string, IArt> = {
  shaded: eyeShaded(
    {
      9: [
        [9, 12],
        [18, 21]
      ],
      10: [
        [9, 12],
        [18, 21]
      ]
    },
    {
      11: [
        [9, 12],
        [18, 21]
      ]
    }
  ),
  plain: paint(
    grid({
      9: [
        [9, 12],
        [18, 21]
      ],
      10: [
        [9, 12],
        [18, 21]
      ]
    }),
    INK
  ),
  sleepy: paint(
    grid({
      10: [
        [9, 12],
        [18, 21]
      ]
    }),
    INK
  ),
  wide: paint(
    grid({
      8: [
        [9, 12],
        [18, 21]
      ],
      9: [
        [9, 12],
        [18, 21]
      ],
      10: [
        [9, 12],
        [18, 21]
      ]
    }),
    INK
  ),
  wink: paint(grid({ 9: [[18, 21]], 10: [[18, 21]], 11: [[9, 12]] }), INK),
  round: paint(
    grid({
      9: [
        [10, 12],
        [18, 20]
      ],
      10: [
        [10, 12],
        [18, 20]
      ]
    }),
    INK
  ),
  half: paint(
    grid({
      9: [
        [9, 12],
        [18, 21]
      ],
      11: [
        [9, 12],
        [18, 21]
      ]
    }),
    INK
  ),
  angry: paint(
    grid({
      9: [
        [11, 12],
        [18, 19]
      ],
      10: [
        [9, 12],
        [18, 21]
      ]
    }),
    INK
  )
}

const SNOUT = layered(
  [INK, PINK],
  [
    [
      0,
      {
        14: [
          [13, 14],
          [17, 18]
        ],
        15: [
          [13, 14],
          [17, 18]
        ]
      }
    ],
    [
      1,
      {
        16: [
          [13, 13],
          [18, 18]
        ]
      }
    ]
  ]
)

const MOUTH: Record<string, IArt> = {
  open: layered(
    [INK, PINK],
    [
      [0, { 17: [[13, 18]], 19: [[9, 22]] }],
      [1, { 18: [[14, 17]] }]
    ]
  ),
  smile: paint(
    grid({
      18: [
        [13, 13],
        [18, 18]
      ],
      19: [[14, 17]]
    }),
    INK
  ),
  neutral: paint(grid({ 18: [[13, 18]] }), INK),
  grin: paint(grid({ 17: [[14, 17]], 18: [[13, 18]] }), INK),
  ooo: paint(grid({ 18: [[15, 16]], 19: [[15, 16]] }), INK),
  flat: paint(grid({ 18: [[10, 21]] }), INK),
  frown: paint(
    grid({
      18: [[14, 17]],
      19: [
        [13, 13],
        [18, 18]
      ]
    }),
    INK
  ),
  tongue: layered(
    [INK, PINK],
    [
      [0, { 17: [[13, 18]], 18: [[13, 18]] }],
      [1, { 19: [[15, 16]] }]
    ]
  )
}

const MARKS: Record<string, IArt> = {
  blush: paint(
    grid({
      16: [
        [10, 11],
        [20, 21]
      ]
    }),
    PINK
  ),
  gem: paint(grid({ 7: [[15, 16]] }), '#5fe0e0')
}

const HEADWEAR: Record<string, IArt> = {
  crown: paint(
    grid({
      3: [
        [11, 11],
        [15, 16],
        [20, 20]
      ],
      4: [[11, 20]],
      5: [[11, 20]]
    }),
    '#f5c84b'
  ),
  cap: paint(grid({ 4: [[11, 20]], 5: [[9, 22]], 6: [[20, 26]] }), '#e8604f'),
  halo: paint(grid({ 3: [[12, 19]] }), '#f5d24b'),
  party: paint(grid({ 2: [[15, 16]], 3: [[14, 17]], 4: [[13, 18]], 5: [[12, 19]] }), '#f06ba8'),
  banana: paint(
    grid({
      4: [[12, 19]],
      5: [
        [10, 12],
        [19, 21]
      ]
    }),
    '#f5c84b'
  )
}

const FGFX: Record<string, IArt> = {
  sparkle: paint(
    grid({ 6: [[6, 6]], 7: [[5, 7]], 8: [[6, 6]], 24: [[25, 25]], 25: [[24, 26]], 26: [[25, 25]] }),
    '#f4f6fb'
  )
}

const BG: Array<{ name: string; color: string; weight: number }> = [
  { name: 'rose', color: '#e85b95', weight: 6 },
  { name: 'periwinkle', color: '#6b7cf0', weight: 6 },
  { name: 'magenta', color: '#e34fb0', weight: 5 },
  { name: 'coral', color: '#f5765f', weight: 5 },
  { name: 'butter', color: '#f5c24b', weight: 5 },
  { name: 'mint', color: '#4fd6a8', weight: 5 },
  { name: 'sky', color: '#4fb0f0', weight: 5 },
  { name: 'lilac', color: '#b06bf0', weight: 5 },
  { name: 'sage', color: '#86c25f', weight: 4 },
  { name: 'tangerine', color: '#f59a3c', weight: 5 },
  { name: 'aqua', color: '#3fc8d6', weight: 5 },
  { name: 'grape', color: '#7b6bf0', weight: 5 },
  { name: 'flamingo', color: '#f56b8b', weight: 5 },
  { name: 'ocean', color: '#4f8bf0', weight: 5 },
  { name: 'slateblue', color: '#5f6bd6', weight: 5 },
  { name: 'teal', color: '#2fb8a8', weight: 4 },
  { name: 'cherry', color: '#e8506b', weight: 5 },
  { name: 'violet', color: '#9b5bf0', weight: 5 },
  { name: 'lime', color: '#a8d048', weight: 4 },
  { name: 'sunset', color: '#f08050', weight: 5 },
  { name: 'cobalt', color: '#3f6be0', weight: 5 },
  { name: 'bubblegum', color: '#f078c0', weight: 5 }
]

const MUZZLE_TONES: Array<{ name: string; color: string; weight: number }> = [
  { name: 'white', color: '#f6f7fb', weight: 22 },
  { name: 'cream', color: '#f3ecd8', weight: 5 },
  { name: 'peachwhite', color: '#f8eae4', weight: 4 }
]

const layerFromArts = (
  name: string,
  z: number,
  arts: Record<string, IArt>,
  weights: Record<string, number>,
  optional = false
): ILayer => ({
  name,
  z,
  optional,
  options: Object.entries(arts).map(([n, art]) => ({ name: n, art, weight: weights[n] ?? 1 }))
})

export const monkey: IKind = {
  name: 'monkey',
  canvas: SIZE,
  baseTone: '#f6f7fb',
  layers: [
    {
      name: 'background',
      z: 0,
      options: BG.map(b => ({ name: b.name, art: bgArt(b.color), weight: b.weight }))
    },
    layerFromArts('marks', 2, MARKS, { blush: 5, gem: 2 }, true),
    layerFromArts('eyes', 3, EYES, { shaded: 13, plain: 9, sleepy: 5, wide: 5, wink: 4, round: 6, half: 4, angry: 4 }),
    {
      name: 'muzzle',
      z: 4,
      options: MUZZLE_TONES.map(m => ({ name: m.name, art: paint(MUZZLE, m.color), weight: m.weight }))
    },
    { name: 'snout', z: 5, options: [{ name: 'face', art: SNOUT }] },
    layerFromArts('mouth', 6, MOUTH, {
      open: 12,
      smile: 12,
      neutral: 7,
      grin: 6,
      ooo: 5,
      flat: 5,
      frown: 4,
      tongue: 5
    }),
    layerFromArts('headwear', 7, HEADWEAR, { crown: 2, cap: 1, halo: 1, party: 1, banana: 1 }, true),
    layerFromArts('fgfx', 8, FGFX, { sparkle: 1 }, true)
  ]
}
