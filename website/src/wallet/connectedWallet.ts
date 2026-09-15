import type { Address, Chain, Transport, WalletClient } from 'viem'

export interface IConnectedWallet {
  walletClient: WalletClient<Transport, Chain>
  address: Address
}
