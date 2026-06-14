import type { EntityTypeMap, IEntityName, ISelectArgs } from '@puppet/indexer-graphql/client'
import { buildSelectDocument, parseEntityRow, selectVariables } from '@puppet/indexer-graphql/client'
import { disposeWith, type IStream, map, op } from 'aelea/stream'
import { multicast, stream } from 'aelea/stream-extended'
import { createClient as createWsClient, type Client as WsClient } from 'graphql-ws'
import { recover } from '../core/stream/recover.js'

export interface IIndexerClient {
  httpEndpoint: string
  wsClient: WsClient
}

interface IGraphqlResponse<T> {
  data?: T
  errors?: { message: string }[]
}

export class GraphqlQueryError extends Error {
  readonly name = 'GraphqlQueryError'
  readonly endpoint: string
  constructor(endpoint: string, detail: string) {
    super(`GraphQL indexer request failed at ${endpoint}: ${detail}`)
    this.endpoint = endpoint
  }
}

// The socket must outlive transient drops (wallet popups, chain switches, tab
// backgrounding): graphql-ws re-subscribes every active operation after a reconnect,
// so retrying here is what keeps liveSelect streams emitting for the whole session.
export function createIndexerClient(httpEndpoint: string, wsEndpoint = deriveWsUrl(httpEndpoint)): IIndexerClient {
  const wsClient = createWsClient({
    url: wsEndpoint,
    lazy: true,
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    keepAlive: 12_000
  })
  return { httpEndpoint, wsClient }
}

export async function query<T>(
  client: IIndexerClient,
  document: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(client.httpEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: document, variables })
  })
  if (!response.ok) throw new GraphqlQueryError(client.httpEndpoint, `HTTP ${response.status}`)
  const result = (await response.json()) as IGraphqlResponse<T>
  if (result.errors?.length) {
    throw new GraphqlQueryError(client.httpEndpoint, result.errors.map(e => e.message).join('; '))
  }
  if (result.data === undefined) throw new GraphqlQueryError(client.httpEndpoint, 'missing data')
  return result.data
}

export async function select<K extends IEntityName>(
  client: IIndexerClient,
  entity: K,
  args: ISelectArgs<K> = {}
): Promise<EntityTypeMap[K][]> {
  const data = await query<Record<string, Record<string, unknown>[]>>(
    client,
    buildSelectDocument(entity, args as ISelectArgs<IEntityName>, 'query'),
    selectVariables(args as ISelectArgs<IEntityName>)
  )
  return (data[entity] ?? []).map(row => parseEntityRow(entity, row))
}

export async function selectOne<K extends IEntityName>(
  client: IIndexerClient,
  entity: K,
  args: ISelectArgs<K> = {}
): Promise<EntityTypeMap[K] | undefined> {
  const rows = await select(client, entity, { ...args, limit: 1 })
  return rows[0]
}

export function liveSelect<K extends IEntityName>(
  client: IIndexerClient,
  entity: K,
  args: ISelectArgs<K> = {}
): IStream<EntityTypeMap[K][]> {
  const document = buildSelectDocument(entity, args as ISelectArgs<IEntityName>, 'subscription')
  const subscription = live<Record<string, Record<string, unknown>[]>>(
    client,
    document,
    selectVariables(args as ISelectArgs<IEntityName>)
  )
  return map(data => (data[entity] ?? []).map(row => parseEntityRow(entity, row)), subscription)
}

export function live<T>(client: IIndexerClient, document: string, variables?: Record<string, unknown>): IStream<T> {
  return op(
    stream<T>((sink, scheduler) => {
      const unsubscribe = client.wsClient.subscribe<T>(
        { query: document, variables },
        {
          next: payload => {
            if (payload.errors?.length) {
              sink.error(
                scheduler.time(),
                new GraphqlQueryError(client.httpEndpoint, payload.errors.map(e => e.message).join('; '))
              )
              return
            }
            if (payload.data != null) sink.event(scheduler.time(), payload.data)
          },
          error: err => {
            sink.error(
              scheduler.time(),
              err instanceof Error ? err : new GraphqlQueryError(client.httpEndpoint, String(err))
            )
            sink.end(scheduler.time())
          },
          complete: () => sink.end(scheduler.time())
        }
      )
      return disposeWith(unsubscribe)
    }),
    recover({ recoverTime: 3_000 }),
    multicast
  )
}

function deriveWsUrl(httpBase: string): string {
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}`
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}`
  return httpBase
}
