import { roboAvatarSvg } from '@puppet/sdk/ui-components'
import { $wrapNativeElement, style } from 'aelea/ui'
import { $row } from 'aelea/ui-components'
import type { Address } from 'viem/accounts'

const uriCache = new Map<string, string>()

const roboAvatarDataUri = (address: Address) => {
  const key = address.toLowerCase()
  const cached = uriCache.get(key)
  if (cached !== undefined) return cached

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(roboAvatarSvg(address))}`
  uriCache.set(key, uri)
  return uri
}

export const $roboAvatar = (address: Address, size?: number) => {
  const img = document.createElement('img')
  img.src = roboAvatarDataUri(address)
  img.setAttribute('width', '100%')
  img.setAttribute('height', '100%')
  img.setAttribute('role', 'img')
  img.alt = `${address.slice(0, 6)}..${address.slice(-4)}`
  img.style.display = 'block'
  const $img = $wrapNativeElement(img)()
  return size === undefined
    ? $img
    : $row(style({ width: `${size}px`, height: `${size}px`, borderRadius: '50%', overflow: 'hidden', flexShrink: '0' }))(
        $img
      )
}
