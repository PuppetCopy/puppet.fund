import { pixelAvatarSvg } from '@puppet/sdk/ui-components'
import { $wrapNativeElement } from 'aelea/ui'
import type { Address } from 'viem/accounts'

const uriCache = new Map<string, string>()

const pixelAvatarDataUri = (address: Address) => {
  const key = address.toLowerCase()
  const cached = uriCache.get(key)
  if (cached !== undefined) return cached

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(pixelAvatarSvg(address))}`
  uriCache.set(key, uri)
  return uri
}

export const $pixelAvatar = (address: Address) => {
  const img = document.createElement('img')
  img.src = pixelAvatarDataUri(address)
  img.setAttribute('width', '100%')
  img.setAttribute('height', '100%')
  img.setAttribute('role', 'img')
  img.alt = `${address.slice(0, 6)}..${address.slice(-4)}`
  img.style.display = 'block'
  return $wrapNativeElement(img)()
}
