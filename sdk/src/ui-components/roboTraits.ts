import { INK } from './avatarEngine.js'

export type IRoboArt = { x?: number; y?: number; palette: string[]; rows: string[]; weight?: number }
export type IGradientArt = { gradient: [string, string]; weight?: number }
export type ITraitArt = IRoboArt | IGradientArt

export type IRoboCategory = { name: string; traits: Record<string, ITraitArt> }

export { INK }

export const shade = (hex: string, factor: number): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * factor)))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const lighten = (hex: string, amount: number): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.max(0, Math.min(255, ((n >> s) & 255) + amount))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const skinBlock = (skin: string): IRoboArt => ({
  x: 4,
  y: 4,
  palette: [skin, lighten(skin, 28), shade(skin, 0.72)],
  rows: ['1111111111111111', ...Array.from({ length: 14 }, () => '0000000000000000'), '2222222222222222']
})

const background: IRoboCategory = {
  name: 'background',
  traits: {
    ember: { gradient: ['#ff9385', '#ee6a5c'] },
    gold: { gradient: ['#ffde8f', '#ffc06b'] },
    forest: { gradient: ['#8fd08f', '#63ab6b'] },
    teal: { gradient: ['#84dbe8', '#5cb8cc'] },
    azure: { gradient: ['#93b3ff', '#6d8ce6'] },
    violet: { gradient: ['#c4a0f2', '#a37fe0'] },
    midnight: { gradient: ['#7b86b0', '#5a6180'] }
  }
}

const skin: IRoboCategory = {
  name: 'skin',
  traits: {
    black: { ...skinBlock('#131418'), weight: 75 },
    zombie: { ...skinBlock('#5b934d'), weight: 9 },
    robot: { ...skinBlock('#405576'), weight: 6 },
    monkey: { ...skinBlock('#714a31'), weight: 3 },
    alien: { ...skinBlock('#3daf9d'), weight: 2.5 },
    skeleton: { ...skinBlock('#bfbbaf'), weight: 1.8 },
    vampire: { ...skinBlock('#c79ab0'), weight: 1.2 },
    gold: { ...skinBlock('#c8a236'), weight: 0.9 },
    ice: { ...skinBlock('#9dbfd1'), weight: 0.4 },
    demon: { ...skinBlock('#d14a31'), weight: 0.2 },
    invisible: {
      x: 4,
      y: 4,
      palette: ['#ffffff26'],
      rows: Array.from({ length: 16 }, () => '0000000000000000'),
      weight: 0.02
    }
  }
}

const neck: IRoboCategory = {
  name: 'neck',
  traits: {
    none: { palette: [], rows: [], weight: 3 },
    knit: {
      x: 4,
      y: 19,
      palette: ['#a8e6b8', '#3fd070', '#4aa84a'],
      rows: ['.00000000000000.', '1122112211221122', '.12211221122112.', '..221122112211..']
    },
    scarf: {
      x: 4,
      y: 18,
      palette: ['#5ac8ff', '#2b6cff', '#eef2f8'],
      rows: [
        '.............000',
        '0000110000110000',
        '1100111100111111',
        '..........011...',
        '.........011....',
        '.........22.....'
      ]
    },
    bowtie: {
      x: 6,
      y: 19,
      palette: ['#e0263f', '#ffd23a'],
      rows: ['00...11...00', '000001100000', '00...11...00'],
      weight: 0.6
    },
    popped: {
      x: 4,
      y: 18,
      palette: ['#ff6bb0', '#eef2f8'],
      rows: ['00............00', '000..........000', '0000000000000000', '.11111111111111.'],
      weight: 0.6
    },
    lei: {
      x: 5,
      y: 19,
      palette: ['#ff6bb0', '#ffd23a', '#eef2f8'],
      rows: ['00110011001100', '11001100110011', '.....0220.....', '......00......'],
      weight: 0.6
    },
    blanket: {
      x: 3,
      y: 18,
      palette: ['#9b6bff', '#6b46c9', '#eef2f8'],
      rows: [
        '0022.............',
        '00002221111111111',
        '.0000002221111111',
        '..00000000222111.',
        '...000000000022..',
        '.......0022......'
      ],
      weight: 0.6
    },
    ruff: {
      x: 5,
      y: 19,
      palette: ['#eef2f8', '#b8c0cc', '#8a93a3'],
      rows: ['00..11..00..11', '00110011001100', '..22..22..22..'],
      weight: 0.35
    },
    belt: {
      x: 4,
      y: 19,
      palette: ['#e0263f', '#ffd23a', '#eef2f8'],
      rows: ['0000111111110000', '0000112222110000', '....11111111....', '......1111......'],
      weight: 0.35
    },
    medallion: {
      x: 5,
      y: 19,
      palette: ['#ffd23a', '#e0263f'],
      rows: ['00..........00', '..00......00..', '...00000000...', '...00111100...', '....000000....'],
      weight: 0.35
    },
    reactor: {
      x: 7,
      y: 19,
      palette: ['#15161a', '#2b6cff', '#5ac8ff'],
      rows: ['.00000000.', '0012222100', '.01222210.', '..011110..'],
      weight: 0.35
    }
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

const gear: IRoboCategory = {
  name: 'gear',
  traits: {
    none: { palette: [], rows: [], weight: 4 },
    bolts: {
      x: 1,
      y: 11,
      palette: ['#b8c0cc', '#7d8595'],
      rows: ['000................000', '111................111']
    },
    gauges: {
      x: 1,
      y: 11,
      palette: ['#8a93a3', '#eef2f8', '#e0263f'],
      rows: ['.00................00.', '0120..............0210', '0110..............0110', '.00................00.'],
      weight: 0.6
    },
    panels: {
      x: 0,
      y: 11,
      palette: ['#2b6cff', '#5ac8ff', '#8a93a3'],
      rows: ['000..................000', '111..................111', '00022..............22000', '111..................111', '000..................000'],
      weight: 0.6
    },
    vines: {
      x: 0,
      y: 6,
      palette: ['#3fd070', '#4aa84a', '#ffd23a'],
      rows: [
        '..2..................2..',
        '..00................00..',
        '1100................0011',
        '..00................00..',
        '...00..............00...',
        '...00..............00...',
        '1100................0011',
        '..00................00..',
        '...00..............00...',
        '...00..............00...',
        '1100................0011',
        '...00..............00...'
      ],
      weight: 0.6
    },
    jets: {
      x: 0,
      y: 10,
      palette: ['#b8c0cc', '#7d8595', '#5ac8ff'],
      rows: [
        '000..................000',
        '00011..............11000',
        '000..................000',
        '000..................000',
        '111..................111',
        '222..................222',
        '.2....................2.'
      ],
      weight: 0.35
    },
    arrow: {
      x: 0,
      y: 6,
      palette: ['#e0263f', '#ffd23a', '#b8c0cc'],
      rows: ['000.................22..', '0001................2222', '000.................22..'],
      weight: 0.35
    }
  }
}

const headwear: IRoboCategory = {
  name: 'headwear',
  traits: {
    none: { palette: [], rows: [], weight: 100 },
    horns: { x: 4, y: 1, palette: ['#e0263f', '#ff6b5a'], rows: ['0..............0', '00............00', '.00..........00.'], weight: 8.9 },
    halo: {
      x: 4,
      y: 0,
      palette: ['#ffe14d', '#fff9c0'],
      rows: ['...0111111110...', '..0..........0..', '...0111111110...'],
      weight: 0.2
    },
    crown: {
      x: 4,
      y: 1,
      palette: ['#ffd23a', '#ff3b54', '#5ac8ff'],
      rows: ['.0.....0.....0..', '000...000...000.', '0000000000000000', '0001000220001000'],
      weight: 0.36
    },
    cap: { x: 3, y: 1, palette: ['#2b6cff', '#1b4fcf'], rows: ['.......00.......', '....00000000....', '...00000000.1111', '..0000000000....'], weight: 35 },
    beanie: { x: 4, y: 0, palette: ['#e0263f', '#ffffff'], rows: ['......11........', '...0000000000...', '..000000000000..', '0000000000000000', '1111111111111111'], weight: 19 },
    tophat: { x: 6, y: 0, palette: ['#2e3140', '#43485c', '#e0263f'], rows: ['..00000011..', '..00000011..', '..00000011..', '..22222222..', '000000000000'], weight: 0.76 },
    purpletophat: { x: 6, y: 0, palette: ['#7b4fd6', '#9b74e8', '#ffd23a'], rows: ['..00000011..', '..00000011..', '..00000011..', '..22222222..', '000000000000'], weight: 0.7 },
    mohawk: { x: 8, y: 0, palette: ['#ff8a2b', '#ff3b54'], rows: ['1..1..1.', '11.11.11', '11111111', '.000000.'], weight: 3.7 },
    bow: { x: 9, y: 2, palette: ['#ff6bb0'], rows: ['00..00', '.0000.', '00..00'], weight: 4.4 },
    antenna: { x: 10, y: 1, palette: ['#ffd23a', '#1b1d24'], rows: ['.00.', '0000', '.00.', '.11.'], weight: 6.8 },
    durag: { x: 4, y: 2, palette: ['#3a3f5a', '#23263a'], rows: ['.00000000000000.', '0000000000000000', '..............00', '...............0'], weight: 5.4 },
    party: { x: 7, y: 0, palette: ['#ff5a7a', '#ffd23a'], rows: ['...1...', '..000..', '.00100.', '0000000'], weight: 1.9 },
    cowboy: { x: 2, y: 0, palette: ['#c08850', '#8a5a30', '#46280f'], rows: ['.......000000.......', '......00000000......', '.....0000000000.....', '.....2222222222.....', '11111111111111111111', '.111111111111111111.'], weight: 2.1 },
    headphones: { x: 3, y: 8, palette: ['#15161a', '#5ac8ff'], rows: ['00..............00', '00..............00', '00..............00'], weight: 3.2 },
    flower: { x: 8, y: 1, palette: ['#ff6bb0', '#ffd23a'], rows: ['.0.0.', '00100', '.0.0.'], weight: 2.7 },
    sprout: { x: 11, y: 1, palette: ['#4aa84a'], rows: ['0.0', '000', '.0.'], weight: 2.4 },
    grad: { x: 3, y: 1, palette: ['#15161a', '#ffd23a'], rows: ['000000000000000000', '...0011110000..1..', '.....00000.....1..', '...............1..'], weight: 1.6 },
    santa: { x: 5, y: 0, palette: ['#e0263f', '#ffffff'], rows: ['.........11.', '....0000011.', '..00000000..', '000000000000', '111111111111'], weight: 0.94 },
    headband: { x: 4, y: 3, palette: ['#5ac8ff', '#2b6cff'], rows: ['0000000000000000', '1111111111111111'], weight: 13 },
    flames: {
      x: 4,
      y: 0,
      palette: ['#e0301a', '#ff8a2b', '#ffd23a'],
      rows: ['.2....2....2..2.', '.2..2.12.2.21.2.', '12.11211.121121.', '1111111111111111', '0000000000000000'],
      weight: 0.24
    },
    kingcrown: {
      x: 4,
      y: 0,
      palette: ['#ffd23a', '#ff3b54', '#5ac8ff', '#fff6c0'],
      rows: ['3......33......3', '0......00......0', '00..0..00..0..00', '0000000000000000', '0002000110002000'],
      weight: 0.18
    },
    wizard: {
      x: 3,
      y: 0,
      palette: ['#5a3c9c', '#7b5ac0', '#ffd23a'],
      rows: [
        '...........11.....',
        '..........110.....',
        '.........0000.....',
        '........00000.....',
        '......00022000....',
        '.....0000220000...',
        '..000000000000000.'
      ],
      weight: 0.27
    },
    propeller: { x: 4, y: 0, palette: ['#2b6cff', '#ffd23a', '#ff3b54'], rows: ['..1111....1111..', '.......22.......', '...0000000000...', '..000000000000..'], weight: 0.82 },
    catears: { x: 4, y: 1, palette: ['#3a3f5a', '#ff9bb0'], rows: ['00..........00', '011........110', '011........110'], weight: 1.7 },
    bunny: { x: 7, y: 1, palette: ['#f0f0f0', '#ff9bb0'], rows: ['00...00', '01...10', '01...10', '00...00'], weight: 1.3 },
    afro: { x: 3, y: 0, palette: ['#2a2a2e'], rows: ['...000000000...', '.0000000000000.', '000000000000000', '000000000000000'], weight: 1.4 },
    chef: { x: 4, y: 0, palette: ['#ffffff', '#e8e8e8'], rows: ['.00..00..00.', '000000000000', '.0000000000.', '.0000000000.', '011111111110'], weight: 1 },
    jester: {
      x: 3,
      y: 0,
      palette: ['#9b2bff', '#3fd070', '#e0263f', '#ffd23a'],
      rows: [
        '3.......33.......3',
        '00......11......22',
        '00......11......22',
        '.00.....11.....22.',
        '..000...11...222..',
        '...000111111222...'
      ],
      weight: 0.33
    },
    antlers: { x: 2, y: 0, palette: ['#9a6630', '#6f4520'], rows: ['0.0.0........0.0.0', '.0.0.0......0.0.0.', '..000........000..', '...0..........0...', '...0..........0...', '..11..........11..'], weight: 0.56 },
    viking: {
      x: 2,
      y: 0,
      palette: ['#f0ead8', '#c9bfa4', '#cdd4dd', '#8a93a3'],
      rows: ['00................00', '000..............000', '.00...22222222...00.', '.110.2222222222.011.', '..1.222222222222.1..', '....233223322332....'],
      weight: 0.3
    },
    pirate: {
      x: 3,
      y: 0,
      palette: ['#2e3038', '#ffffff', '#ffd23a'],
      rows: ['.....00000000.....', '...0000111110000..', '..00000101010000..', '.000000011100000..', '222222222222222222'],
      weight: 0.4
    },
    unicorn: {
      x: 4,
      y: 0,
      palette: ['#ffd23a', '#e8a81e', '#ff9bd0', '#9b6bff', '#5ac8ff'],
      rows: [
        '.......01.......',
        '.......10.......',
        '.......01.......',
        '.......10.......',
        '22....0110......',
        '32..............',
        '42..............',
        '4...............'
      ],
      weight: 0.22
    },
    arrow: {
      x: 1,
      y: 7,
      palette: ['#8a5a30', '#e0263f', '#cdd4dd'],
      rows: ['11.................2..', '1110..............0222', '11.................2..'],
      weight: 0.65
    },
    raincloud: {
      x: 3,
      y: 0,
      palette: ['#b8c0cc', '#8a93a3', '#5ac8ff', '#ffd23a'],
      rows: ['...000000000...', '..00000000000..', '.0000000000000.', '..2..33..2..2..', '......33.......', '.....33........'],
      weight: 0.6
    },
    cone: { x: 8, y: 0, palette: ['#ff7a1a', '#ffffff'], rows: ['..00..', '.0000.', '011110', '000000', '000000'], weight: 0.88 },
    mushroom: { x: 3, y: 0, palette: ['#e0263f', '#ffffff', '#f3e9d8'], rows: ['......000000......', '....0010010000....', '..001000000100100.', '.000100010000010.0', '000000000000000000', '.2222222222222222.'], weight: 0.52 },
    helmet: { x: 4, y: 0, palette: ['#bfe8ff', '#ffffff', '#8aa6c0'], rows: ['....00000000....', '..010000000000..', '.001000000000000', '0000000000000000', '0000000000000000', '2222222222222222'], weight: 0.48 },
    brain: { x: 4, y: 0, palette: ['#ff9bb0', '#e07a96'], rows: ['..010..010..0.', '.01101101101.0', '0110110110110.', '.000000000000.'], weight: 0.44 }
  }
}

export const ROBO_LAYERS: IRoboCategory[] = [background, skin, neck, mouth, eyes, gear, headwear]

export const ROLLED_CATEGORIES: ReadonlySet<string> = new Set(['skin', 'headwear'])

