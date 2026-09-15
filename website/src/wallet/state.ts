import { type GetConnectionReturnType, getConnection, getWalletClient } from '@wagmi/core'
import { filter, type IStream, map, merge, op, skipRepeats, skipRepeatsWith } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { subject } from '../utils/subject.js'
import type { IConnectedWallet } from './connectedWallet.js'
import { connection, wagmi, walletReconnected } from './wallet.js'

async function buildWallet(conn: GetConnectionReturnType): Promise<IConnectedWallet | null> {
  if (conn.status !== 'connected') {
    await walletReconnected
    conn = getConnection(wagmi)
  }
  if (conn.status !== 'connected' || !conn.connector || !conn.chainId) return null
  if (typeof conn.connector.getChainId !== 'function') return null

  const walletClient = await getWalletClient(wagmi, { chainId: conn.chainId })
  return {
    walletClient,
    address: walletClient.account.address
  }
}

const pushed = subject<Promise<IConnectedWallet | null>>()

const stableConnection = op(
  connection,
  filter(c => c.status === 'connected' || c.status === 'disconnected'),
  skipRepeatsWith((a, b) => {
    if (a.status !== b.status) return false
    if (a.status !== 'connected' || b.status !== 'connected') return a.status === b.status
    return a.address === b.address && a.connector?.uid === b.connector?.uid
  })
)

export const walletQuery: IStream<Promise<IConnectedWallet | null>> = op(
  merge(map(buildWallet, stableConnection), pushed.stream),
  state()
)

export const walletChainId: IStream<number | null> = op(
  connection,
  map(c => (c.status === 'connected' ? (c.chainId ?? null) : null)),
  skipRepeats,
  state(null)
)

export function refreshWallet(): void {
  pushed.push(buildWallet(getConnection(wagmi)))
}
