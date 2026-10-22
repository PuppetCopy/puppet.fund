import type { Account, Address, Chain, Transport, WalletClient } from 'viem'
import type { mainnet } from 'viem/chains'
import type { ChainId } from '../const/index.js'

export interface IConnectedWallet {
  walletClient: WalletClient<Transport, Chain, Account>
  address: Address
  switchChain: (chainId: ChainId | typeof mainnet.id) => Promise<WalletClient<Transport, Chain, Account>>
}
