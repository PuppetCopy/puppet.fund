import { handleWebsiteMessage } from '../lib/messageHandler.js'
import { handleRpcRequest, type RpcDeps } from '../lib/rpcHandler.js'

const PUPPET_URL = import.meta.env.VITE_PUPPET_URL
const MATCHMAKER_WS_URL = import.meta.env.VITE_MATCHMAKER_WS_URL
if (!PUPPET_URL) throw new Error('VITE_PUPPET_URL was not defined at build time (wxt.config define)')
if (!MATCHMAKER_WS_URL) throw new Error('VITE_MATCHMAKER_WS_URL was not defined at build time (wxt.config define)')

const DEPS: RpcDeps = {
  puppetUrl: PUPPET_URL,
  operate: {
    matchmakerUrl: MATCHMAKER_WS_URL,
    puppetUrl: PUPPET_URL
  }
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: `${DEPS.puppetUrl}/portfolio` })
  })

  const siteOrigin = new URL(PUPPET_URL).origin

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type) {
      handleWebsiteMessage(message, siteOrigin)
        .then(result => sendResponse({ success: true, result }))
        .catch(error => {
          console.error('[Puppet] Error:', error.message)
          sendResponse({ success: false, error: error.message })
        })
      return true
    }

    if (message.method) {
      // The requesting dApp's origin + tab (the content script forwarding the call runs in
      // its page) — the tab id lets us return focus there after the user approves.
      const requesterOrigin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '')
      handleRpcRequest(message, DEPS, requesterOrigin, sender.tab?.id)
        .then(result => sendResponse({ result }))
        .catch(error => {
          console.error('[Puppet] RPC Error:', error.message)
          sendResponse({ error: { message: error.message } })
        })
      return true
    }

    sendResponse({ error: { message: `Unsupported message: ${JSON.stringify(message)}` } })
    return false
  })
})
