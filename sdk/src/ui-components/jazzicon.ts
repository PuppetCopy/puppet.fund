import type { Address } from 'viem'

const SHAPE_COUNT = 3
const WOBBLE = 30
const BASE_COLORS = ['#01888C', '#FC7500', '#034F5D', '#F73F01', '#FC1960', '#C7144C', '#F3C100', '#1598F2', '#2465E1', '#F19E02']
const MT_SIZE = 624
const MT_SHIFT = 397

const mersenneTwister = (seed: number): (() => number) => {
  const state = new Uint32Array(MT_SIZE)
  state[0] = seed >>> 0
  for (let i = 1; i < MT_SIZE; i++) {
    const prev = state[i - 1]! ^ (state[i - 1]! >>> 30)
    state[i] = Math.imul(prev, 1812433253) + i
  }
  let index = MT_SIZE
  return () => {
    if (index === MT_SIZE) {
      for (let k = 0; k < MT_SIZE; k++) {
        const y = (state[k]! & 0x80000000) | (state[(k + 1) % MT_SIZE]! & 0x7fffffff)
        state[k] = state[(k + MT_SHIFT) % MT_SIZE]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)
      }
      index = 0
    }
    let y = state[index++]!
    y ^= y >>> 11
    y ^= (y << 7) & 0x9d2c5680
    y ^= (y << 15) & 0xefc60000
    y ^= y >>> 18
    return (y >>> 0) / 4294967296
  }
}

const rotateHue = (hex: string, degrees: number): string => {
  const [r, g, b] = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (min + max) / 2
  const saturation = (max === min ? 0 : l <= 0.5 ? delta / (max + min) : delta / (2 - max - min)) * 100
  const lightness = l * 100
  const sector = max === min ? 0 : max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta
  const hue = (((sector * 60 < 0 ? sector * 60 + 360 : sector * 60) % 360) + 360) % 360
  const turned = (hue + degrees) % 360
  const h = (turned < 0 ? 360 + turned : turned) / 360
  const sat = saturation / 100
  const light = lightness / 100
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  return `#${[1, 0, -1]
    .map(offset => {
      let t = h + (1 / 3) * offset
      if (t < 0) t++
      if (t > 1) t--
      const value = 6 * t < 1 ? p + (q - p) * 6 * t : 2 * t < 1 ? q : 3 * t < 2 ? p + (q - p) * (2 / 3 - t) * 6 : p
      return Math.round(value * 255).toString(16).padStart(2, '0')
    })
    .join('')
    .toUpperCase()}`
}

export const jazziconSvg = (address: Address): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`jazziconSvg needs an address, got ${address}`)
  const random = mersenneTwister(Number.parseInt(address.slice(2, 10), 16))
  const hueShift = 30 * random() - WOBBLE / 2
  const colors = BASE_COLORS.map(hex => rotateHue(hex, hueShift))
  const nextColor = (): string => {
    random()
    const [color] = colors.splice(Math.floor(colors.length * random()), 1)
    if (color === undefined) throw new Error(`the jazzicon of ${address} ran out of colors`)
    return color
  }
  const nextTransform = (index: number): string => {
    const firstRotation = random()
    const boost = random()
    const secondRotation = random()
    const angle = 2 * Math.PI * firstRotation
    const velocity = (100 * (index + boost)) / SHAPE_COUNT
    return `translate(${(Math.cos(angle) * velocity).toFixed(3)} ${(Math.sin(angle) * velocity).toFixed(3)}) rotate(${(firstRotation * 360 + secondRotation * 180).toFixed(1)} 50 50)`
  }
  const rect = (fill: string, transform: string | null): string =>
    `<rect x="0" y="0" width="100%" height="100%" fill="${fill}"${transform === null ? '' : ` transform="${transform}"`}/>`
  const rects = [rect(nextColor(), null)]
  for (let i = 0; i < SHAPE_COUNT; i++) {
    const transform = nextTransform(i)
    rects.push(rect(nextColor(), transform))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">${rects.join('')}</svg>`
}
