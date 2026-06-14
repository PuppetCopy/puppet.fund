import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import { type IStream, just, map, skipRepeats, switchLatest } from 'aelea/stream'
import type { ChainId } from '../const/index.js'
import { periodicRun } from '../core/stream/recover.js'
import { type IIndexerClient, query } from './shared.js'

interface IChainMetadataRow {
  chain_id: number
  latest_processed_block: number
  block_height: number
}

export type LagSeverity = 'healthy' | 'lagging' | 'stale' | 'unreachable'

export interface IndexerLagThresholds {
  healthyMaxAgeSec: number
  laggingMaxAgeSec: number
}

export const DEFAULT_LAG_THRESHOLDS: IndexerLagThresholds = {
  healthyMaxAgeSec: 30,
  laggingMaxAgeSec: 300
}

const CHAIN_BLOCK_TIME_SEC: Record<number, number> = {
  42161: 0.25,
  8453: 2
}
const DEFAULT_BLOCK_TIME_SEC = 2

export interface IndexerChainHealth {
  block: { number: bigint; timestamp: number }
  // Blocks the indexed head trails the chain head. This IS the gap an intent anchored to the
  // indexed head must clear against the contract's maxBlockDelay window before it mines.
  behind: number
  ageSec: number
  severity: LagSeverity
}

export interface IndexerHealth {
  reachable: boolean
  chains: { [chainName: string]: IndexerChainHealth }
  worstAgeSec: number
  worstSeverity: LagSeverity
  fetchedAtSec: number
}

export function indexerBlock(health: IndexerHealth, network: string): bigint {
  const chain = health.chains[network]
  if (!chain) throw new Error(`indexer has no block data for chain ${network}`)
  return chain.block.number
}

export async function getChainMetadata(sql: IIndexerClient): Promise<IChainMetadataRow[]> {
  const data = await query<{ chain_metadata: IChainMetadataRow[] }>(
    sql,
    'query ChainMetadata { chain_metadata { chain_id latest_processed_block block_height } }'
  )
  return data.chain_metadata
}

export async function getIndexerBlock(sql: IIndexerClient, network: string): Promise<bigint> {
  const rows = await getChainMetadata(sql)
  const row = rows.find(r => CHAIN_NETWORK_MAP[r.chain_id as ChainId] === network)
  if (!row) throw new Error(`indexer has no block data for chain ${network}`)
  return BigInt(row.latest_processed_block)
}

// One-shot indexer health snapshot. Native callers (e.g. the matchmaker relay) poll this
// directly; createIndexerHealthSource wraps it for stream consumers.
export async function fetchIndexerHealth(sql: IIndexerClient): Promise<IndexerHealth> {
  const fetchedAtSec = Math.floor(Date.now() / 1000)
  const rows = await getChainMetadata(sql).catch(() => null)
  if (!rows || rows.length === 0) {
    return {
      reachable: false,
      chains: {},
      worstAgeSec: Number.POSITIVE_INFINITY,
      worstSeverity: 'unreachable',
      fetchedAtSec
    }
  }
  const chains: IndexerHealth['chains'] = {}
  let worstAgeSec = 0
  let worstSeverity: LagSeverity = 'healthy'
  for (const row of rows) {
    const network = CHAIN_NETWORK_MAP[row.chain_id as ChainId]
    if (!network) continue
    const behind = Math.max(0, row.block_height - row.latest_processed_block)
    const blockTimeSec = CHAIN_BLOCK_TIME_SEC[row.chain_id] ?? DEFAULT_BLOCK_TIME_SEC
    const ageSec = Math.round(behind * blockTimeSec)
    const freshSec = fetchedAtSec - ageSec
    const severity: LagSeverity =
      ageSec <= DEFAULT_LAG_THRESHOLDS.healthyMaxAgeSec
        ? 'healthy'
        : ageSec <= DEFAULT_LAG_THRESHOLDS.laggingMaxAgeSec
          ? 'lagging'
          : 'stale'
    chains[network] = {
      block: { number: BigInt(row.latest_processed_block), timestamp: freshSec },
      behind,
      ageSec,
      severity
    }
    if (ageSec > worstAgeSec) worstAgeSec = ageSec
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[worstSeverity]) worstSeverity = severity
  }
  return { reachable: true, chains, worstAgeSec, worstSeverity, fetchedAtSec }
}

// The interval may be a stream so callers can tune polling to urgency: idle browsing
// needs only a slow heartbeat, while pending submissions need fresh block numbers.
// An urgency bump restarts the poller, which also fetches immediately.
export function createIndexerHealthSource(
  sql: IIndexerClient,
  interval: number | IStream<number>
): IStream<IndexerHealth> {
  const intervalStream = typeof interval === 'number' ? just(interval) : interval
  const sourceFor = (intervalMs: number): IStream<IndexerHealth> =>
    periodicRun({ interval: intervalMs, actionOp: map(() => fetchIndexerHealth(sql)) })
  return switchLatest(map(sourceFor, skipRepeats(intervalStream)))
}

const SEVERITY_RANK: Record<LagSeverity, number> = { healthy: 0, lagging: 1, stale: 2, unreachable: 3 }
