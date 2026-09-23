import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { type ChainId, IntervalTime } from '@puppet/sdk/const'
import { uiStorage } from '@/ui-storage'
import type { IStreamStoreKey } from '../app/storage/storage.js'
import type { IPerformanceMetric } from '../components/$PerformanceMetric.js'

const DB_NAME = `root:${DEPLOYMENTS[`Dictate:${HUB_CHAIN_ID}`].address}`

export const localStoreSchema = uiStorage.createStoreDefinition(DB_NAME, 3, {
  global: {
    activityTimeframe: IntervalTime.WEEK,
    performanceMetric: 'pnl' as IPerformanceMetric,
    hideBalances: false
  }
})

export interface IDepositSource {
  chainId: ChainId
  address: `0x${string}`
}

export interface IDepositPath {
  source: IDepositSource
  dest: IDepositSource
}

export function depositDestinationKey(wallet: string, scope: string): IStreamStoreKey<IDepositPath | null> {
  return {
    dbName: DB_NAME,
    storeName: 'global',
    key: `depositDestination:${scope}:${wallet.toLowerCase()}`,
    initialValue: null
  }
}

export function depositSourceKey(wallet: string): IStreamStoreKey<IDepositSource | null> {
  return {
    dbName: DB_NAME,
    storeName: 'global',
    key: `depositSource:${wallet.toLowerCase()}`,
    initialValue: null
  }
}

