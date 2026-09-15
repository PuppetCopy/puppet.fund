import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { type ChainId, IntervalTime } from '@puppet/sdk/const'
import { uiStorage } from '@/ui-storage'
import type { IStreamStoreKey } from '../app/storage/storage.js'

const DB_NAME = `root:${DEPLOYMENTS[`Dictate:${HUB_CHAIN_ID}`].address}`

export const localStoreSchema = uiStorage.createStoreDefinition(DB_NAME, 3, {
  global: {
    chain: HUB_CHAIN_ID,
    wallet: null as null | string,
    activityTimeframe: IntervalTime.WEEK,
    firstVisitSeen: false,
    hideBalances: false
  },
  ruleEditor: {
    advancedRouteEditorEnabled: false
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
  chainId: ChainId
  address: `0x${string}`
}

export function depositDestinationKey(wallet: string): IStreamStoreKey<IDepositSource | null> {
  return {
    dbName: DB_NAME,
    storeName: 'global',
    key: `depositDestination:${wallet.toLowerCase()}`,
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

