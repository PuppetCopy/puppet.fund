import { registerSW } from 'virtual:pwa-register'
import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'

// pwa-register's `updateSW(true)` reloads only after `controllerchange` fires
// post-skipWaiting — but our service-worker calls `clientsClaim()` at install,
// so the new SW often controls before pwa-register's listener attaches and
// the reload never happens. Fire SKIP_WAITING via `updateSW()` then reload
// the page ourselves; on next load the just-activated SW is picked up.
const apply = (updateSW: (reloadPage?: boolean) => Promise<void>) => (): void => {
  updateSW()
  window.location.reload()
}

export const pwaUpgradeNotification: IStream<() => void> = fromCallback(cb => {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      cb(apply(updateSW))
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration?.waiting) {
        cb(apply(updateSW))
      }
    }
  })

  return updateSW
})
