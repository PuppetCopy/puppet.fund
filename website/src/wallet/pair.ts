import type { ISubaccountState } from '@puppet/sdk/state'
import { combine, type IStream, map, op, switchPromises } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import type { IConnectedWallet } from './index.js'

export interface IWalletPair {
  wallet: IConnectedWallet | null
  root: ISubaccountState | null
}

export const resolvedWalletPair = (
  walletQuery: IStream<Promise<IConnectedWallet | null>>,
  rootQuery: IStream<Promise<ISubaccountState | null>>
): IStream<IWalletPair> =>
  op(
    combine({ wallet: walletQuery, root: rootQuery }),
    map(async (p): Promise<IWalletPair> => {
      const [wallet, root] = await Promise.all([
        p.wallet,
        p.root.catch((err: unknown) => {
          console.error('account state read failed', err)
          return null
        })
      ])
      return { wallet, root }
    }),
    switchPromises,
    state()
  )
