import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { staticTokenRegistry } from '@puppet/sdk/state'
import { type IPassthroughDeps, type IPassthroughTransaction, sendOperatePassthrough } from '@puppet/sdk/venue'
import { SignClient } from '@walletconnect/sign-client'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { type Address, createPublicClient, http, numberToHex } from 'viem'
import { compact } from '../io/matchmaker/index.js'
import type { IConnectedWallet } from './connectedWallet.js'
import { setWalletLinkSessions, waitForLinkWallet } from './walletLinkState.js'
import { WALLETCONNECT_PROJECT_ID } from './wallet.js'

declare const __WC_METADATA__: { name: string; description: string; url: string; icons: string[] }

const tokenRegistry = staticTokenRegistry()
const publicClient = createPublicClient({ chain: HUB_CHAIN, transport: http(HUB_CHAIN.rpcUrls.default.http[0]) })

const SUPPORTED_METHODS = [
  'eth_sendTransaction',
  'eth_accounts',
  'eth_chainId',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain'
]

export function fundAddress(wallet: IConnectedWallet): Address {
  const session = wallet.session
  if (!session) throw new Error('No active session')
  return predictFundAccount(predictPuppetAccount({ user: session.user, signer: session.signer }))
}

function passthroughDeps(wallet: IConnectedWallet): IPassthroughDeps {
  if (!wallet.session) throw new Error('Enable a signing session before connecting a dApp')
  return { user: wallet.address, signer: wallet.session.account, compact, publicClient, tokenRegistry }
}

export async function handleDappRequest(wallet: IConnectedWallet, method: string, params: unknown): Promise<unknown> {
  if (method === 'eth_sendTransaction') {
    const tx = (params as IPassthroughTransaction[])[0]
    return sendOperatePassthrough(passthroughDeps(wallet), tx)
  }
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [fundAddress(wallet)]
  if (method === 'eth_chainId') return numberToHex(HUB_CHAIN.id)
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
  return (publicClient.request as (a: { method: string; params: unknown }) => Promise<unknown>)({ method, params })
}

type ISignClient = Awaited<ReturnType<typeof SignClient.init>>
type IProposalStruct = ReturnType<ISignClient['proposal']['getAll']>[number]
type IWcSlot = { client: ISignClient | null; initPromise: Promise<ISignClient> | null }

const WC_SLOT = Symbol.for('puppet.walletconnect.signclient')
const registry = globalThis as unknown as Record<symbol, IWcSlot | undefined>
const slot: IWcSlot = registry[WC_SLOT] ?? (registry[WC_SLOT] = { client: null, initPromise: null })

export async function startWalletConnect(): Promise<ISignClient> {
  if (slot.client) return slot.client
  if (slot.initPromise) return slot.initPromise
  slot.initPromise = (async () => {
    const client = await SignClient.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: { ...__WC_METADATA__, url: window.location.origin }
    })
    console.info('[wc] SignClient init done, restored sessions:', client.session.getAll().length)
    syncSessions(client)
    client.core.relayer.once('relayer_connect', () => console.info('[wc] relay connected'))
    registerHandlers(client)
    slot.client = client
    const pending = client.proposal.getAll().filter(p => p.expiryTimestamp * 1000 > Date.now())
    if (pending.length) {
      console.info('[wc] replaying pending proposals:', pending.length)
      for (const proposal of pending) void approveProposal(client, proposal)
    }
    return client
  })()
  return slot.initPromise
}

async function approveProposal(client: ISignClient, proposal: IProposalStruct): Promise<void> {
  try {
    const wallet = await waitForLinkWallet()
    if (!wallet?.session) {
      console.warn('[wc] rejecting proposal: no connected Puppet account with an enabled session')
      await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') })
      return
    }
    const namespaces = buildApprovedNamespaces({
      proposal,
      supportedNamespaces: {
        eip155: {
          chains: [`eip155:${HUB_CHAIN.id}`],
          methods: SUPPORTED_METHODS,
          events: ['accountsChanged', 'chainChanged'],
          accounts: [`eip155:${HUB_CHAIN.id}:${fundAddress(wallet)}`]
        }
      }
    })
    await client.approve({ id: proposal.id, namespaces })
    syncSessions(client)
    console.info('[wc] session approved as', fundAddress(wallet))
  } catch (e) {
    console.error('[wc] session_proposal failed', e)
    await client.reject({ id: proposal.id, reason: getSdkError('USER_REJECTED') }).catch(() => {})
  }
}

function registerHandlers(client: ISignClient): void {
  client.on('session_proposal', ({ params }) => {
    console.info('[wc] session_proposal', {
      required: params.requiredNamespaces,
      optional: params.optionalNamespaces
    })
    void approveProposal(client, params)
  })
  client.on('session_request', async ({ topic, id, params }) => {
    console.info('[wc] session_request', params.request.method)
    try {
      const wallet = await waitForLinkWallet()
      if (!wallet) throw new Error('No active Puppet account')
      const result = await handleDappRequest(wallet, params.request.method, params.request.params)
      await client.respond({ topic, response: { id, jsonrpc: '2.0', result } })
    } catch (e) {
      console.error('[wc] session_request failed', params.request.method, e)
      await client.respond({
        topic,
        response: { id, jsonrpc: '2.0', error: { code: 5000, message: (e as Error).message } }
      })
    }
  })
  client.on('session_delete', () => {
    console.info('[wc] session_delete')
    syncSessions(client)
  })
}

function syncSessions(client: ISignClient): void {
  setWalletLinkSessions(
    client.session.getAll().map(session => ({
      topic: session.topic,
      name: session.peer.metadata.name,
      url: session.peer.metadata.url,
      icon: session.peer.metadata.icons?.[0]
    }))
  )
}

export async function pairDapp(uri: string): Promise<void> {
  if (!slot.client) throw new Error('WalletConnect not initialized')
  console.info('[wc] pairing, awaiting proposal')
  await slot.client.pair({ uri })
}

export async function disconnectDapp(topic: string): Promise<void> {
  if (!slot.client) return
  try {
    await slot.client.disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
  } catch (e) {
    console.error('[wc] disconnect failed', e)
  }
  syncSessions(slot.client)
}
