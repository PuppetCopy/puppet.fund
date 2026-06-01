import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import { type IStream, map } from 'aelea/stream'
import type { ChainId } from '../const/index.js'
import { periodicRun } from '../core/stream/recover.js'
import { type IIndexerClient, query } from './shared.js'

interface IChainMetadataRow {
  chain_id: number
  latest_processed_block: number
  block_height: number
  timestamp_caught_up_to_head_or_endblock: string | null
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

export interface IndexerChainHealth {
  block: { number: bigint; timestamp: number }
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
    'query ChainMetadata { chain_metadata { chain_id latest_processed_block block_height timestamp_caught_up_to_head_or_endblock } }'
  )
  return data.chain_metadata
}

export async function getIndexerBlock(sql: IIndexerClient, network: string): Promise<bigint> {
  const rows = await getChainMetadata(sql)
  const row = rows.find(r => CHAIN_NETWORK_MAP[r.chain_id as ChainId] === network)
  if (!row) throw new Error(`indexer has no block data for chain ${network}`)
  return BigInt(row.latest_processed_block)
}

export function createIndexerHealthSource(sql: IIndexerClient, intervalMs: number): IStream<IndexerHealth> {
  return periodicRun({
    interval: intervalMs,
    actionOp: map(async () => {
      const fetchedAtSec = Math.floor(Date.now() / 1000)
      const rows = await getChainMetadata(sql).catch(() => null)
      if (!rows || rows.length === 0) {
        return {
          reachable: false,
          chains: {},
          worstAgeSec: Number.POSITIVE_INFINITY,
          worstSeverity: 'unreachable' as LagSeverity,
          fetchedAtSec
        }
      }
      const chains: IndexerHealth['chains'] = {}
      let worstAgeSec = 0
      let worstSeverity: LagSeverity = 'healthy'
      for (const row of rows) {
        const network = CHAIN_NETWORK_MAP[row.chain_id as ChainId]
        if (!network) continue
        const headSec = row.timestamp_caught_up_to_head_or_endblock
          ? Math.floor(new Date(row.timestamp_caught_up_to_head_or_endblock).getTime() / 1000)
          : fetchedAtSec
        const behind = row.block_height - row.latest_processed_block
        const freshSec = behind > 0 ? headSec : fetchedAtSec
        const ageSec = behind > 0 ? fetchedAtSec - headSec : 0
        const severity: LagSeverity =
          ageSec <= DEFAULT_LAG_THRESHOLDS.healthyMaxAgeSec
            ? 'healthy'
            : ageSec <= DEFAULT_LAG_THRESHOLDS.laggingMaxAgeSec
              ? 'lagging'
              : 'stale'
        chains[network] = {
          block: { number: BigInt(row.latest_processed_block), timestamp: freshSec },
          ageSec,
          severity
        }
        if (ageSec > worstAgeSec) worstAgeSec = ageSec
        if (SEVERITY_RANK[severity] > SEVERITY_RANK[worstSeverity]) worstSeverity = severity
      }
      return { reachable: true, chains, worstAgeSec, worstSeverity, fetchedAtSec }
    })
  })
}

const SEVERITY_RANK: Record<LagSeverity, number> = { healthy: 0, lagging: 1, stale: 2, unreachable: 3 }
