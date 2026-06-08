import { monkey, renderAvatarSvg } from '@puppet/sdk/ui-components'
import { $wrapNativeElement } from 'aelea/ui'
import type { Address } from 'viem/accounts'

// Multi-layer "character" avatar (the new generative kind). Currently renders the `monkey` reference
// kind via the generic avatar engine; swap the kind here (or parameterize) as more kinds land.
const uriCache = new Map<string, string>()

const characterAvatarDataUri = (address: Address) => {
  const key = address.toLowerCase()
  const cached = uriCache.get(key)
  if (cached !== undefined) return cached

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(renderAvatarSvg(monkey, address))}`
  uriCache.set(key, uri)
  return uri
}

export const $characterAvatar = (address: Address) => {
  const img = document.createElement('img')
  img.src = characterAvatarDataUri(address)
  img.setAttribute('width', '100%')
  img.setAttribute('height', '100%')
  img.setAttribute('role', 'img')
  img.alt = `${address.slice(0, 6)}..${address.slice(-4)}`
  img.style.display = 'block'
  return $wrapNativeElement(img)()
}
