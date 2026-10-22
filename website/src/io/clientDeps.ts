import type { IClientDeps } from '@puppet/sdk/client'
import { appClientMap, venueClientMap } from '../wallet/wallet.js'
import { SWAP_ENDPOINTS } from './bridge/swapQuote.js'
import context, { getRate } from './context.js'
import { client as chronicle } from './datastore/reads.js'
import { journal } from './journal/journal.js'
import { compact, matchmakerUrl } from './matchmaker/index.js'

export const clientDeps: IClientDeps = {
  chronicle,
  clients: appClientMap,
  getRate,
  context,
  journal,
  compact,
  matchmakerUrl,
  swapEndpoints: SWAP_ENDPOINTS,
  venueClients: venueClientMap
}
