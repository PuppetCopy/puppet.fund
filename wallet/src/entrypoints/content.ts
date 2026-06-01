import { WALLET_TARGET } from '@puppet/sdk/wallet'

const PUPPET_URL = import.meta.env.VITE_PUPPET_URL ?? 'http://localhost:3000'
const isPuppetSite = window.location.origin === PUPPET_URL

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,

  main() {
    if (!isPuppetSite) {
      const script = document.createElement('script')
      script.src = browser.runtime.getURL('/inpage.js')
      ;(document.head || document.documentElement).prepend(script)
      script.onload = () => script.remove()
    }

    window.addEventListener('message', async event => {
      if (event.source !== window) return
      if (event.data?.target !== WALLET_TARGET.CONTENT) return

      const { id, payload } = event.data

      const response = await browser.runtime
        .sendMessage(payload)
        .catch((e: Error) => ({ error: { message: e.message } }))

      window.postMessage({ target: WALLET_TARGET.INPAGE, id, response }, '*')
    })

    if (isPuppetSite) {
      window.addEventListener('message', async event => {
        if (event.source !== window) return
        if (event.data?.target !== WALLET_TARGET.EXTENSION) return

        const { id, type, payload } = event.data

        const response = await browser.runtime
          .sendMessage({ type, payload })
          .catch((e: Error) => ({ success: false, error: e.message }))

        window.postMessage({ target: WALLET_TARGET.WEBSITE, id, response }, '*')
      })
    }

    browser.runtime.onMessage.addListener(message => {
      if (message.type !== 'event') return
      const target = isPuppetSite ? WALLET_TARGET.WEBSITE_EVENT : WALLET_TARGET.INPAGE
      window.postMessage({ target, payload: message }, '*')
    })
  }
})
