import { createCompact, type ICompact, type IMatchmakerStatus } from '@puppet/sdk/compact'
import type { IStream } from 'aelea/stream'
import { fromCallback } from 'aelea/stream-extended'

const baseUrl = import.meta.env.VITE_MATCHMAKER_URL ?? '/api/matchmaker'
export const wsUrl = (import.meta.env.VITE_MATCHMAKER_WS_URL as string | undefined) ?? deriveWsUrl(baseUrl)

function deriveWsUrl(httpBase: string): string {
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}/ws`
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}/ws`
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${baseUrl}/ws`
}

export const compact: ICompact = createCompact({ matchmakerUrl: wsUrl })

// onStatus invokes immediately with the current status, so every subscriber gets
// replay-of-latest — the same semantics the old aelea state() stream provided.
export const matchmakerStatus: IStream<IMatchmakerStatus> = fromCallback<IMatchmakerStatus, [IMatchmakerStatus]>(cb =>
  compact.onStatus(cb)
)
