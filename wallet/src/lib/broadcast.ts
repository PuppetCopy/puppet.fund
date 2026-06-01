import { WALLET_EVENT_ACCOUNTS_CHANGED } from '@puppet/sdk/wallet'

export async function broadcastAccountsChanged(active: string | null): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const payload = {
    type: 'event',
    event: WALLET_EVENT_ACCOUNTS_CHANGED,
    args: [active ? [active] : []]
  }
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue
    chrome.tabs.sendMessage(tab.id, payload).catch(() => {})
  }
}
