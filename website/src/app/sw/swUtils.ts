import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'

declare global {
  interface Window {
    __pwaUpdate?: { available: boolean; apply: () => void }
  }
}

export const pwaUpgradeNotification: IStream<() => void> = fromCallback<() => void, [() => void]>(cb => {
  const handler = (event: Event) => {
    cb((event as CustomEvent<{ apply: () => void }>).detail.apply)
  }

  window.addEventListener('pwa:update-available', handler)

  if (window.__pwaUpdate?.available) cb(window.__pwaUpdate.apply)

  return () => window.removeEventListener('pwa:update-available', handler)
})
