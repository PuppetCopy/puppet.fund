import { $wrapNativeElement, style } from 'aelea/ui'
import { createJazziconSvg } from '../common/$avatar.js'

export function $jazzicon(address: string, size = '24px') {
  const svg = createJazziconSvg(address)
  svg.setAttribute('width', size)
  svg.setAttribute('height', size)

  const wrapper = document.createElement('div')
  wrapper.appendChild(svg)
  wrapper.style.borderRadius = '50%'
  wrapper.style.overflow = 'hidden'

  return $wrapNativeElement(wrapper)(
    style({ width: size, minWidth: size, height: size, display: 'flex', position: 'relative' })
  )()
}
