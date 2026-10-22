import type { Address, PublicClient } from 'viem'
import type { ICompact } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'
import type { IActionKind, ITermsDeps } from '../../intent/index.js'
import { type createSdkContext, RELAY_RATE_MAX_STALE_MS, relayFeeOf } from '../../state/index.js'
import type { IConnectedWallet } from '../connectedWallet.js'
import type { createJournal } from '../journal.js'
import type { IRootState } from '../root.js'
import type { IWalletKeys } from '../walletKeys.js'

export interface IClientDeps extends ITermsDeps {
  context: ReturnType<typeof createSdkContext>
  journal: ReturnType<typeof createJournal>
  compact: ICompact
  matchmakerUrl: string
  swapEndpoints: { lifi: string; kyber: string; across: string; relay: string }
  venueClients: Readonly<Record<number, PublicClient>>
}

export interface ExecContext extends IClientDeps {
  wallet: IConnectedWallet
  root: IRootState | null
  loadRoot: () => Promise<IRootState>
  keys: IWalletKeys | null
}

export const rootOf = (ctx: ExecContext): Promise<IRootState> => (ctx.root !== null ? Promise.resolve(ctx.root) : ctx.loadRoot())

export const envelopeNonce = (deps: Pick<IClientDeps, 'journal'>, account: Address, chainId: ChainId): Promise<bigint> =>
  deps.journal(account).nonce(chainId)

export async function quoteRelayFee(
  deps: Pick<IClientDeps, 'context'>,
  chainId: ChainId,
  kind: IActionKind,
  carriesGenesis: boolean,
  token: Address,
  unitCount: bigint,
  innerGasLimit: bigint,
  calldataByteLength: bigint
): Promise<bigint> {
  const convert = await deps.context.getFeeConverter(chainId, token, RELAY_RATE_MAX_STALE_MS)
  return relayFeeOf(convert, chainId, kind, carriesGenesis, unitCount, innerGasLimit, calldataByteLength)
}
