import type { ChainId } from '@puppet/sdk/const'
import { type IStream, map } from 'aelea/stream'
import { type PromiseState, promiseState } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import type { IChronicleStanding, ISettleFold } from '../io/journal/journal.js'
import type { IConnectedWallet } from './connectedWallet.js'
import type { IFund, IWalletKeys } from './walletKeys.js'

export interface IAccountBalance {
  chainId: ChainId
  token: Address
  balance: bigint
}

export interface ISettledTx {
  chainId: ChainId
  block: bigint
  txHash: Hex
}

export interface IRootState {
  account: Address
  user: Address
  deployed: Set<ChainId>
  unreachable: Set<ChainId>
  chronicle: IChronicleStanding
  balances: IAccountBalance[]
  fund: IFund | null
  settled: ISettledTx | null
}

export const balanceId = (b: { chainId: number; token: Address }): string => `${b.chainId}:${getAddress(b.token)}`

export const balanceAt = (balances: readonly IAccountBalance[], chainId: ChainId, token: Address): bigint =>
  balances.find(b => b.chainId === chainId && isAddressEqual(b.token, token))?.balance ?? 0n

export type IFold = { settled: ISettledTx; journal: ISettleFold } | { settled: ISettledTx; syncError: unknown }

export interface IWalletPair {
  wallet: IConnectedWallet | null
  root: Promise<IRootState | null>
  keys: IWalletKeys | null
}

export const rootQuery = (pair: IStream<IWalletPair>): IStream<PromiseState<IRootState | null>> =>
  promiseState(map((p: IWalletPair) => p.root, pair))
