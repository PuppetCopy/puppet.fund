import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { getAddress, type Hex, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { notifyOriginAccounts } from './broadcast.js'
import { type IDappTransaction, type IOperateConfig, sendOperateTransaction } from './operate.js'
import { deriveSession, ensureSignerKey, getState, type IWalletState, setState, waitForApproval } from './state.js'

const HUB_CHAIN_ID_HEX = numberToHex(HUB_CHAIN_ID)
const RPC_URL = HUB_CHAIN.rpcUrls.default.http[0]

export interface RpcDeps {
  puppetUrl: string
  operate: IOperateConfig
}

export async function handleRpcRequest(
  message: { method: string; params?: unknown[] },
  deps: RpcDeps,
  requesterOrigin: string,
  requesterTabId?: number
): Promise<unknown> {
  const { puppetUrl, operate } = deps
  const { method, params } = message
  const state = await getState()
  const session = deriveSession(state)
  const authorized = !!session && state.authorizedOrigins.includes(requesterOrigin)

  switch (method) {
    case 'eth_chainId':
      return HUB_CHAIN_ID_HEX

    case 'eth_accounts':
      return authorized && session ? [session.fund] : []

    case 'eth_requestAccounts': {
      if (authorized && session) return [session.fund]
      // Open the consent prompt in a new tab, carrying the dApp origin so the site can name it.
      const connectTab = await chrome.tabs.create({
        url: `${puppetUrl}/portfolio?connect-extension=1&origin=${encodeURIComponent(requesterOrigin)}`
      })
      try {
        return [await waitForApproval(requesterOrigin)]
      } finally {
        // Whether approved or rejected, return the user to the exact dApp tab and close the
        // consent tab — "go back to the dApp" without a manual tab switch.
        await returnToDapp(requesterTabId, connectTab.id)
      }
    }

    case 'wallet_switchEthereumChain': {
      const p = (params?.[0] ?? {}) as { chainId?: string }
      if (p.chainId !== HUB_CHAIN_ID_HEX) {
        throw new Error(`Puppet only supports chain ${HUB_CHAIN_ID_HEX}`)
      }
      return null
    }

    case 'wallet_revokePermissions':
    case 'wallet_disconnect': {
      if (state.authorizedOrigins.includes(requesterOrigin)) {
        const remaining = state.authorizedOrigins.filter(o => o !== requesterOrigin)
        await setState({ ...state, authorizedOrigins: remaining })
        await notifyOriginAccounts(requesterOrigin, [])
        // Reflect aggregate state on the puppet site (status row / banner).
        const siteOrigin = new URL(puppetUrl).origin
        await notifyOriginAccounts(siteOrigin, remaining.length > 0 && session ? [session.fund] : [])
      }
      return null
    }

    // The smart-account passthrough: the dApp's transaction becomes the callList of an
    // operate intent, co-signed by the matchmaker's attestor and executed by the fund.
    // The matchmaker's venue screen is the perimeter — the wallet adds no policy of its own.
    case 'eth_sendTransaction': {
      if (!authorized) throw new Error('Not connected to Puppet — request a connection first')
      const tx = (params?.[0] ?? {}) as IDappTransaction
      return sendOperateTransaction(tx, operate)
    }

    case 'personal_sign': {
      const [rawMessage, rawAddress] = (params ?? []) as [string, string]
      const signer = await requireSigner(state, rawAddress, authorized, puppetUrl)
      const message = parsePersonalMessage(rawMessage)
      return signer.signMessage({ message })
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      const [rawAddress, rawTypedData] = (params ?? []) as [string, string | object]
      const signer = await requireSigner(state, rawAddress, authorized, puppetUrl)
      const typedData = parseTypedData(rawTypedData)
      return signer.signTypedData(typedData)
    }

    default:
      return passthroughRpc(method, params)
  }
}

// Re-focus the dApp tab that initiated the connection (and its window), then close the
// consent tab. Best-effort: a recycled worker or a tab the user already closed is harmless.
async function returnToDapp(dappTabId: number | undefined, connectTabId: number | undefined): Promise<void> {
  if (dappTabId !== undefined) {
    const dappTab = await chrome.tabs.update(dappTabId, { active: true }).catch(() => null)
    if (dappTab?.windowId !== undefined)
      await chrome.windows.update(dappTab.windowId, { focused: true }).catch(() => {})
  }
  if (connectTabId !== undefined) await chrome.tabs.remove(connectTabId).catch(() => {})
}

async function passthroughRpc(method: string, params?: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] })
  })
  if (!response.ok) throw new Error(`RPC ${method} failed: HTTP ${response.status}`)
  const json = (await response.json()) as { result?: unknown; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function requireSigner(state: IWalletState, requestedAddress: string, authorized: boolean, puppetUrl: string) {
  const session = deriveSession(state)
  if (!session || !authorized) throw new Error('Not connected to Puppet — request a connection first')
  if (getAddress(requestedAddress) !== session.fund) {
    throw new Error(`Sign request for ${requestedAddress} but active account is ${session.fund}`)
  }
  return privateKeyToAccount(await ensureSignerKey(puppetUrl))
}

function parsePersonalMessage(raw: string): { raw: Hex } | string {
  if (typeof raw !== 'string') throw new Error('personal_sign expects a string message')
  return raw.startsWith('0x') ? { raw: raw as Hex } : raw
}

function parseTypedData(raw: string | object) {
  const typed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!typed || typeof typed !== 'object') throw new Error('eth_signTypedData expects a typed-data object')
  return typed
}
