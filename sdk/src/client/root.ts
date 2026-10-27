import { type Address, type Hex, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import type { IConnectedWallet } from './connectedWallet.js'
import type { IFund, IWalletKeys } from './walletKeys.js'

export interface IAccountBalance {
  chainId: ChainId
  token: Address
  balance: bigint
}

export interface ISettledTx {
  chainId: ChainId
  account: Address
  block: bigint
  txHash: Hex
}

export interface IRootState {
  account: Address
  user: Address
  deployed: Set<ChainId>
  unreachable: Set<ChainId>
  balances: IAccountBalance[]
  fund: IFund | { unknown: string } | null
  funds: { list: readonly IFund[]; next: bigint } | { unknown: string }
  settled: readonly ISettledTx[] | null
  syncError: string | null
}

export const balanceAt = (balances: readonly IAccountBalance[], chainId: ChainId, token: Address): bigint =>
  balances.find(b => b.chainId === chainId && isAddressEqual(b.token, token))?.balance ?? 0n


export interface IWalletPair {
  wallet: IConnectedWallet | null
  root: Promise<IRootState | null>
  keys: IWalletKeys | null
}
