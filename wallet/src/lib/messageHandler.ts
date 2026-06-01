import { WALLET_MESSAGE } from '@puppet/sdk/wallet'
import { getAddress, type Hex, isHex } from 'viem'
import { broadcastAccountsChanged } from './broadcast.js'
import { notifyActiveSet, type StoredState } from './state.js'

export interface MessageHandlerDeps {
  state: StoredState
}

export async function handleWebsiteMessage(
  message: { type: string; payload?: unknown },
  deps: MessageHandlerDeps
): Promise<unknown> {
  const { state } = deps

  switch (message.type) {
    case WALLET_MESSAGE.GET_ACTIVE_WALLET:
      return state.activeSubaccount

    case WALLET_MESSAGE.SET_ACTIVE_WALLET: {
      const payload = message.payload as { subaccountAddress: string | null; signerKey: string | null }
      const next = payload.subaccountAddress ? getAddress(payload.subaccountAddress) : null
      if (payload.signerKey !== null && (!isHex(payload.signerKey) || payload.signerKey.length !== 66)) {
        throw new Error('signerKey must be a 32-byte hex string')
      }
      const nextKey = (payload.signerKey as Hex | null) ?? null
      if (next === state.activeSubaccount && nextKey === state.signerKey) {
        return { activeSubaccount: state.activeSubaccount }
      }
      state.activeSubaccount = next
      state.signerKey = nextKey
      if (next) notifyActiveSet(next)
      await broadcastAccountsChanged(next)
      return { activeSubaccount: state.activeSubaccount }
    }

    case WALLET_MESSAGE.CLEAR_ALL: {
      const prevAddress = state.activeSubaccount
      state.activeSubaccount = null
      state.signerKey = null
      if (prevAddress !== null) await broadcastAccountsChanged(null)
      return null
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`)
  }
}
