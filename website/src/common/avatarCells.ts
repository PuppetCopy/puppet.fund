import { CELLS, DARKEST, GRID, LIGHTEST, oklabOf, PALETTE, PALETTE_LAB, rgbOf } from '@puppet/sdk/ui-components'

const ACHROMATIC_CHROMA = 0.06
const SPLIT_FLOOR = 0.35
const SPLIT_CEILING = 0.65
const FEATURE_SHARE = 0.2
const FEATURE_CONTRAST = 0.4
const FEATURE_CORE = 0.35
const FEATURE_FOCUS = 1.5
const SECOND_SHARE = 0.05
const ENHANCE = [
  { chroma: 1, contrast: 1 },
  { chroma: 1.6, contrast: 1.4 },
  { chroma: 2.5, contrast: 1.8 },
  { chroma: 4, contrast: 2.2 }
]

function paletteIndexOf(lightness: number, a: number, b: number, split: number): number {
  if (Math.hypot(a, b) < ACHROMATIC_CHROMA) return lightness < split ? DARKEST : LIGHTEST
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  PALETTE_LAB.forEach(([pl, pa, pb], i) => {
    const distance = (lightness - pl) ** 2 + (a - pa) ** 2 + (b - pb) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  })
  return best
}

function splitOf(histogram: Float64Array): number {
  let total = 0
  let weighted = 0
  for (let bin = 0; bin < 256; bin++) {
    total += histogram[bin]!
    weighted += bin * histogram[bin]!
  }
  let below = 0
  let belowWeighted = 0
  let best = 128
  let bestSpread = -1
  for (let bin = 0; bin < 256; bin++) {
    below += histogram[bin]!
    belowWeighted += bin * histogram[bin]!
    const above = total - below
    if (below === 0 || above === 0) continue
    const spread = below * above * (belowWeighted / below - (weighted - belowWeighted) / above) ** 2
    if (spread > bestSpread) {
      bestSpread = spread
      best = bin
    }
  }
  return Math.min(SPLIT_CEILING, Math.max(SPLIT_FLOOR, (best + 1) / 256))
}

const RING = 0.04
const RING_UNIFORM = 0.9
const BACKGROUND_TOLERANCE = 0.08
const SUBJECT_LINE = 0.015
const SUBJECT_FILL = 0.85
const SUBJECT_MARGIN = 1.25
const RARITY_CAP = 4

function subjectOf(data: Uint8ClampedArray, lab: Float64Array, side: number): { x: number; y: number; size: number } {
  const whole = { x: 0, y: 0, size: side }
  const ring = Math.max(1, Math.round(side * RING))
  const edge: number[] = []
  let clear = 0
  let framed = 0
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x >= ring && x < side - ring && y >= ring && y < side - ring) continue
      framed++
      if (data[(y * side + x) * 4 + 3]! < 128) clear++
      else edge.push(y * side + x)
    }
  }
  const transparent = clear >= RING_UNIFORM * framed
  const middle = (channel: number): number => edge.map(i => lab[i * 3 + channel]!).sort((m, n) => m - n)[edge.length >> 1]!
  const ground = transparent || edge.length === 0 ? null : [middle(0), middle(1), middle(2)]
  const isGround = (i: number): boolean =>
    data[i * 4 + 3]! < 128 ||
    (ground !== null && Math.hypot(lab[i * 3]! - ground[0]!, lab[i * 3 + 1]! - ground[1]!, lab[i * 3 + 2]! - ground[2]!) < BACKGROUND_TOLERANCE)
  if (!transparent && edge.filter(isGround).length + clear < RING_UNIFORM * framed) return whole

  const across = new Float64Array(side)
  const down = new Float64Array(side)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (isGround(y * side + x)) continue
      across[x]! += 1
      down[y]! += 1
    }
  }
  const spanOf = (line: Float64Array): [number, number] | null => {
    const filled = [...line.keys()].filter(at => line[at]! >= SUBJECT_LINE * side)
    return filled.length === 0 ? null : [filled[0]!, filled[filled.length - 1]!]
  }
  const wide = spanOf(across)
  const tall = spanOf(down)
  if (wide === null || tall === null) return whole
  const reach = Math.max(wide[1] - wide[0], tall[1] - tall[0]) + 1
  if (reach >= SUBJECT_FILL * side) return whole
  const size = Math.min(side, Math.ceil(reach * SUBJECT_MARGIN))
  const place = (span: [number, number]): number => Math.min(side - size, Math.max(0, Math.round((span[0] + span[1] + 1 - size) / 2)))
  return { x: place(wide), y: place(tall), size }
}

export function cellsFromPixels(data: Uint8ClampedArray, side: number, backdrop: string): string[] {
  const count = side * side
  const lab = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    const [l, a, b] = oklabOf(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!)
    lab[i * 3] = l
    lab[i * 3 + 1] = a
    lab[i * 3 + 2] = b
  }
  const subject = subjectOf(data, lab, side)
  const cellOf = (x: number, y: number): number =>
    Math.floor(((y - subject.y) * GRID) / subject.size) * GRID + Math.floor(((x - subject.x) * GRID) / subject.size)

  const spread = new Float64Array(256)
  let opaque = 0
  for (let y = subject.y; y < subject.y + subject.size; y++) {
    for (let x = subject.x; x < subject.x + subject.size; x++) {
      const i = y * side + x
      const alpha = data[i * 4 + 3]! / 255
      spread[Math.min(255, Math.floor(lab[i * 3]! * 256))]! += alpha
      opaque += alpha
    }
  }
  let median = 0.5
  for (let bin = 0, seen = 0; bin < 256; bin++) {
    seen += spread[bin]!
    if (seen >= opaque / 2) {
      median = (bin + 0.5) / 256
      break
    }
  }
  const back = paletteIndexOf(...oklabOf(...rgbOf(backdrop)), 0.5)

  let cells: string[] = []
  for (const { chroma, contrast } of ENHANCE) {
    const lightnessAt = (i: number): number => Math.min(1, Math.max(0, median + (lab[i * 3]! - median) * contrast))
    const neutral = new Float64Array(256)
    for (let y = subject.y; y < subject.y + subject.size; y++) {
      for (let x = subject.x; x < subject.x + subject.size; x++) {
        const i = y * side + x
        if (Math.hypot(lab[i * 3 + 1]!, lab[i * 3 + 2]!) * chroma >= ACHROMATIC_CHROMA) continue
        neutral[Math.min(255, Math.floor(lightnessAt(i) * 256))]! += data[i * 4 + 3]! / 255
      }
    }
    const split = splitOf(neutral)

    const area = new Float64Array(CELLS * PALETTE.length)
    const covered = new Float64Array(CELLS)
    const core = new Float64Array(CELLS * PALETTE.length)
    const coreCovered = new Float64Array(CELLS)
    const common = new Float64Array(PALETTE.length)
    for (let y = subject.y; y < subject.y + subject.size; y++) {
      for (let x = subject.x; x < subject.x + subject.size; x++) {
        const i = y * side + x
        const cell = cellOf(x, y)
        const alpha = data[i * 4 + 3]! / 255
        covered[cell]! += 1
        area[cell * PALETTE.length + back]! += 1 - alpha
        common[back]! += 1 - alpha
        if (alpha === 0) continue
        const colour = paletteIndexOf(lightnessAt(i), lab[i * 3 + 1]! * chroma, lab[i * 3 + 2]! * chroma, split)
        area[cell * PALETTE.length + colour]! += alpha
        common[colour]! += alpha
        const acrossCell = (((x - subject.x) * GRID) / subject.size) % 1
        const downCell = (((y - subject.y) * GRID) / subject.size) % 1
        if (acrossCell < 0.25 || acrossCell >= 0.75 || downCell < 0.25 || downCell >= 0.75) continue
        core[cell * PALETTE.length + colour]! += alpha
        coreCovered[cell]! += 1
      }
    }

    const total = subject.size * subject.size
    const rarity = Array.from(common, seen => (seen === 0 ? 0 : Math.min(RARITY_CAP, Math.sqrt(total / seen))))
    const share = (cell: number, colour: number): number => area[cell * PALETTE.length + colour]! / covered[cell]!
    const winner = Array.from({ length: CELLS }, (_, cell) => {
      let best = 0
      for (let colour = 1; colour < PALETTE.length; colour++) {
        if (share(cell, colour) * rarity[colour]! > share(cell, best) * rarity[best]!) best = colour
      }
      return best
    })
    const settled = winner.map((won, cell) => {
      const x = cell % GRID
      const y = Math.floor(cell / GRID)
      const around = [x > 0 ? cell - 1 : null, x < GRID - 1 ? cell + 1 : null, y > 0 ? cell - GRID : null, y < GRID - 1 ? cell + GRID : null]
        .filter((near): near is number => near !== null)
        .map(near => winner[near]!)
      let feature = won
      for (let colour = 0; colour < PALETTE.length; colour++) {
        if (colour === won || share(cell, colour) < FEATURE_SHARE) continue
        if (PALETTE_LAB[won]![0] - PALETTE_LAB[colour]![0] < FEATURE_CONTRAST) continue
        if (around.includes(colour) && core[cell * PALETTE.length + colour]! < Math.max(FEATURE_CORE, FEATURE_FOCUS * share(cell, colour)) * coreCovered[cell]!) continue
        if (feature === won || share(cell, colour) > share(cell, feature)) feature = colour
      }
      return feature
    })

    const cleaned = settled.map((colour, cell) => {
      const x = cell % GRID
      const y = Math.floor(cell / GRID)
      const near: number[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dy !== 0) && x + dx >= 0 && x + dx < GRID && y + dy >= 0 && y + dy < GRID) near.push(settled[cell + dy * GRID + dx]!)
        }
      }
      if (near.includes(colour)) return colour
      const usual = near.reduce((best, each) => (near.filter(n => n === each).length > near.filter(n => n === best).length ? each : best))
      return PALETTE_LAB[usual]![0] - PALETTE_LAB[colour]![0] >= FEATURE_CONTRAST ? colour : usual
    })

    cells = cleaned.map(colour => PALETTE[colour]!)
    const second = PALETTE.map((_, colour) => cleaned.filter(each => each === colour).length).sort((m, n) => n - m)[1]!
    if (second >= SECOND_SHARE * CELLS) break
  }
  return cells
}

const MAX_SIDE = 1408

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (bitmapErr) {
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return image
    } catch (imageErr) {
      URL.revokeObjectURL(url)
      throw new Error(
        `${file.name || 'that file'} could not be read as an image (${imageErr instanceof Error ? imageErr.message : String(imageErr)}; the fast path said ${bitmapErr instanceof Error ? bitmapErr.message : String(bitmapErr)})`
      )
    }
  }
}

const square = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('this browser gave no 2d canvas to read the image with')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
}

const BLOCK = 32
const SAMPLE_SIDE = GRID * BLOCK

export async function cellsFromImage(file: File, backdrop = '#ffffff'): Promise<string[]> {
  const source = await decode(file)
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height
  if (width === 0 || height === 0) throw new Error(`${file.name || 'that file'} decoded to an empty image`)
  const side = Math.min(width, height)
  const sx = Math.floor((width - side) / 2)
  const sy = Math.floor((height - side) / 2)

  let size = Math.max(SAMPLE_SIDE, Math.min(side, MAX_SIDE))
  let step = square(size)
  step.drawImage(source, sx, sy, side, side, 0, 0, size, size)
  if (source instanceof HTMLImageElement) URL.revokeObjectURL(source.src)
  else source.close()

  while (size > SAMPLE_SIDE * 2) {
    const next = Math.max(SAMPLE_SIDE, size >> 1)
    const half = square(next)
    half.drawImage(step.canvas, 0, 0, size, size, 0, 0, next, next)
    step = half
    size = next
  }
  const sample = square(SAMPLE_SIDE)
  sample.drawImage(step.canvas, 0, 0, size, size, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE)

  return cellsFromPixels(sample.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data, SAMPLE_SIDE, backdrop)
}
