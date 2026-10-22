import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'
import { uiStorage } from '@/ui-storage'

interface IBeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export const APP_KEY = 'puppet/app'

export const displayMode = matchMedia('(display-mode: standalone), (display-mode: minimal-ui)')
export const installed = (): boolean => displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

let deferredPrompt: IBeforeInstallPromptEvent | null = null
const listeners = new Set<(installable: boolean) => void>()

const notify = (): void => {
  for (const listener of [...listeners]) listener(deferredPrompt !== null)
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  deferredPrompt = event as IBeforeInstallPromptEvent
  notify()
})
export function askPersistentStorage(): void {
  if (!('storage' in navigator)) return
  void navigator.storage
    .persisted()
    .then(async persisted => {
      if (!persisted) await navigator.storage.persist()
    })
    .catch(uiStorage.reportFailure)
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notify()
  askPersistentStorage()
})

export const canInstallApp: IStream<boolean> = fromCallback(cb => {
  cb(deferredPrompt !== null)
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
})

export async function promptInstallApp(): Promise<'accepted' | 'dismissed' | null> {
  const offer = deferredPrompt
  if (offer === null) return null
  deferredPrompt = null
  notify()
  await offer.prompt()
  const choice = await offer.userChoice
  if (choice.outcome === 'dismissed') localStorage.setItem(APP_KEY, 'browser')
  return choice.outcome
}
