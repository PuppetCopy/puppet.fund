import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { IntervalTime } from '@puppet/sdk/const'
import type { Address } from 'viem'
import { uiStorage } from '@/ui-storage'
import type { IStreamStoreKey } from '../app/storage/storage.js'
import type { ILeaderboardView, IPerformanceMetric } from '../io/datastore/query.js'

const DB_NAME = `root:${DEPLOYMENTS[`Dictate:${HUB_CHAIN_ID}`].address}`

export const localStoreSchema = uiStorage.createStoreDefinition(DB_NAME, 1, {
  global: {
    chain: HUB_CHAIN_ID,
    wallet: null as null | string,
    activityTimeframe: IntervalTime.WEEK,
    collateralTokenList: [] as string[],
    firstVisitSeen: false,
    hideBalances: false
  },
  ruleEditor: {
    advancedRouteEditorEnabled: false
  },
  leaderboard: {
    view: 'masters' as ILeaderboardView,
    performanceMetric: 'realisedPnl' as IPerformanceMetric,
    account: undefined as string | undefined
  },
  wallet: {}
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

export function swapTargetKey(tokenIn: Address): IStreamStoreKey<`0x${string}` | null> {
  return {
    dbName: DB_NAME,
    storeName: 'global',
    key: `swapTarget:${tokenIn.toLowerCase()}`,
    initialValue: null
  }
}
