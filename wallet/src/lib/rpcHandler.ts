import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { getAddress, type Hex, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { broadcastAccountsChanged } from './broadcast.js'
import { type StoredState, waitForActive } from './state.js'

const HUB_CHAIN_ID_HEX = numberToHex(HUB_CHAIN_ID)

export interface RpcDeps {
  state: StoredState
  puppetUrl: string
}

export async function handleRpcRequest(
  message: { method: string; params?: unknown[] },
  deps: RpcDeps
): Promise<unknown> {
  const { state, puppetUrl } = deps
  const { method, params } = message
  const active = state.activeSubaccount

  switch (method) {
    case 'eth_chainId':
      return HUB_CHAIN_ID_HEX

    case 'eth_accounts':
      return active ? [active] : []

    case 'eth_requestAccounts': {
      if (active) return [active]
      chrome.tabs.create({ url: `${puppetUrl}/portfolio` })
      return [await waitForActive(state)]
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
      if (state.activeSubaccount !== null) {
        state.activeSubaccount = null
        state.signerKey = null
        await broadcastAccountsChanged(null)
      }
      return null
    }

    case 'puppet_setActiveSubaccount': {
      const p = (params?.[0] ?? {}) as { address?: string }
      if (!p.address) throw new Error('puppet_setActiveSubaccount requires { address }')
      const next = getAddress(p.address)
      if (active === next) return next
      state.activeSubaccount = next
      await broadcastAccountsChanged(next)
      return next
    }

    case 'personal_sign': {
      const [rawMessage, rawAddress] = (params ?? []) as [string, string]
      const signer = requireSigner(state, rawAddress)
      const message = parsePersonalMessage(rawMessage)
      return signer.signMessage({ message })
    }

    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      const [rawAddress, rawTypedData] = (params ?? []) as [string, string | object]
      const signer = requireSigner(state, rawAddress)
      const typedData = parseTypedData(rawTypedData)
      return signer.signTypedData(typedData)
    }

    default:
      throw new Error(`Unsupported method: ${method}`)
  }
}

function requireSigner(state: StoredState, requestedAddress: string) {
  if (!state.signerKey) throw new Error('No signer key registered with Puppet Wallet Extension')
  if (!state.activeSubaccount) throw new Error('No active Puppet account')
  if (getAddress(requestedAddress) !== state.activeSubaccount) {
    throw new Error(`Sign request for ${requestedAddress} but active account is ${state.activeSubaccount}`)
  }
  return privateKeyToAccount(state.signerKey)
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
