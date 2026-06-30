import type { ChainId } from '@puppet/sdk/const'
import {
  fundPositionTable,
  fundTable,
  type IFund,
  type IFundPosition,
  type IPlatformScale
} from '@puppet/sdk/schema'
import { fromPromise, type IStream, just, op, switchMap } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex } from 'viem'
import { client, fetchPlatformScale } from './matchmaker/reads.js'
import { readSignedBalance } from './onchain/account.js'

// A single read at mount. Post-action freshness is the OPTIMISTIC overlay's job (the attest ACK is assumed to succeed),
// not a re-query: the relay is fire-and-ACK, so the UI resolves the user's action on the ACK and a reload reconciles.
const queryOnce = <T>(fetchFn: () => Promise<T>): IStream<T> => switchMap(() => fromPromise(fetchFn()), just(undefined))

export const livePlatformScale: IStream<IPlatformScale | null> = op(queryOnce(fetchPlatformScale), state())

export const liveFundPool = (fund: Hex): IStream<IFund | undefined> => queryOnce(() => client.find(fundTable, { id: fund }))
export const liveRedeemPosition = (holder: Hex, fund: Hex): IStream<IFundPosition | undefined> =>
  queryOnce(() => client.find(fundPositionTable, { holder, fund }))

// null = the balance could not be read (transient failure); a genuinely cold account resolves to 0n. Consumers must
// not render null as a real zero.
// Self signed balance straight from the account contract (BaseAccount.signedBalanceOf), cache-first via the SW.
export const liveBalance = (account: Hex, chainId: number, token: Address): IStream<bigint | null> =>
  queryOnce(() => readSignedBalance(getAddress(account), chainId as ChainId, token).catch(() => null))
