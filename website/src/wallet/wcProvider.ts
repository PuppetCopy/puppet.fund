import { VIEM_CHAINS } from '@puppet/sdk/const'
import type { SignClient } from '@walletconnect/sign-client'
import { getSdkError } from '@walletconnect/utils'
import { type Address, getAddress, numberToHex } from 'viem'
import { type IProvider, type IWalletEntry, WALLET_CONNECT_ID } from './connect.js'
import { appClientMap } from './wallet.js'
import { isOutboundSession, onSessionWrite, WC_STORAGE_PREFIX, wcRecordsOf } from './wcStorage.js'

type ISignClient = Awaited<ReturnType<typeof SignClient.init>>
type ISession = ReturnType<ISignClient['session']['getAll']>[number]
type IRequest = { method: string; params?: unknown }
type ISignClientSource = { start: () => Promise<ISignClient>; running: () => ISignClient | null }

const WALLET_METHODS = [
  'eth_sendTransaction',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
  'wallet_getCapabilities',
  'wallet_addEthereumChain'
]

const PROMPTING_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4', 'wallet_sendCalls', 'wallet_showCallsStatus', 'wallet_addEthereumChain']

let provideSource: (given: ISignClientSource) => void = () => {
  throw new Error('the WalletConnect client was provided before the provider module finished loading')
}
const source = new Promise<ISignClientSource>(resolve => {
  provideSource = resolve
})

export const provideSignClient = (given: ISignClientSource): void => provideSource(given)

const latestOutbound = (list: readonly ISession[]): ISession | undefined =>
  list.filter(session => isOutboundSession(session) && session.expiry * 1000 > Date.now()).sort((a, b) => b.expiry - a.expiry)[0]

const accountsOf = (session: ISession): Address[] => [
  ...new Set((session.namespaces.eip155?.accounts ?? []).map(account => getAddress(account.split(':')[2]!)))
]

const seenOf = (session: ISession | undefined): string | null => (session === undefined ? null : `${session.topic}:${accountsOf(session).join()}`)

const chainsOf = (session: ISession): number[] => [...new Set((session.namespaces.eip155?.accounts ?? []).map(account => Number(account.split(':')[1])))]

let client: ISignClient | null = null
let topic: string | null = null
let chainId: number = VIEM_CHAINS[0].id
const listeners = new Map<string, Set<(payload: unknown) => void>>()
const settledElsewhere = new Set<(accounts: Address[]) => void>()

const emit = (event: string, payload: unknown): void => {
  const held = listeners.get(event)
  if (held !== undefined) for (const listener of held) listener(payload)
}

const linked = (): { client: ISignClient; session: ISession } => {
  if (client === null || topic === null) throw new Error('WalletConnect is not connected')
  const session = client.session.getAll().find(each => each.topic === topic)
  if (session === undefined) throw new Error('the WalletConnect session ended')
  return { client, session }
}

const listen = (signClient: ISignClient): void => {
  signClient.on('session_event', ({ topic: from, params }) => {
    if (from !== topic) return
    if (params.event.name === 'accountsChanged') {
      emit('accountsChanged', (params.event.data as string[]).map(account => getAddress(account.includes(':') ? account.split(':')[2]! : account)))
    }
    if (params.event.name === 'chainChanged') {
      chainId = Number(params.event.data)
      emit('chainChanged', numberToHex(chainId))
    }
  })
  signClient.on('session_update', ({ topic: from }) => {
    if (from === topic) emit('accountsChanged', accountsOf(linked().session))
  })
  const ended = ({ topic: from }: { topic: string }): void => {
    if (from !== topic) return
    topic = null
    emit('disconnect', null)
  }
  signClient.on('session_delete', ended)
  signClient.on('session_expire', ended)
}

const chainFor = (session: ISession): number => {
  const chains = chainsOf(session)
  const first = chains[0]
  if (first === undefined) throw new Error('the wallet approved no EVM chain')
  return chains.includes(chainId) ? chainId : chains.includes(VIEM_CHAINS[0].id) ? VIEM_CHAINS[0].id : first
}

const adopt = (signClient: ISignClient, session: ISession): Address[] => {
  if (client !== signClient) listen(signClient)
  client = signClient
  topic = session.topic
  chainId = chainFor(session)
  return accountsOf(session)
}

export const adoptOutbound = (signClient: ISignClient): void => {
  const existing = latestOutbound(signClient.session.getAll())
  if (existing !== undefined && chainsOf(existing).length > 0) adopt(signClient, existing)
}

export const releaseOutbound = (): void => {
  client = null
  topic = null
}

const restore = async (): Promise<Address[]> => {
  if (client !== null && topic !== null) return accountsOf(linked().session)
  const running = (await source).running()
  const existing = latestOutbound(running === null ? (wcRecordsOf('session') as ISession[]) : running.session.getAll())
  if (existing === undefined) return []
  if (running !== null) return adopt(running, existing)
  chainId = chainFor(existing)
  return accountsOf(existing)
}

const live = async (): Promise<{ client: ISignClient; session: ISession }> => {
  if (client === null || topic === null) {
    const signClient = await (await source).start()
    const existing = latestOutbound(signClient.session.getAll())
    if (existing === undefined) throw new Error('WalletConnect is not connected')
    adopt(signClient, existing)
  }
  return linked()
}

const pair = async (): Promise<Address[]> => {
  const restored = await restore()
  if (restored.length > 0) return restored
  const signClient = await (await source).start()
  const { uri, approval } = await signClient.connect({
    optionalNamespaces: {
      eip155: {
        chains: VIEM_CHAINS.map(chain => `eip155:${chain.id}`),
        methods: [...WALLET_METHODS, 'wallet_switchEthereumChain'],
        events: ['accountsChanged', 'chainChanged']
      }
    }
  })
  if (uri !== undefined) emit('display_uri', uri)
  let settle: (accounts: Address[]) => void = () => {}
  const elsewhere = new Promise<Address[]>(resolve => {
    settle = resolve
    settledElsewhere.add(resolve)
  })
  try {
    return await Promise.race([approval().then(session => adopt(signClient, session)), elsewhere])
  } finally {
    settledElsewhere.delete(settle)
  }
}

let storedSeen = seenOf(latestOutbound(wcRecordsOf('session') as ISession[]))

const followStored = (): void => {
  const existing = latestOutbound(wcRecordsOf('session') as ISession[])
  const seen = seenOf(existing)
  if (seen === storedSeen) return
  storedSeen = seen
  if (existing === undefined) {
    emit('disconnect', null)
    return
  }
  chainId = chainFor(existing)
  const accounts = accountsOf(existing)
  for (const resolve of [...settledElsewhere]) resolve(accounts)
  emit('accountsChanged', accounts)
}

onSessionWrite(followStored)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key.startsWith(WC_STORAGE_PREFIX) && event.key.endsWith('//session')) followStored()
  })
}

export const walletConnectProvider: IProvider & { disconnect(): Promise<void> } = {
  async request({ method, params }: IRequest): Promise<unknown> {
    if (method === 'eth_requestAccounts') return pair()
    if (method === 'eth_accounts') return restore()
    if (method === 'eth_chainId') return numberToHex(chainId)
    if (method === 'wallet_switchEthereumChain') {
      const wanted = Number((params as [{ chainId: string }])[0].chainId)
      if (!chainsOf((await live()).session).includes(wanted)) {
        throw Object.assign(new Error(`the connected wallet did not approve chain ${wanted}; reconnect it with that chain enabled`), { code: 4902 })
      }
      chainId = wanted
      emit('chainChanged', numberToHex(chainId))
      return null
    }
    if (WALLET_METHODS.includes(method)) {
      const { client: signClient, session } = await live()
      const answer = signClient.request({ topic: session.topic, chainId: `eip155:${chainId}`, request: { method, params } })
      const native = session.peer.metadata.redirect?.native
      if (PROMPTING_METHODS.includes(method) && native !== undefined && !native.startsWith('http') && matchMedia('(pointer: coarse)').matches) window.location.href = native
      return answer
    }
    const app = appClientMap[chainId as keyof typeof appClientMap]
    if (app === undefined) throw new Error(`no app RPC for chain ${chainId}`)
    return app.request({ method, params } as Parameters<typeof app.request>[0])
  },
  on(event, listener) {
    const held = listeners.get(event)
    if (held === undefined) listeners.set(event, new Set([listener]))
    else held.add(listener)
  },
  removeListener(event, listener) {
    listeners.get(event)?.delete(listener)
  },
  async disconnect() {
    if ((client === null || topic === null) && latestOutbound(wcRecordsOf('session') as ISession[]) === undefined) return
    const { client: signClient, session } = await live()
    topic = null
    await signClient.disconnect({ topic: session.topic, reason: getSdkError('USER_DISCONNECTED') })
    if (signClient.core.pairing.getPairings().some(pairing => pairing.topic === session.pairingTopic)) {
      await signClient.core.pairing.disconnect({ topic: session.pairingTopic })
    }
  }
}

export const walletConnectEntry: IWalletEntry = { id: WALLET_CONNECT_ID, name: 'WalletConnect', icon: null, provider: walletConnectProvider }
