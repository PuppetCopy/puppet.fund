import { type IWalletEventFrame, WALLET_EVENT } from '@puppet/sdk/wallet'

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// accountsChanged scoped to ONE origin's tabs (a single dApp, or the puppet site). Per-origin
// auth means a connect/disconnect must reach only that party, never every open dApp.
export async function notifyOriginAccounts(origin: string, accounts: string[]): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const frame: IWalletEventFrame = { type: 'event', event: WALLET_EVENT.ACCOUNTS_CHANGED, args: [accounts] }
  for (const tab of tabs) {
    if (!tab.id || !tab.url || originOf(tab.url) !== origin) continue
    chrome.tabs.sendMessage(tab.id, frame).catch(() => {})
  }
}

export async function requestSessionFromSite(puppetUrl: string): Promise<void> {
  const tabs = await chrome.tabs.query({ url: `${puppetUrl}/*` })
  const frame: IWalletEventFrame = { type: 'event', event: WALLET_EVENT.SESSION_REQUEST, args: [] }
  for (const tab of tabs) {
    if (!tab.id) continue
    chrome.tabs.sendMessage(tab.id, frame).catch(() => {})
  }
}
