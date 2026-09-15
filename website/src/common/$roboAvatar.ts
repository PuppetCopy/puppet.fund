import { renderRoboAvatar, roboTraitsFromAddress } from '@puppet/sdk/ui-components'
import { $wrapNativeElement, style } from 'aelea/ui'
import { $row } from 'aelea/ui-components'
import type { Address } from 'viem/accounts'

let avatarSeq = 0

export const $roboAvatar = (address: Address, size?: number, traits?: Record<string, string>) => {
  const chosen = traits ?? roboTraitsFromAddress(address)
  const svg = renderRoboAvatar(chosen, `r${++avatarSeq}`)
  const wrapper = document.createElement('div')
  wrapper.innerHTML = svg
  const el = wrapper.firstElementChild as SVGElement
  el.setAttribute('width', '100%')
  el.setAttribute('height', '100%')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', `${address.slice(0, 6)}..${address.slice(-4)}`)
  el.style.display = 'block'

  const $svg = $wrapNativeElement(el)()
  return size === undefined
    ? $svg
    : $row(
        style({ width: `${size}px`, height: `${size}px`, borderRadius: '50%', overflow: 'hidden', flexShrink: '0' })
      )($svg)
}
