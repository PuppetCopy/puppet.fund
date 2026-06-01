import { handleWebsiteMessage } from '../lib/messageHandler.js'
import { handleRpcRequest } from '../lib/rpcHandler.js'
import { DEFAULT_STATE, type StoredState } from '../lib/state.js'

const PUPPET_URL = import.meta.env.VITE_PUPPET_URL ?? 'http://localhost:3000'

export default defineBackground(() => {
  const state: StoredState = { ...DEFAULT_STATE }

  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: `${PUPPET_URL}/portfolio` })
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type) {
      handleWebsiteMessage(message, { state })
        .then(result => sendResponse({ success: true, result }))
        .catch(error => {
          console.error('[Puppet] Error:', error.message)
          sendResponse({ success: false, error: error.message })
        })
      return true
    }

    if (message.method) {
      handleRpcRequest(message, { state, puppetUrl: PUPPET_URL })
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
