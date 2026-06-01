import { $wrapNativeElement } from 'aelea/ui'
import Color from 'color'
// @ts-expect-error
import MersenneTwister from 'mersenne-twister'
import type { Address } from 'viem/accounts'

const DEFAULT_SHAPE_COUNT = 3
const DEFAULT_WOBBLE = 30
const DEFAULT_BASE_COLORS = [
  '#01888C', // teal
  '#FC7500', // bright orange
  '#034F5D', // dark teal
  '#F73F01', // orangered
  '#FC1960', // magenta
  '#C7144C', // raspberry
  '#F3C100', // goldenrod
  '#1598F2', // lightning blue
  '#2465E1', // sail blue
  '#F19E02' // gold
]

const SVG_NS = 'http://www.w3.org/2000/svg'

type JazzRect = {
  fill: string
  transform?: string
}

function buildJazziconShapeData(
  address: string,
  shapeCount = DEFAULT_SHAPE_COUNT,
  wobble = DEFAULT_WOBBLE,
  baseColors = DEFAULT_BASE_COLORS
): JazzRect[] {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid address')
  if (shapeCount + 1 > baseColors.length) throw new Error('Insufficient base colors')

  const seed = Number.parseInt(address.slice(2, 10), 16)
  const generator = new MersenneTwister(seed)

  const position = generator.random()
  const hueShift = 30 * position - wobble / 2
  const colors = baseColors.map(hex => Color(hex).rotate(hueShift).hex())

  function nextColor(): string {
    generator.random()
    const index = Math.floor(colors.length * generator.random())
    const [color] = colors.splice(index, 1)
    return color || '#FFFFFF'
  }

  function nextTransform(index: number): string {
    const firstRotation = generator.random()
    const boost = generator.random()
    const secondRotation = generator.random()
    const angle = 2 * Math.PI * firstRotation
    const velocity = (100 * (index + boost)) / shapeCount
    const x = Math.cos(angle) * velocity
    const y = Math.sin(angle) * velocity
    const r = firstRotation * 360 + secondRotation * 180
    return `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${r.toFixed(1)} 50 50)`
  }

  const shapes: JazzRect[] = []
  shapes.push({ fill: nextColor() })
  for (let i = 0; i < shapeCount; i++) {
    shapes.push({ transform: nextTransform(i), fill: nextColor() })
  }
  return shapes
}

export function createJazziconSvg(address: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')

  const shapes = buildJazziconShapeData(address)
  for (const shape of shapes) {
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', '100%')
    rect.setAttribute('height', '100%')
    rect.setAttribute('fill', shape.fill)
    if (shape.transform) rect.setAttribute('transform', shape.transform)
    svg.appendChild(rect)
  }

  return svg
}

export function $jazzicon(address: Address) {
  const svg = createJazziconSvg(address)
  return $wrapNativeElement(svg)()
}
