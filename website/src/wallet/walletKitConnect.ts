import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { staticTokenRegistry } from '@puppet/sdk/state'
import { type IPassthroughDeps, type IPassthroughTransaction, sendOperatePassthrough } from '@puppet/sdk/venue'
import { SignClient } from '@walletconnect/sign-client'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'
import { type Address, createPublicClient, http, numberToHex } from 'viem'
import { compact } from '../io/matchmaker/index.js'
import type { IConnectedWallet } from './connectedWallet.js'
import { addWalletLink, getLinkWallet, removeWalletLink, setWalletLinkCount } from './walletLinkState.js'
import { WALLETCONNECT_PROJECT_ID } from './wallet.js'

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

let signClient: ISignClient | null = null
let initPromise: Promise<ISignClient> | null = null

// SignClient persists its pairings/sessions to localStorage via @walletconnect/core, so this
// rehydrates any prior session, reconnects the relay, and re-registers handlers. The active
// wallet is read live from walletLinkState so restored sessions work without an open popover.
export async function startWalletConnect(): Promise<ISignClient> {
  if (signClient) return signClient
  if (initPromise) return initPromise
  initPromise = (async () => {
    const client = await SignClient.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: {
        name: 'Puppet',
        description: 'Fund top on-chain traders and share their gains. You keep your keys and set the rules.',
        url: window.location.origin,
        icons: ['https://puppet.fund/favicon.svg']
      }
    })
    setWalletLinkCount(client.session.getAll().length)
    registerHandlers(client)
    signClient = client
    return client
  })()
  return initPromise
}

function registerHandlers(client: ISignClient): void {
  client.on('session_proposal', async ({ id, params }) => {
    console.info('[wc] session_proposal', {
      required: params.requiredNamespaces,
      optional: params.optionalNamespaces
    })
    try {
      const wallet = getLinkWallet()
      if (!wallet?.session) {
        console.warn('[wc] rejecting proposal: no connected Puppet account with an enabled session')
        await client.reject({ id, reason: getSdkError('USER_REJECTED') })
        return
      }
      const namespaces = buildApprovedNamespaces({
        proposal: params,
        supportedNamespaces: {
          eip155: {
            chains: [`eip155:${HUB_CHAIN.id}`],
            methods: SUPPORTED_METHODS,
            events: ['accountsChanged', 'chainChanged'],
            accounts: [`eip155:${HUB_CHAIN.id}:${fundAddress(wallet)}`]
          }
        }
      })
      await client.approve({ id, namespaces })
      addWalletLink()
      console.info('[wc] session approved as', fundAddress(wallet))
    } catch (e) {
      console.error('[wc] session_proposal failed', e)
      await client.reject({ id, reason: getSdkError('USER_REJECTED') }).catch(() => {})
    }
  })
  client.on('session_request', async ({ topic, id, params }) => {
    console.info('[wc] session_request', params.request.method)
    const wallet = getLinkWallet()
    try {
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
    removeWalletLink()
  })
}

export async function pairDapp(uri: string): Promise<void> {
  if (!signClient) throw new Error('WalletConnect not initialized')
  console.info('[wc] pairing, awaiting proposal')
  await signClient.pair({ uri })
}
