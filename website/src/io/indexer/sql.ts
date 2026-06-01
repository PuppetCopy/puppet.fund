import { createIndexerClient } from '@puppet/sdk/state'

export const indexerEndpoint = `${location.origin}/api/indexer`
export const sqlClient = createIndexerClient(indexerEndpoint)
