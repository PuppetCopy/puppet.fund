export type IRoboArt = { x?: number; y?: number; palette: string[]; rows: string[]; weight?: number }
export type IGradientArt = { gradient: [string, string]; weight?: number }
export type ITraitArt = IRoboArt | IGradientArt

export type IRoboCategory = { name: string; traits: Record<string, ITraitArt> }

export const INK = '@ink'

const shade = (hex: string, factor: number): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * factor)))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const headBlock = (skin: string): IRoboArt => ({
  x: 4,
  y: 4,
  palette: [skin, shade(skin, 1.2), shade(skin, 0.72)],
  rows: ['1111111111111111', ...Array.from({ length: 14 }, () => '0000000000000000'), '2222222222222222']
})

const headBands = (colorList: string[]): IRoboArt => {
  const rowsPerBand = 16 / colorList.length
  return {
    x: 4,
    y: 4,
    palette: colorList,
    rows: Array.from({ length: 16 }, (_, r) =>
      Math.floor(r / rowsPerBand)
        .toString(36)
        .repeat(16)
    )
  }
}

const background: IRoboCategory = {
  name: 'background',
  traits: {
    teal: { gradient: ['#75e0cf', '#6bcad3'] },
    grape: { gradient: ['#c38fff', '#a277ff'] },
    gold: { gradient: ['#ffde75', '#ffb86b'] },
    lime: { gradient: ['#92de75', '#79c66b'] },
    rose: { gradient: ['#ff8fb5', '#e2799a'] },
    sky: { gradient: ['#aadeff', '#8cb8f6'] },
    ember: { gradient: ['#ff826b', '#d66561'] },
    midnight: { gradient: ['#6975a8', '#5c5f75'] },
    mint: { gradient: ['#9cf4cf', '#71d3ad'] },
    sunset: { gradient: ['#ffc475', '#ff8ca2'] },
    violet: { gradient: ['#b38fff', '#806dc8'] },
    slate: { gradient: ['#a6adbd', '#808694'] },
    coral: { gradient: ['#ffa68f', '#ff8ca2'] },
    forest: { gradient: ['#75bd75', '#62976d'] },
    neon: { gradient: ['#d4ff75', '#7ed697'] }
  }
}

const head: IRoboCategory = {
  name: 'head',
  traits: {
    black: { ...headBlock('#131418'), weight: 75 },
    zombie: { ...headBlock('#5b934d'), weight: 9 },
    robot: { ...headBlock('#405576'), weight: 6 },
    monkey: { ...headBlock('#714a31'), weight: 3 },
    alien: { ...headBlock('#3daf9d'), weight: 2.5 },
    skeleton: { ...headBlock('#bfbbaf'), weight: 1.8 },
    vampire: { ...headBlock('#aaa0b8'), weight: 1.2 },
    gold: { ...headBlock('#c8a236'), weight: 0.9 },
    ice: { ...headBlock('#9dbfd1'), weight: 0.4 },
    demon: { ...headBlock('#d14a31'), weight: 0.2 },
    rainbow: {
      ...headBands(['#d14a4a', '#d17e31', '#d1ac30', '#4ea957', '#34abb8', '#3d65d1', '#644bd1', '#9d58d1']),
      weight: 0.02
    },
    invisible: {
      x: 4,
      y: 4,
      palette: ['#ffffff26'],
      rows: Array.from({ length: 16 }, () => '0000000000000000'),
      weight: 0.05
    }
  }
}

const neck: IRoboCategory = {
  name: 'neck',
  traits: {
    none: { palette: [], rows: [], weight: 3 },
    bandana: { x: 6, y: 19, palette: ['#e0263f'], rows: ['000000000000', '.0000000000.', '..00000000..'] },
    chain: { x: 6, y: 20, palette: ['#ffd23a'], rows: ['0.0.0.0.0.0.'] },
    collar: { x: 7, y: 19, palette: ['#f2f4f8'], rows: ['0........0', '.0......0.'] },
    scarf: { x: 5, y: 19, palette: ['#5a78d6'], rows: ['00000000000000', '0............0'] },
    tie: { x: 11, y: 19, palette: ['#e0263f'], rows: ['00', '00', '.0'] },
    hoodie: { x: 4, y: 19, palette: ['#5a6070'], rows: ['0000000000000000', '0..............0'] },
    goldchain: { x: 6, y: 20, palette: ['#ffd23a', '#e0263f'], rows: ['0.0.0.0.0.0.', '.....11.....'], weight: 0.4 }
  }
}

const mouth: IRoboCategory = {
  name: 'mouth',
  traits: {
    grin: { x: 8, y: 16, palette: [INK], rows: ['00000000', '0.0.0.0.'] },
    fangs: { x: 8, y: 16, palette: [INK], rows: ['00000000', '.0....0.'] },
    open: { x: 8, y: 15, palette: ['#ffffff', '#15161a', '#ff5a7a'], rows: ['00000000', '11111111', '.122221.'] },
    smirk: { x: 9, y: 17, palette: [INK], rows: ['.0000.'] },
    frown: { x: 9, y: 16, palette: [INK], rows: ['0....0', '.0000.'] },
    ooo: { x: 10, y: 15, palette: [INK], rows: ['.00.', '0..0', '.00.'] },
    tongue: { x: 10, y: 17, palette: ['#ff5a7a'], rows: ['00000'] },
    kiss: { x: 10, y: 16, palette: ['#ff5a7a'], rows: ['0000', '.00.'] },
    gum: { x: 14, y: 15, palette: ['#ff8fc2'], rows: ['.0', '00', '00', '.0'] },
    drool: { x: 11, y: 17, palette: ['#5ac8ff'], rows: ['0', '0', '0'] },
    biggrin: { x: 7, y: 16, palette: [INK], rows: ['0000000000', '0.0.0.0.0.'] },
    grillz: { x: 8, y: 16, palette: ['#ffd23a', '#15161a'], rows: ['00000000', '01010101'], weight: 0.5 },
    rainbowgrillz: {
      x: 8,
      y: 16,
      palette: ['#ff3b54', '#ffd23a', '#3fd070', '#3f9bff', '#9b6bff', '#15161a'],
      rows: ['01234012', '5.5.5.5.'],
      weight: 0.3
    }
  }
}

const eyes: IRoboCategory = {
  name: 'eyes',
  traits: {
    shades: { x: 6, y: 10, palette: ['#ffffff', '#15161a'], rows: ['010101010101', '101010101010', '010101010101'] },
    visor: { x: 6, y: 10, palette: ['#1ad0ff', '#0a86b8'], rows: ['000000000000', '111111111111'] },
    laser: { x: 6, y: 11, palette: ['#ff2d2d', '#ffd0d0'], rows: ['000000000000', '111111111111'] },
    heart: { x: 8, y: 10, palette: ['#ff3b54'], rows: ['0.0..0.0', '000..000', '.0....0.'] },
    star: { x: 8, y: 10, palette: ['#ffd23a'], rows: ['0.0..0.0', '000..000', '.0....0.'] },
    cyclops: { x: 10, y: 10, palette: ['#ffffff', '#15161a'], rows: ['0000', '0110', '0000'] },
    wink: { x: 8, y: 11, palette: [INK], rows: ['00....00', '00......'] },
    angry: { x: 8, y: 10, palette: [INK], rows: ['0......0', '.0....0.', '00....00'] },
    specs: { x: 8, y: 10, palette: ['#15161a', '#ffffff'], rows: ['000.000', '010.010', '000.000'] },
    money: { x: 8, y: 10, palette: ['#3fd070'], rows: ['000..000', '0.0..0.0', '000..000'] },
    vr: { x: 5, y: 9, palette: ['#2a2f45', '#5ac8ff'], rows: ['0000000000000', '0111111111110', '0000000000000'] },
    sleepy: { x: 7, y: 12, palette: [INK], rows: ['0000..0000'] },
    dots: { x: 8, y: 11, palette: [INK], rows: ['00....00', '00....00'] },
    glow: { x: 8, y: 10, palette: ['#5cf2ff'], rows: ['00....00', '00....00'], weight: 0.6 },
    dead: { x: 8, y: 10, palette: [INK], rows: ['0.0..0.0', '.0....0.', '0.0..0.0'], weight: 0.6 },
    bigshades: {
      x: 5,
      y: 9,
      palette: ['#15161a', '#ffffff'],
      rows: ['00000000000000', '01010101010101', '10101010101010', '00000000000000'],
      weight: 0.9
    },
    tintshades: {
      x: 6,
      y: 10,
      palette: ['#15161a', '#9b6bff'],
      rows: ['000000000000', '011111111110', '000000000000'],
      weight: 0.6
    },
    prism: {
      x: 5,
      y: 10,
      palette: ['#ff3b54', '#ffd23a', '#3fd070', '#3f9bff', '#9b6bff'],
      rows: ['01234012340123', '01234012340123'],
      weight: 0.3
    },
    blaze: { x: 8, y: 10, palette: ['#ff2020', '#ffd23a'], rows: ['00....00', '01....01', '00....00'], weight: 0.3 },
    rainbowshades: {
      x: 5,
      y: 10,
      palette: ['#15161a', '#ff3b54', '#ff9a2b', '#ffd23a', '#3fd070', '#3f9bff', '#9b6bff'],
      rows: ['00000000000000', '12345612345612', '00000000000000'],
      weight: 0.3
    }
  }
}

const face: IRoboCategory = {
  name: 'face',
  traits: {
    none: { palette: [], rows: [], weight: 4 },
    cigarette: { x: 15, y: 18, palette: ['#f0f0f0', '#ff7a3c'], rows: ['0001'], weight: 0.6 },
    blush: { x: 5, y: 14, palette: ['#ff9bb0'], rows: ['00..........00'] },
    freckles: { x: 5, y: 13, palette: ['#a06a3c'], rows: ['0.0........0.0'] },
    tear: { x: 9, y: 13, palette: ['#5ac8ff'], rows: ['0', '0'], weight: 0.6 },
    mustache: { x: 9, y: 15, palette: [INK], rows: ['000000'] },
    scar: { x: 7, y: 9, palette: ['#c23b4a'], rows: ['0..', '.0.', '..0'], weight: 0.7 },
    mask: {
      x: 6,
      y: 14,
      palette: ['#bfe3ff', '#8fc4ea'],
      rows: ['000000000000', '000000000000', '111111111111'],
      weight: 0.5
    },
    gem: { x: 11, y: 8, palette: ['#3fd0e0', '#aef7ff'], rows: ['.0.', '010', '.0.'], weight: 0.3 }
  }
}

const headwear: IRoboCategory = {
  name: 'headwear',
  traits: {
    none: { palette: [], rows: [], weight: 2.5 },
    horns: { x: 4, y: 1, palette: ['#e0263f'], rows: ['..0..........0..', '.00..........00.', '000..........000'] },
    halo: { x: 6, y: 1, palette: ['#ffd54a'], rows: ['.0000000000.', '0..........0'], weight: 0.4 },
    crown: { x: 5, y: 1, palette: ['#ffd23a'], rows: ['0.0.0.0.0.0.0.', '00000000000000'], weight: 0.4 },
    cap: { x: 4, y: 2, palette: ['#2b6cff'], rows: ['.00000000000000.', '0000000000000000'] },
    beanie: { x: 4, y: 2, palette: ['#e0263f', '#ffffff'], rows: ['.00000000000000.', '1111111111111111'] },
    tophat: { x: 7, y: 1, palette: ['#15161a', '#e0263f'], rows: ['..000000..', '..111111..', '0000000000'] },
    mohawk: { x: 9, y: 1, palette: ['#ff3b54'], rows: ['0.0.0.', '000000', '000000'] },
    bow: { x: 9, y: 2, palette: ['#ff6bb0'], rows: ['00..00', '.0000.', '00..00'] },
    antenna: { x: 11, y: 1, palette: ['#ffd23a', '#15161a'], rows: ['0', '1', '1'], weight: 0.4 },
    durag: { x: 4, y: 3, palette: ['#3a3f5a'], rows: ['0000000000000000', '0..............0'] },
    party: { x: 8, y: 0, palette: ['#ff5a7a'], rows: ['...0...', '..000..', '.00000.', '0000000'], weight: 0.4 },
    cowboy: { x: 4, y: 2, palette: ['#a06a3c'], rows: ['....000000....', '0000000000000000'], weight: 0.5 },
    headphones: {
      x: 3,
      y: 8,
      palette: ['#15161a'],
      rows: ['00..............00', '00..............00', '00..............00'],
      weight: 0.5
    },
    flower: { x: 6, y: 2, palette: ['#ff6bb0', '#ffd23a'], rows: ['.0.', '010', '.0.'], weight: 0.5 },
    sprout: { x: 11, y: 1, palette: ['#4aa84a'], rows: ['0.0', '000', '.0.'], weight: 0.5 },
    grad: {
      x: 3,
      y: 2,
      palette: ['#15161a', '#ffd23a'],
      rows: ['000000000000000000', '.....00000000...1.'],
      weight: 0.5
    },
    santa: {
      x: 5,
      y: 0,
      palette: ['#e0263f', '#ffffff'],
      rows: ['....0000....', '..00000000..', '000000000000', '111111111111'],
      weight: 0.4
    },
    headband: {
      x: 4,
      y: 3,
      palette: ['#5ac8ff', '#2b6cff'],
      rows: ['0000000000000000', '1111111111111111'],
      weight: 0.7
    },
    flames: {
      x: 4,
      y: 1,
      palette: ['#e0301a', '#ff8a2b', '#ffd23a'],
      rows: ['..2...2...2...2.', '.11..11..11..11.', '0000000000000000'],
      weight: 0.3
    },
    kingcrown: {
      x: 4,
      y: 0,
      palette: ['#ffd23a', '#e0263f'],
      rows: ['0..0..0..0..0..0', '0010010010010010'],
      weight: 0.3
    },
    wizard: {
      x: 7,
      y: 0,
      palette: ['#5a3c9c', '#ffd23a'],
      rows: ['...00...', '..0000..', '.001100.', '00000000'],
      weight: 0.3
    }
  }
}

export const ROBO_LAYERS: IRoboCategory[] = [background, head, neck, mouth, eyes, face, headwear]
