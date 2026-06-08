import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { IntervalTime } from '@puppet/sdk/const'
import type { Address } from 'viem'
import { uiStorage } from '@/ui-storage'
import type { IStreamStoreKey } from '../app/storage/storage.js'
import type { ILeaderboardView, IPerformanceMetric } from '../io/indexer/query.js'
import { WALLET_TAB } from '../pages/types.js'

const DB_NAME = `root:${PUPPET_CONTRACT_MAP.Dictate.address}`

export const localStoreSchema = uiStorage.createStoreDefinition(DB_NAME, 1, {
  global: {
    chain: HUB_CHAIN_ID,
    wallet: null as null | string,
    activityTimeframe: IntervalTime.WEEK,
    collateralTokenList: [] as string[],
    indexTokenList: [] as string[],
    activeMasterByWallet: {} as Record<string, Address | null>,
    firstVisitSeen: false
  },
  ruleEditor: {
    advancedRouteEditorEnabled: false
  },
  leaderboard: {
    view: 'masters' as ILeaderboardView,
    performanceMetric: 'realisedPnl' as IPerformanceMetric,
    account: undefined as string | undefined,
    shadowSort: { direction: 'desc', selector: 'size' } as { direction: 'asc' | 'desc'; selector: 'size' | 'pnlroi' }
  },
  wallet: {
    selectedTab: WALLET_TAB.PUPPET
  }
})

export function originChainKey(wallet: string): IStreamStoreKey<number | null> {
  return {
    dbName: DB_NAME,
    storeName: 'global',
    key: `originChain:${wallet.toLowerCase()}`,
    initialValue: null
  }
}

export interface IDepositSource {
  chainId: number
  address: `0x${string}`
}

export function depositSourceKey(wallet: string): IStreamStoreKey<IDepositSource | null> {
  return {
    dbName: DB_NAME,
    storeName: 'global',
    key: `depositSource:${wallet.toLowerCase()}`,
    initialValue: null
  }
}
