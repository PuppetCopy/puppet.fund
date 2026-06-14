import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'

interface IBeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

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
window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notify()
})

export const isAppInstalled = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

export const canInstallApp: IStream<boolean> = fromCallback(cb => {
  cb(deferredPrompt !== null)
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
})

export async function promptInstallApp(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  notify()
  return choice.outcome === 'accepted'
}
