import {
  type IConnectionsResponse,
  type IHandoffSessionRequest,
  type IHandoffSessionResponse,
  type IRejectConnectRequest,
  WALLET_MESSAGE,
  WALLET_PROTOCOL_VERSION
} from '@puppet/sdk/wallet'
import type { Address } from 'viem'
import { getAddress, isHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { notifyOriginAccounts } from './broadcast.js'
import { deriveSession, getState, type IWalletState, rejectApprovals, releaseApprovals, setState } from './state.js'

// The fund is exposed only while at least one dApp origin holds a grant.
function exposedFund(state: IWalletState): Address | null {
  return state.authorizedOrigins.length > 0 ? (deriveSession(state)?.fund ?? null) : null
}

export async function handleWebsiteMessage(
  message: { type: string; payload?: unknown },
  siteOrigin: string
): Promise<unknown> {
  const state = await getState()

  switch (message.type) {
    case WALLET_MESSAGE.GET_CONNECTIONS: {
      const response: IConnectionsResponse = {
        version: WALLET_PROTOCOL_VERSION,
        fund: exposedFund(state),
        origins: state.authorizedOrigins
      }
      return response
    }

    case WALLET_MESSAGE.HANDOFF_SESSION: {
      const payload = message.payload as IHandoffSessionRequest
      if (!isHex(payload.signerKey) || payload.signerKey.length !== 66) {
        throw new Error('signerKey must be a 32-byte hex string')
      }
      const user = getAddress(payload.user)
      const signer = privateKeyToAccount(payload.signerKey).address
      // A different user/signer revokes every prior grant; otherwise keep them and ADD the
      // newly approved origin (the fund can be connected to several dApps at once).
      const sameAccount = user === state.user && signer === state.signer
      const kept = sameAccount ? state.authorizedOrigins : []
      const authorizedOrigins =
        payload.approveOrigin && !kept.includes(payload.approveOrigin) ? [...kept, payload.approveOrigin] : kept

      const next = await setState({ user, signer, signerKey: payload.signerKey, authorizedOrigins })
      const session = deriveSession(next)

      // Resolve the pending connection synchronously, then broadcast WITHOUT awaiting so the
      // site's request returns immediately (tab broadcasts must not delay the response).
      if (payload.approveOrigin && session) {
        releaseApprovals(payload.approveOrigin, session.fund)
        void notifyOriginAccounts(payload.approveOrigin, [session.fund])
        void notifyOriginAccounts(siteOrigin, [session.fund])
      }
      const response: IHandoffSessionResponse = { fund: exposedFund(next) }
      return response
    }

    case WALLET_MESSAGE.REJECT_CONNECT: {
      const { origin } = (message.payload ?? {}) as IRejectConnectRequest
      if (origin) rejectApprovals(origin)
      return null
    }

    case WALLET_MESSAGE.CLEAR_ALL: {
      const revoked = state.authorizedOrigins
      const wasExposed = exposedFund(state) !== null
      await setState({ user: null, signer: null, signerKey: null, authorizedOrigins: [] })
      for (const origin of revoked) await notifyOriginAccounts(origin, [])
      if (wasExposed) await notifyOriginAccounts(siteOrigin, [])
      return null
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`)
  }
}
