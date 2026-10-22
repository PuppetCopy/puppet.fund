import { createJournal, type IJournalDeps } from '@puppet/sdk/client'
import { ENDPOINTS } from '../../app/endpoints.js'
import { publicClientMap } from '../../wallet/wallet.js'
import { viewCall } from '../onchain/viewRead.js'
import { uiStorage } from '@/ui-storage'

export const journalDeps: IJournalDeps = {
  chronicleUrl: ENDPOINTS.chronicle,
  clients: publicClientMap,
  viewCall,
  storage: localStorage,
  store: uiStorage.device
}

export const journal = createJournal(journalDeps)
