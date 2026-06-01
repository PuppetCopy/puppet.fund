import type { GetConnectionReturnType } from '@wagmi/core'
import type { Address, Chain, Transport, WalletClient } from 'viem'
import { ensureSessionKey, type ISessionKey } from './sessionKey.js'
import type { wagmi } from './wallet.js'

export interface IConnectedWallet {
  connection: GetConnectionReturnType<typeof wagmi>
  walletClient: WalletClient<Transport, Chain>
  address: Address
  session: ISessionKey | null
}

export async function bindSession(wallet: IConnectedWallet): Promise<ISessionKey> {
  if (wallet.session) return wallet.session
  return ensureSessionKey(wallet.address, wallet.walletClient)
}
