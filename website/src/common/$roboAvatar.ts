import { renderRoboAvatar, roboTraitsFromAddress } from '@puppet/sdk/ui-components'
import { $wrapNativeElement, style } from 'aelea/ui'
import { $row } from 'aelea/ui-components'
import type { Address } from 'viem/accounts'

// Inline SVGs share the document's id space, so the avatar's gradient ids (fill="url(#bg…)") must be unique per
// instance or one avatar's background binds to another's gradient (e.g. the trait picker, which renders many previews
// off a single constant seed). A per-render counter gives each rendered SVG its own ids; appearance is unaffected
// (idSuffix only names the defs — the look comes from the traits).
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
