import type { IBodySigner } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import type { IShare } from '@puppet/sdk/mpc'
import { type IStream, map } from 'aelea/stream'
import { type PromiseState, promiseState } from 'aelea/stream-extended'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import type { IAttestation } from '../components/portfolio/runner/steps.js'
import type { IChronicleStanding, ISettleFold } from '../io/journal/journal.js'
import type { IConnectedWallet } from './connectedWallet.js'

export interface IAccountBalance {
  chainId: ChainId
  token: Address
  balance: bigint
}

export interface IPendingCredit {
  chainId: ChainId
  token: Address
  block: bigint
  delta: bigint
}

export interface IRootState {
  account: Address
  user: Address
  deployed: Set<ChainId>
  unreachable: Set<ChainId>
  chronicle: IChronicleStanding
  balances: IAccountBalance[]
  bonded: bigint
  settled: { chainId: ChainId; block: bigint; txHash: Hex; nonce: bigint } | null
  pending: IPendingCredit[]
}

export const balanceId = (b: { chainId: number; token: Address }): string => `${b.chainId}:${getAddress(b.token)}`

export const balanceAt = (balances: readonly IAccountBalance[], chainId: ChainId, token: Address): bigint =>
  balances.find(b => b.chainId === chainId && isAddressEqual(b.token, token))?.balance ?? 0n

export function applyAttest(root: IRootState, settled: IAttestation): IRootState {
  const { request, result } = settled
  const next: IRootState = {
    ...root,
    settled: { chainId: request.chainId, block: settled.settledBlock, txHash: result.txHash, nonce: result.nonce }
  }
  if (!isAddressEqual(result.account, root.account)) return next
  if (settled.deltas.size === 0) return next
  const balances = [...root.balances]
  const pending = [...root.pending]
  for (const [token, delta] of settled.deltas) {
    const i = balances.findIndex(b => b.chainId === request.chainId && isAddressEqual(b.token, token))
    const row = i < 0 ? undefined : balances[i]!
    if (row === undefined) balances.push({ chainId: request.chainId, token, balance: delta })
    else balances[i] = { ...row, balance: row.balance + delta }
    pending.push({ token, chainId: request.chainId, block: settled.settledBlock, delta })
  }
  return { ...next, balances, pending }
}

export type IFold = { attest: IAttestation } | { journal: ISettleFold } | { syncFailed: true }

export interface IBodyKeyRecord {
  share: IShare
  signer: Hex
  user: Address
  session: Hex
  sessionExpiry: bigint
  funded: { chainId: number; token: Address }
}

export interface IBodyKeys {
  derive(wallet: IConnectedWallet, funded?: { chainId: number; token: Address }, onSigned?: (step: 'key' | 'session') => void): Promise<IBodySigner>
  accountOf(user: Address): Address | null
  signerOf(user: Address): Promise<IBodySigner | null>
  keysOf(user: Address): IBodyKeyRecord | null
}

export interface IWalletPair {
  wallet: IConnectedWallet | null
  root: Promise<IRootState | null>
  bodyKeys: IBodyKeys | null
}

export const rootQuery = (pair: IStream<IWalletPair>): IStream<PromiseState<IRootState | null>> =>
  promiseState(map((p: IWalletPair) => p.root, pair))
