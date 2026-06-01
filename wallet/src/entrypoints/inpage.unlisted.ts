import { PUPPET_EXTENSION_RDNS } from '@puppet/sdk/wallet'
import type { EIP1193Provider, EIP6963AnnounceProviderEvent, EIP6963ProviderInfo } from '../types.js'

const PROVIDER_INFO: EIP6963ProviderInfo = {
  uuid: 'f0c6e830-9a7d-4b9e-8c3f-1a2b3c4d5e6f',
  name: 'Puppet Wallet Extension',
  icon: 'data:image/svg+xml,%3Csvg width="100" height="100" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="100" height="100" rx="50" fill="%23B02A42"/%3E%3Cpath fill-rule="evenodd" clip-rule="evenodd" d="M55.597 51.029c0-.766.677-1.355 1.434-1.248l13.11 1.858c.456.064.912-.127 1.187-.498l10-13.541c.413-.56.294-1.35-.266-1.764l-1.141-.842a1.261 1.261 0 01-.222-1.819l1.527-1.843c.462-.558.36-1.39-.222-1.82l-1.142-.841a1.257 1.257 0 00-1.76.269l-1.523 2.08c-.411.56-1.2.681-1.76.268l-1.205-.888a1.257 1.257 0 00-1.756.264l-5.69 7.69a1.257 1.257 0 01-1.204.495l-8.105-1.268a1.259 1.259 0 01-1.029-.949l-4.875-20.205a1.258 1.258 0 00-1.574-.913l-.896.26a1.26 1.26 0 00-.867 1.527l1.434 5.534a1.26 1.26 0 01-.871 1.528l-2.119.608a1.258 1.258 0 01-1.561-.884l-1.5-5.58a1.258 1.258 0 00-1.52-.895l-1.01.254a1.26 1.26 0 00-.91 1.544l4.087 15.513a.84.84 0 01-.931 1.045l-12.855-1.874a1.257 1.257 0 00-1.192.498L18.672 48.13c-.413.56-.294 1.35.266 1.764l1.203.888c.559.412.679 1.199.268 1.76l-1.528 2.086c-.41.56-.29 1.348.268 1.76l1.142.842c.584.43 1.409.28 1.802-.33l1.356-2.097a1.257 1.257 0 011.79-.34l.938.675c.557.4 1.331.28 1.741-.27l5.922-7.943a1.257 1.257 0 011.18-.494l7.65 1.05a1.26 1.26 0 011.087 1.247v4.606c0 .484-.277.925-.712 1.135l-14.292 6.893a1.26 1.26 0 00-.712 1.135V77.77c0 .696.563 1.26 1.258 1.26h1.36c.694 0 1.257.565 1.257 1.26v2.894c0 .696.563 1.26 1.258 1.26h1.36c.694 0 1.257-.564 1.257-1.26v-2.677c0-.696.563-1.26 1.258-1.26h1.36c.694 0 1.257-.564 1.257-1.26v-7.91c0-.484.278-.925.714-1.135l8.645-4.16a1.256 1.256 0 011.089 0l8.645 4.16c.436.21.713.651.713 1.136v7.91c0 .695.563 1.259 1.258 1.259h1.36c.694 0 1.257.564 1.257 1.26v2.677c0 .696.563 1.26 1.258 1.26h1.36c.694 0 1.257-.564 1.257-1.26v-2.677c0-.696.564-1.26 1.258-1.26h1.575c.695 0 1.258-.564 1.258-1.26V62.704a1.26 1.26 0 00-.7-1.129l-14.316-7.102a1.26 1.26 0 01-.7-1.129v-2.315zm0-8.431c0-.771.685-1.361 1.447-1.246l9.214 1.4c.461.07.922-.122 1.2-.497l5.068-6.857a1.257 1.257 0 011.726-.287l1.116.771.898.616c.587.402.724 1.213.302 1.787l-6.748 9.172c-.274.373-.73.565-1.188.5l-11.953-1.69a1.26 1.26 0 01-1.082-1.248v-2.421zm-22.067.386a1.257 1.257 0 00-1.206.495l-5.049 6.829a1.257 1.257 0 01-1.75.27l-1.84-1.337a1.261 1.261 0 01-.274-1.768l6.765-9.196a1.257 1.257 0 011.197-.498l11.31 1.678a1.26 1.26 0 011.074 1.246v3.034a.734.734 0 01-.848.727l-9.379-1.48zM67.575 63.53c.442.208.724.652.724 1.141v9.85c0 .696-.563 1.26-1.258 1.26h-2.436a1.259 1.259 0 01-1.258-1.26V67.92a1.26 1.26 0 00-.722-1.14l-12.502-5.895a1.256 1.256 0 00-1.1.014L37.346 66.77a1.26 1.26 0 00-.694 1.126v6.625c0 .696-.563 1.26-1.258 1.26h-2.65a1.259 1.259 0 01-1.258-1.26V64.88c0-.484.276-.926.712-1.136l14.3-6.896a1.26 1.26 0 00.712-1.122l.195-18.1c.008-.691-.08-1.38-.259-2.047l-1.557-5.796a1.26 1.26 0 01.883-1.543l2.253-.618c.694-.19 1.405.24 1.56.943l1.69 7.646c.118.536.178 1.084.178 1.633v17.647c0 .488.282.933.724 1.14l14.698 6.9z" fill="%2300D1FF"/%3E%3C/svg%3E',
  rdns: PUPPET_EXTENSION_RDNS
}

export default defineUnlistedScript(() => {
  let requestId = 0
  let connectedAddress: string | null = null
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  // Emit event to registered listeners
  const emit = (event: string, ...args: unknown[]) => {
    listeners.get(event)?.forEach(fn => {
      fn(...args)
    })
  }

  // Handle RPC responses and background events
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.target !== 'puppet-inpage') return

    const { id, response, payload } = event.data

    // RPC response
    if (id !== undefined && pending.has(id)) {
      const { resolve, reject } = pending.get(id)!
      pending.delete(id)
      response?.error ? reject(new Error(response.error.message)) : resolve(response?.result)
    }

    // Background event (e.g., SET_ACTIVE_WALLET account switch)
    if (payload?.type === 'event') {
      const { event: eventName, args } = payload
      if (eventName === 'accountsChanged') {
        const accounts = args[0] as string[]
        if (accounts[0] === connectedAddress) return // Dedupe
        connectedAddress = accounts[0] ?? null
      }
      emit(eventName, ...args)
    }
  })

  const provider: EIP1193Provider = {
    isConnected: () => connectedAddress !== null,
    get selectedAddress() {
      return connectedAddress
    },
    request({ method, params }) {
      return new Promise((resolve, reject) => {
        const id = requestId++
        pending.set(id, {
          resolve: (result: unknown) => {
            // Handle connection state and events for account methods
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
              const accounts = result as string[]
              const newAddress = accounts[0] ?? null
              if (newAddress !== connectedAddress) {
                const wasConnected = connectedAddress !== null
                connectedAddress = newAddress
                if (newAddress) {
                  if (!wasConnected) emit('connect', { chainId: '0xa4b1' })
                  emit('accountsChanged', accounts)
                }
              }
            }
            resolve(result)
          },
          reject
        })
        window.postMessage({ target: 'puppet-content', id, payload: { method, params } }, '*')
      })
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener)
    }
  }

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: PROVIDER_INFO, provider })
      }) as EIP6963AnnounceProviderEvent
    )
  }

  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})
