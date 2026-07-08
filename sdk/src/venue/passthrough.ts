import type {
  IFundAccountLib__FundAccountInitParams,
  IIAccount__Call,
  IIAccount__SignTransfer
} from '@puppet/contracts/types'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { predictFundAccount, predictPuppetAccount } from '../account/index.js'
import { attestOperateIntent, type IOperateInput } from '../attestation/index.js'
import type { ICompact } from '../compact/compact.js'
import { DEFAULT_DEADLINE_SEC } from '../const/index.js'
import { getAcceptableRelayFee, relayDispatch } from '../state/fee.js'
import { randomNonce } from '../state/nonce.js'
import { type ITokenRegistryMap, registeredTokenAddresses, tokenInfoFor } from '../state/tokenRegistry.js'
import { GMX_V2_CHAIN_ID, GMX_WNT } from './gmx.js'
import { assertOperateSignable, deriveGmxOutflow, screenGmxOperate } from './operate.js'

export interface IPassthroughTransaction {
  to?: string
  data?: string
  value?: string
  gas?: string
}

export interface IPassthroughSigner {
  address: Address
  signTypedData(typedData: ReturnType<typeof attestOperateIntent>['typedData']): Promise<Hex>
}

export interface IAccountTokenState {
  token: Address
  balance: bigint
  signed: bigint
}

export interface IPassthroughDeps {
  user: Address
  signer: IPassthroughSigner
  // The specific fund the passthrough operates. Multi-key CREATE2 derives a fund address
  // from {master, baseToken, name}; the master is this session's puppet account, so the
  // caller threads only the fund's base and name.
  baseToken: Hex
  name: Hex
  compact: ICompact
  // Every read is caller-supplied so it serves from the caller's maintained context (registry cache,
  // SW-cached balances, gas/head/rate caches) instead of ad-hoc RPC calls on the dApp request path.
  // Chain-keyed getters are keyed by the VENUE chain: the intent anchors to that chain's head.
  getTokenRegistry: () => Promise<ITokenRegistryMap>
  getAccountBalances: (chainId: number, account: Address, tokens: Address[]) => Promise<IAccountTokenState[]>
  getBlockNumber: (chainId: number) => Promise<bigint>
  getGasPrice: (chainId: number) => Promise<bigint>
  getTokenPerNativeToken: (chainId: number, token: Address) => Promise<bigint>
}

const DEFAULT_CALL_GAS_LIMIT = 2_000_000n

// The smart-wallet passthrough: a dApp's raw transaction becomes the callList of an
// operate intent, screened locally with the matchmaker's own venue screen, leg-accounted
// (declared outflow + surplus recognition), anchored to the relay's indexed head, signed
// by the session key, and relayed. Shared by every client that impersonates the fund
// toward dApps (wallet extension, the website /bridge endpoint).
export async function sendOperatePassthrough(deps: IPassthroughDeps, tx: IPassthroughTransaction): Promise<Hex> {
  const { user, signer, baseToken, name, compact } = deps
  const { getTokenRegistry, getAccountBalances, getBlockNumber, getGasPrice, getTokenPerNativeToken } = deps
  if (!tx.to) throw new Error('eth_sendTransaction requires a target')
  const tokenRegistry = await getTokenRegistry()
  const params = { user, signer: signer.address } as const
  const fundParams: IFundAccountLib__FundAccountInitParams = {
    master: predictPuppetAccount(params),
    baseToken,
    name
  }
  const fund = predictFundAccount(fundParams)

  // Native value is the GMX execution fee, paid from the fund's own ETH (a registered
  // token under the native marker). The screen pins it to a sendWnt -> OrderVault.
  const value = tx.value ? BigInt(tx.value) : 0n
  const callList: IIAccount__Call[] = [
    {
      target: getAddress(tx.to),
      value,
      gasLimit: tx.gas ? BigInt(tx.gas) : DEFAULT_CALL_GAS_LIMIT,
      callData: (tx.data ?? '0x') as Hex
    }
  ]

  // One outflow leg per token the batch moves (collateral via sendTokens, native fee via
  // sendWnt). A standalone approval yields a single zero-amount leg on the approved token.
  const outflows = deriveGmxOutflow(callList)
  const legs = outflows.map(o => {
    const token = getAddress(o.token)
    tokenInfoFor(tokenRegistry, GMX_V2_CHAIN_ID, token)
    return { token, amountOut: o.amountOut }
  })
  // A no-token operate (cancelOrder) still needs one leg: the relay refuses an empty transferList
  // (nothing to screen and no token to quote its fee against), so mirror the operator's 0/0 marker
  // leg. It must be a VENUE-chain token (the fund's baseToken is a hub address, never registered
  // here); WNT is the venue's canonical registered asset and what a cancel refunds in.
  if (legs.length === 0) {
    tokenInfoFor(tokenRegistry, GMX_V2_CHAIN_ID, GMX_WNT)
    legs.push({ token: GMX_WNT, amountOut: 0n })
  }

  assertOperateSignable(
    screenGmxOperate({
      callList,
      account: fund,
      baseTokens: legs.map(l => l.token),
      registeredTokens: registeredTokenAddresses(tokenRegistry, GMX_V2_CHAIN_ID)
    })
  )

  // The relay quotes its fee against transferList[0].token (handlers.ts signAndQuote), so
  // the signed acceptableRelayFee MUST be denominated in that same token or the off-chain
  // RELAY_FEE_EXCEEDED check compares mismatched units. getTokenPerNativeToken prices native as 1e18.
  // Non-empty by construction (the marker block above); a silent default here would mis-denominate
  // the fee if that invariant ever broke, so fail loud instead.
  const feeToken = legs[0]?.token
  if (feeToken === undefined) throw new Error('operate intent built no transfer leg')

  // ONE parallel read phase on the dApp request path: nothing below depends on another read. The block
  // anchor is the venue chain's head (the relay validates blockNumber ± maxBlockDelay against its own,
  // so a context-cached recent head is fine); balances/gas/rate come from the caller's context too.
  const [balances, blockNumber, gasPrice, tokenPerNativeToken] = await Promise.all([
    getAccountBalances(GMX_V2_CHAIN_ID, fund, legs.map(l => l.token)),
    getBlockNumber(GMX_V2_CHAIN_ID),
    getGasPrice(GMX_V2_CHAIN_ID),
    getTokenPerNativeToken(GMX_V2_CHAIN_ID, feeToken)
  ])

  // Recognize the fund's surplus on each leg's token: amountIn = balance - signed turns the on-chain
  // post-balance check into a minimum-custody guard for that token. A leg without a balance row fails
  // loud rather than signing fabricated zeros.
  const enriched = legs.map(leg => {
    const row = balances.find(b => isAddressEqual(getAddress(b.token), getAddress(leg.token)))
    if (!row) throw new Error(`no balance state for leg token ${leg.token}`)
    return { ...leg, signed: row.signed, amountIn: row.balance > row.signed ? row.balance - row.signed : 0n }
  })
  const transferList: IIAccount__SignTransfer[] = enriched.map(l => ({
    token: l.token,
    amountIn: l.amountIn,
    amountOut: l.amountOut
  }))
  const signedBalanceByToken: Record<Address, bigint> = Object.fromEntries(enriched.map(l => [getAddress(l.token), l.signed]))
  const acceptableRelayFee = getAcceptableRelayFee(
    gasPrice,
    relayDispatch('operate').router,
    'operate',
    tokenPerNativeToken,
    BigInt(callList.length)
  )

  const input: IOperateInput = {
    params,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    chainId: BigInt(GMX_V2_CHAIN_ID),
    fundParams,
    callList,
    transferList
  }
  const { intent, typedData } = attestOperateIntent(
    { chainId: GMX_V2_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalanceByToken },
    input
  )
  const signature = await signer.signTypedData(typedData)
  const ack = await compact.attest({ kind: 'operate', input, intent, signature })
  return ack.txHash
}
