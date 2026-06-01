import { createCompact, type ICompact } from '@puppet/sdk/compact'
import { sqlClient } from '../indexer/sql.js'

const baseUrl = import.meta.env.VITE_MATCHMAKER_URL ?? '/api/matchmaker'
export const wsUrl = (import.meta.env.VITE_MATCHMAKER_WS_URL as string | undefined) ?? deriveWsUrl(baseUrl)

function deriveWsUrl(httpBase: string): string {
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}/ws`
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}/ws`
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${baseUrl}/ws`
}

export const compact: ICompact = createCompact({ matchmakerUrl: wsUrl, sql: sqlClient })
