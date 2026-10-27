import { accountmoduleAbi, escrowstoreAbi, fundaccountAbi, spokegateAbi, useraccountAbi } from '@puppet/contracts/abi'
import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { ACCOUNT_CALL_MAP, accountCallEvent } from '@puppet/contracts/events'
import { SESSION_REVOKE_DELAY } from '@puppet/contracts/intents'
import type {
  IFund__AllocateIntent,
  IFundStore__Redemption,
  IHubGate__MandateIntent,
  IIAccount__Call,
  ILiquidityGate__RetireEscrowIntent,
  IMandateLib__Mandate,
  IFund__Valuation,
  IRedeem__RedeemIntent,
  IRedeem__SellIntent,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import {
  type Address,
  AtomicityNotSupportedError,
  AtomicReadyWalletRejectedUpgradeError,
  BaseError,
  concat,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  hashTypedData,
  isAddressEqual,
  parseAbiItem,
  type PublicClient,
  slice,
  type TypedDataDefinition,
  UnsupportedChainIdError,
  WaitForCallsStatusTimeoutError,
  WaitForTransactionReceiptTimeoutError,
  zeroAddress
} from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { getCapabilities, readContract, sendCalls, sendTransaction, waitForCallsStatus, writeContract } from 'viem/actions'
import {
  accountCallsFromReceipt,
  fundProfile,
  type IBodyGenesis,
  predictShare,
  predictUserAccount,
  signBodyGenesis
} from '../../account/index.js'
import { CompactError, decode, encode, type IDispatchedFrame, type IDispatchRequest, requestValuation, SETTLEMENT_TIMEOUT_MS } from '../../compact/index.js'
import { CHAIN_ID_LIST, type ChainId, chainNameOf, CROSS_CHAIN_MIN_USD, DEFAULT_DEADLINE_SEC, deploymentAddress, HUB_CHAIN, PRECISION, PRICED_DEADLINE_SEC, resolveDispatchChainId, USD_DECIMALS, USD_SYMBOL } from '../../const/index.js'
import { awaitWhile, getTokenDescription, readableTokenAmountLabel } from '../../core/index.js'
import { allocateSignerGain, DEFAULT_EVALUATION_CONFIG, driftVerdict, screenSwapValue, usdPriceFromRate } from '../../evaluate/index.js'
import { acrossDepositOf } from '../../fold/index.js'
import {
  ACROSS_FILLED,
  acrossSpokePoolOf,
  allocationTermsOf,
  allowanceTokensOf,
  attestAllocateIntent,
  attestDepositSwap,
  attestFundSwapIntent,
  attestMandateIntent,
  attestOperateIntent,
  attestRedeemIntent,
  attestRetireEscrowIntent,
  attestSellIntent,
  attestWithdrawIntent,
  claimantsOf,
  clientOf,
  creditableOf,
  fromChain,
  type IActionKind,
  type IDepositSwapInput,
  type IIntentByKind,
  type ISwapRoute,
  type IWithdrawInput,
  type IWithdrawRoute,
  intentTypedData,
  operateTokenList,
  creditTotalTypedData,
  quoteAcrossDeposit,
  quoteSwapRoutes,
  readAllocationCandidates,
  readCreditBook,
  readEscrowCredit,
  readFundState,
  readHolderStates,
  readFundBook,
  readMandateWindow,
  readOpening,
  readReleased,
  assertNoOpenTransit,
  openEscrowOf,
  redeemFeeFor,
  redeemValuationOf,
  requireFolded,
  sizeRedeem,
  sizeRedeemAt,
  type IRedeemSizeInput,
  routeCalldataBytes,
  routeQuoteExpiry,
  routeSwaps,
  requireFoldedOn,
  revokedAtIn,
  verifyRevokeSettled,
  shadeQuote,
  SPOKE_POOL_ABI,
  verifyApproval,
  verifyFulfil
} from '../../intent/index.js'
import { G } from '../../mpc/core.js'
import { encodePoint, signerCommitment } from '../../mpc/index.js'
import { shareScalar } from '../../mpc/keygen.js'
import { isOpen, payoutLineOf, planRedeem, valuationOf, valueFor } from '../../pool/index.js'
import { accountTable, fundTable, type IFundRow } from '../../schema/index.js'
import {
  chainTokenOfKey,
  declaredCallGas,
  dynamicCalldataBytes,
  fetchTokenBalance,
  listedTokensOf,
  providerToken,
  RELAY_RATE_MAX_STALE_MS,
  relayFeeFloor,
  relayFeeOf,
  symbolOf,
  tokenKeyOf,
  TYPICAL_SUBCALL_GAS,
  wrappedNativeAddressOf,
  routeSubcallGas
} from '../../state/index.js'
import {
  acrossBridgeCalls,
  type IVenueIntent,
  type IVenueIntentParams,
  operateExchange,
  operateOutflows,
  UNISWAP_POOLS,
  uniswapPools,
  uniswapQuotes,
  uniswapSwapCalls,
  VENUES,
  withAllowancePolicy
} from '../../venue/index.js'
import {
  type IAllocateDraft,
  type IDepositDraft,
  type IDepositLeg,
  type IDraft,
  type IEscrowReturnDraft,
  type IWalletWithdrawDraft,
  type IRevokeDraft,
  type IFundIdentityDraft,
  type IFundSwapDraft,
  type IMandateDraft,
  type IOperateDraft,
  type IRedeemDraft,
  type IRedeemLeg,
  type IReportWalletTx,
  type ISentTx,
  type ISellDraft,
  type IOperateSwapDraft,
  type IUnsealed,
  venueIntentOf,
  venueWithdrawOf
} from '../draft.js'
import type { ISettledTx } from '../root.js'
import type { IFund } from '../walletKeys.js'
import { type ExecContext, envelopeNonce, type IClientDeps, quoteRelayFee, rootOf } from './_shared.js'


type IStepRequest = { [K in IActionKind]: { kind: K; chainId: ChainId; intent: IIntentByKind[K] } }[IActionKind]

export type IAttestation = {
  request: IStepRequest
  result: IDispatchedFrame
  settledBlock: bigint
  digest: Hex
}

async function approverFor(ctx: ExecContext, chainId: ChainId): Promise<(digest: Hex) => Promise<Hex>> {
  return (await keysOf(ctx).grantSession(ctx.wallet, chainId)).approve
}

function keysOf(ctx: ExecContext) {
  if (ctx.keys === null) throw new Error('this build carries no key service, so nothing can be signed')
  return ctx.keys
}

function fundSignerFor(ctx: ExecContext, account: Address) {
  const signer = keysOf(ctx).fundSignerOf(ctx.wallet.address, account)
  if (signer === null) throw new Error(`this browser holds no trading key for ${account}; reopen the fund on this device first`)
  return signer
}

async function dispatchAndSettle(deps: Pick<IClientDeps, 'compact' | 'journal' | 'clients'>, wire: IDispatchRequest, record: IStepRequest, intentDigest: Hex): Promise<IAttestation> {
  let ack: IDispatchedFrame
  try {
    ack = await deps.compact.dispatch(wire)
  } catch (err) {
    if (!(err instanceof CompactError) || !['DISPATCH_TIMEOUT', 'RELAY_UNREACHABLE', 'BAD_ACK'].includes(err.code)) throw err
    return landedPastDeadline(deps, record, intentDigest, null)
  }
  return settle(deps, ack, record, intentDigest)
}

const LANDING_MARGIN_MS = 90_000

export async function landedIntent(
  deps: Pick<IClientDeps, 'journal' | 'clients'>,
  chainId: ChainId,
  header: { account: Address; user: Address; deadline: bigint },
  digest: Hex
): Promise<ISettledTx | null> {
  const lookup = async () => {
    const journal = deps.journal(header.account)
    const fold = await journal.settle(header.user, [])
    const call = await journal.callOf(chainId, digest)
    if (call === null) return { landed: null, unreachable: fold.unreachable }
    const logs = await clientOf(deps, chainId).getLogs({
      address: deploymentAddress('AccountModule', chainId),
      event: accountCallEvent,
      args: { account: header.account },
      fromBlock: call.blockNumber,
      toBlock: call.blockNumber
    })
    const landed = logs.find(log => log.args.digest === digest)
    if (landed === undefined) {
      throw new Error(`the journal places the intent ${digest} at block ${call.blockNumber} on chain ${chainId}, but that block carries no such AccountCall`)
    }
    return { landed: { chainId, account: header.account, block: call.blockNumber, txHash: landed.transactionHash }, unreachable: fold.unreachable }
  }
  const first = await lookup()
  if (first.landed !== null) return first.landed
  const wait = Number(header.deadline) * 1000 + LANDING_MARGIN_MS - Date.now()
  const last = wait > 0 ? await new Promise(resolve => setTimeout(resolve, wait)).then(lookup) : first
  if (last.landed === null && last.unreachable.has(chainId)) {
    throw new Error(`${chainNameOf(chainId) ?? `chain ${chainId}`} could not be read, so Puppet cannot tell whether intent ${digest} landed; check your fund's history before submitting it again`)
  }
  return last.landed
}

async function landedPastDeadline(deps: Pick<IClientDeps, 'journal' | 'clients'>, record: IStepRequest, intentDigest: Hex, ack: IDispatchedFrame | null): Promise<IAttestation> {
  const header = record.intent.header
  const landed = await landedIntent(deps, record.chainId, header, intentDigest)
  if (landed === null) {
    throw new Error(
      `${record.kind} ${ack === null ? 'was never acknowledged' : `(tx ${ack.txHash}) showed no receipt`}, and its deadline passed with no record of it on chain ${record.chainId}; nothing of yours moved, resubmit from a fresh quote.`
    )
  }
  return {
    request: record,
    result: { account: header.account, txHash: landed.txHash, relayFee: ack === null ? header.fee : ack.relayFee },
    settledBlock: landed.block,
    digest: intentDigest
  }
}

async function settle(deps: Pick<IClientDeps, 'journal' | 'clients'>, ack: IDispatchedFrame, record: IStepRequest, intentDigest: Hex): Promise<IAttestation> {
  const settleClient = clientOf(deps, record.chainId)
  let receipt: Awaited<ReturnType<typeof settleClient.waitForTransactionReceipt>>
  try {
    receipt = await settleClient.waitForTransactionReceipt({ hash: ack.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
  } catch {
    return landedPastDeadline(deps, record, intentDigest, ack)
  }
  if (receipt.status === 'reverted') {
    throw new Error(`${record.kind} reverted on chain ${record.chainId} (tx ${ack.txHash}); nothing of yours moved, resubmit from a fresh quote.`)
  }
  const call = accountCallsFromReceipt(record.chainId, receipt).find(c => isAddressEqual(c.account, ack.account) && c.digest === intentDigest)
  if (!call) {
    throw new Error(
      `transaction ${ack.txHash} settled without an AccountCall for your ${record.kind} (digest ${intentDigest}); nonce ${record.intent.header.nonce} on ${ack.account} was consumed by a different action, so nothing of yours moved. Resubmit from a fresh quote.`
    )
  }
  await deps.journal(ack.account).settle(record.intent.header.user, [{ chainId: record.chainId, block: call.blockNumber }])
  return { request: record, result: ack, settledBlock: call.blockNumber, digest: intentDigest }
}

function intentHeader(ctx: ExecContext, priced: boolean, account: Address, nonce: bigint, feeToken: Address, fee: bigint, notAfter?: number | null) {
  const deadline = Math.floor(Date.now() / 1000) + (priced ? PRICED_DEADLINE_SEC / 2 : DEFAULT_DEADLINE_SEC)
  return {
    account,
    user: ctx.wallet.address,
    nonce,
    deadline: BigInt(notAfter == null ? deadline : Math.min(deadline, notAfter)),
    feeToken,
    fee
  }
}

async function dispatch(
  kind: IActionKind,
  chainId: ChainId,
  input: IDispatchRequest['input'],
  intent: IStepRequest['intent'],
  typedData: TypedDataDefinition,
  ctx: ExecContext,
  genesis?: IBodyGenesis,
  bodyShare?: { sid: Hex; pkA: Hex }
): Promise<IAttestation> {
  const digest = hashTypedData(typedData)
  const signature = await (await approverFor(ctx, chainId))(digest)
  const user = getAddress(ctx.wallet.address)
  const parent = predictUserAccount(user)
  const client = clientOf(ctx, chainId)
  const [rows, block] = await Promise.all([ctx.chronicle.select(accountTable, { where: { account: parent } }), client.getBlock()])
  const code = await client.getCode({ address: parent, blockNumber: block.number })
  const epoch = code === undefined || code === '0x' ? 0n : await readContract(client, { address: parent, abi: useraccountAbi, functionName: 'epoch', blockNumber: block.number })
  verifyApproval(parent, { user, epoch, revokedAt: revokedAtIn(rows) }, digest, signature, block.timestamp, intent.header.deadline)
  await requireFoldedOn(ctx, parent, rows, CHAIN_ID_LIST)
  return dispatchAndSettle(
    ctx,
    { kind, chainId, input, intent: intent === input ? undefined : intent, signature, genesis, bodyShare } as IDispatchRequest,
    { kind, chainId, intent } as IStepRequest,
    digest
  )
}

async function fundOf(ctx: ExecContext): Promise<IFund> {
  const fund = (await rootOf(ctx)).fund
  if (fund === null) throw new Error('open a fund before running this action; it acts through the fund, not your wallet account')
  if ('unknown' in fund) throw new Error(fund.unknown)
  return fund
}

async function fundRowOf(ctx: ExecContext, master: Address): Promise<IFundRow> {
  const rows = await ctx.chronicle.select(fundTable, { where: { master } })
  const row = rows[0]
  if (row === undefined) throw new Error(`the chronicle holds no fund for ${master}, so its share token is unknown`)
  return row
}

async function headerStateOf(ctx: ExecContext, chainId: ChainId, nonce: bigint) {
  return (await createsAccount(ctx, chainId)) ? null : { user: getAddress(ctx.wallet.address), nonce }
}

const createsAccount = async (ctx: ExecContext, chainId: ChainId): Promise<boolean> =>
  (
    await readContract(clientOf(ctx, chainId), {
      address: deploymentAddress('AccountModule', chainId),
      abi: accountmoduleAbi,
      functionName: 'accountTipMap',
      args: [predictUserAccount(ctx.wallet.address)]
    })
  )[0] === 0n

const KEYLESS_GENESIS: IBodyGenesis = { parent: zeroAddress, key: '0x', approval: '0x', authorization: null }

async function delegationOf(client: PublicClient, chainId: ChainId, account: Address): Promise<{ delegated: boolean; module: Address | null }> {
  const code = await client.getCode({ address: account })
  if (code?.toLowerCase() !== `0xef0100${deploymentAddress('FundAccount', chainId).slice(2)}`.toLowerCase()) return { delegated: false, module: null }
  const [module] = await readContract(client, { address: account, abi: fundaccountAbi, functionName: 'bound' })
  return { delegated: true, module: isAddressEqual(module, zeroAddress) ? null : module }
}

async function genesisFor(ctx: ExecContext, account: Address, chainId: ChainId, onTx?: IReportWalletTx): Promise<IBodyGenesis> {
  const parent = predictUserAccount(ctx.wallet.address)
  if (isAddressEqual(account, parent)) return KEYLESS_GENESIS
  const client = clientOf(ctx, chainId)
  const { delegated, module } = await delegationOf(client, chainId, account)
  if (module !== null) return { parent, key: '0x', approval: '0x', authorization: null }
  const signer = fundSignerFor(ctx, account)
  const [nonce, opened] = await Promise.all([
    client.getTransactionCount({ address: account }),
    ctx.chronicle.select(fundTable, { where: { master: account } }).then(rows => (rows[0] === undefined ? null : readOpening(ctx, account, rows[0].transactionHash)))
  ])
  const approval = opened === null ? await keysOf(ctx).approveFund(ctx.wallet, HUB_CHAIN_ID, account) : opened.approval
  if (opened === null) onTx?.('genesis', null)
  return signBodyGenesis({ account, sign: signer.sign }, { account, parent }, approval, { chainId, nonce: delegated ? 0 : nonce })
}

const WALLET_SETTLE_TIMEOUT_MS = 30 * 60 * 1000
const CHRONICLE_CATCH_UP_MS = 90_000

async function walletReceipt(client: PublicClient, chainId: ChainId, hash: Hex) {
  let replaced = null as 'replaced' | 'cancelled' | 'repriced' | null
  const receipt = await client
    .waitForTransactionReceipt({
      hash,
      timeout: WALLET_SETTLE_TIMEOUT_MS,
      onReplaced: replacement => {
        replaced = replacement.reason
      }
    })
    .catch((err: unknown) => {
      if (!(err instanceof WaitForTransactionReceiptTimeoutError)) throw err
      throw new Error(
        `Your wallet's transaction ${hash} has not confirmed on ${chainNameOf(chainId) ?? `chain ${chainId}`} after ${WALLET_SETTLE_TIMEOUT_MS / 60_000} minutes. It may still land, so check it on the explorer before submitting again.`
      )
    })
  if (replaced === 'cancelled' || replaced === 'replaced') throw new Error(`Your wallet ${replaced} transaction ${hash} before it landed; nothing moved.`)
  return receipt
}
const CHRONICLE_POLL_MS = 2_000

async function sentLanding(ctx: ExecContext, sent: ISentTx, account: Address): Promise<ISettledTx | null> {
  const where = chainNameOf(sent.chainId) ?? `chain ${sent.chainId}`
  if ('batch' in sent) {
    const wallet = await ctx.wallet.switchChain(sent.chainId)
    const { status, receipts } = await waitForCallsStatus(wallet, { id: sent.batch, timeout: WALLET_SETTLE_TIMEOUT_MS }).catch((err: unknown) => {
      if (!(err instanceof WaitForCallsStatusTimeoutError)) throw err
      throw new Error(`Your wallet's batch ${sent.batch} from the last Submit has still not confirmed on ${where}. It may still land, so this Submit waits for it instead of sending again.`)
    })
    const last = receipts === undefined ? undefined : receipts[receipts.length - 1]
    return status === 'success' && last !== undefined && last.status === 'success' ? { chainId: sent.chainId, account, block: last.blockNumber, txHash: last.transactionHash } : null
  }
  let replaced = null as 'replaced' | 'cancelled' | 'repriced' | null
  const receipt = await clientOf(ctx, sent.chainId)
    .waitForTransactionReceipt({
      hash: sent.hash,
      timeout: WALLET_SETTLE_TIMEOUT_MS,
      onReplaced: replacement => {
        replaced = replacement.reason
      }
    })
    .catch((err: unknown) => {
      if (!(err instanceof WaitForTransactionReceiptTimeoutError)) throw err
      throw new Error(`Your wallet's transaction ${sent.hash} from the last Submit has still not confirmed on ${where}. It may still land, so this Submit waits for it instead of sending again.`)
    })
  return replaced === 'cancelled' || replaced === 'replaced' || receipt.status !== 'success' ? null : { chainId: sent.chainId, account, block: receipt.blockNumber, txHash: receipt.transactionHash }
}

async function fundAccount(draft: IDepositDraft, ctx: ExecContext, carried: ISettledTx | { sent: ISentTx } | null, onTx?: IReportWalletTx): Promise<{ block: bigint; funding: Hex | null } | null> {
  if (draft.source === 'account') return null
  const leg = draft.deposit
  const chainId = resolveDispatchChainId(leg.chainId)
  const publicClient = clientOf(ctx, chainId)
  const commits =
    draft.identity !== undefined &&
    (await publicClient.getCode({ address: ctx.wallet.address }).then(code => code === undefined || code === '0x' || code.toLowerCase().startsWith('0xef0100')))
  const account = (await rootOf(ctx)).account
  const landed = carried === null || !('sent' in carried) ? carried : await sentLanding(ctx, carried.sent, account)
  if (landed !== null && carried !== null && 'sent' in carried) {
    if ('batch' in carried.sent) onTx?.('approve', { ...landed, account: ctx.wallet.address })
    onTx?.('fund', landed)
  }
  if (landed !== null) {
    const sent = await publicClient.getTransaction({ hash: landed.txHash })
    const ours =
      commits &&
      isAddressEqual(sent.from, ctx.wallet.address) &&
      sent.input.toLowerCase().includes(signerCommitment(await keysOf(ctx).signerOf(ctx.wallet.address)).slice(2).toLowerCase())
    return { block: landed.block, funding: ours ? landed.txHash : null }
  }
  const delivered = leg.inputToken
  const amount = leg.inputAmount
  const value = draft.nativeValue
  const pull = amount - value
  const pulled = isAddressEqual(delivered, PROTOCOL.nativeToken) ? wrappedNativeAddressOf(chainId) : delivered
  const escrowHere = draft.toEscrow && BigInt(chainId) === leg.destinationChainId
  const wallet = await ctx.wallet.switchChain(chainId)
  const [nativeBalance, pulledBalance] = await Promise.all([
    publicClient.getBalance({ address: ctx.wallet.address }),
    fetchTokenBalance(publicClient, pulled, ctx.wallet.address)
  ])
  if (nativeBalance < value || pulledBalance < pull) {
    throw new Error(
      `this deposit sends ${value} native and ${pull} of ${pulled} on chain ${chainId}, and the wallet now holds ${nativeBalance} native and ${pulledBalance} of ${pulled}; refresh and retry, or lower the amount`
    )
  }
  const spender = deploymentAddress('Deposit', chainId)
  const approving =
    pull > 0n && (await readContract(publicClient, { address: pulled, abi: erc20Abi, functionName: 'allowance', args: [ctx.wallet.address, spender] })) < pull
  const gate = deploymentAddress(chainId === HUB_CHAIN_ID ? 'HubGate' : 'SpokeGate', chainId)
  const data = concat([
    encodeFunctionData({ abi: spokegateAbi, functionName: escrowHere ? 'depositEscrow' : 'deposit', args: [escrowHere ? providerToken(leg.outputToken, chainId) : delivered, amount] }),
    commits ? signerCommitment(await keysOf(ctx).signerOf(ctx.wallet.address)) : '0x'
  ])
  const atomic = approving
    ? await getCapabilities(wallet).then(
        capabilities => ({ ...capabilities[0], ...capabilities[chainId] }).atomic?.status,
        () => undefined
      )
    : undefined
  const batch =
    atomic === 'supported' || atomic === 'ready'
      ? await sendCalls(wallet, {
          chain: wallet.chain,
          forceAtomic: true,
          calls: [
            { to: pulled, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, pull] }) },
            { to: gate, data, value }
          ]
        }).catch((err: unknown) => {
          if (err instanceof BaseError && err.walk(e => e instanceof AtomicReadyWalletRejectedUpgradeError || e instanceof AtomicityNotSupportedError || e instanceof UnsupportedChainIdError) !== null) return null
          throw err
        })
      : null
  if (batch !== null) {
    onTx?.('fund', { sent: { chainId, batch: batch.id } })
    const { status, receipts } = await waitForCallsStatus(wallet, { id: batch.id, timeout: WALLET_SETTLE_TIMEOUT_MS }).catch((err: unknown) => {
      if (!(err instanceof WaitForCallsStatusTimeoutError)) throw err
      throw new Error(
        `Your wallet's batch ${batch.id} has not confirmed on ${chainNameOf(chainId) ?? `chain ${chainId}`} after ${WALLET_SETTLE_TIMEOUT_MS / 60_000} minutes. It may still land, so check it in your wallet before submitting again.`
      )
    })
    const landed = receipts === undefined ? undefined : receipts[receipts.length - 1]
    if (status !== 'success' || landed === undefined || landed.status !== 'success') {
      throw new Error(
        `Approving and ${escrowHere ? 'escrowing' : 'depositing'} ${readableTokenAmountLabel(getTokenDescription(chainId, delivered), amount)} in one batch did not land on ${chainNameOf(chainId) ?? `chain ${chainId}`} (status ${status}); nothing moved, retry from a fresh quote.`
      )
    }
    const sender = (await publicClient.getTransaction({ hash: landed.transactionHash })).from
    onTx?.('approve', { chainId, account: ctx.wallet.address, block: landed.blockNumber, txHash: landed.transactionHash })
    onTx?.('fund', { chainId, account, block: landed.blockNumber, txHash: landed.transactionHash })
    return { block: landed.blockNumber, funding: commits && isAddressEqual(sender, ctx.wallet.address) ? landed.transactionHash : null }
  }
  if (approving) {
    const approveHash = await writeContract(wallet, {
      address: pulled,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, pull],
      chain: wallet.chain
    })
    const approveReceipt = await walletReceipt(publicClient, chainId, approveHash)
    if (approveReceipt.status !== 'success') {
      throw new Error(`the ${pulled} approval reverted on-chain (tx ${approveReceipt.transactionHash}); nothing moved, retry from a fresh quote`)
    }
    onTx?.('approve', { chainId, account: ctx.wallet.address, block: approveReceipt.blockNumber, txHash: approveReceipt.transactionHash })
  }
  const hash = await sendTransaction(wallet, { chain: wallet.chain, to: gate, data, value })
  onTx?.('fund', { sent: { chainId, hash } })
  const receipt = await walletReceipt(publicClient, chainId, hash)
  if (receipt.status !== 'success') {
    throw new Error(
      `${escrowHere ? 'Escrowing' : 'Funding your account with'} ${readableTokenAmountLabel(getTokenDescription(chainId, delivered), amount)} reverted on chain (tx ${receipt.transactionHash}); nothing moved, retry from a fresh quote.`
    )
  }
  onTx?.('fund', { chainId, account, block: receipt.blockNumber, txHash: receipt.transactionHash })
  return { block: receipt.blockNumber, funding: commits ? receipt.transactionHash : null }
}

const ESCROW_BRIDGE_DEADLINE_SEC = 120
const ESCROW_FILL_WINDOW_SEC = 300
const ESCROW_FIRE_MARGIN_SEC = 60n
const ESCROW_POLL_MS = 3_000
const BRIDGE_FILL_FLOOR_MS = 30_000
function bridgeFillTimeoutMs(fillDeadlineSec: number): number {
  const untilDeadline = Math.floor(fillDeadlineSec * 1000) - Date.now()
  return Math.max(BRIDGE_FILL_FLOOR_MS, untilDeadline)
}

const VENUE_ARRIVAL_WAIT_MS = 30 * 60_000
const VENUE_ARRIVAL_POLL_MS = 10_000


const REDEEM_CLOSE_WAIT_MS = 30 * 60 * 1000

export async function awaitRedeemClosed(deps: Pick<IClientDeps, 'clients'>, master: Address, fromBlock: bigint): Promise<ISettledTx> {
  const client = clientOf(deps, HUB_CHAIN_ID)
  const entry = ACCOUNT_CALL_MAP.Redeem.redeemCohortMaster
  return awaitWhile(
    {
      timeoutMs: REDEEM_CLOSE_WAIT_MS,
      pollMs: 3_000,
      timeoutMessage: `the attestor did not finish paying the redemption of ${master} within ${REDEEM_CLOSE_WAIT_MS / 60_000} minutes; it keeps paying it from where it stopped`
    },
    async () => {
      const logs = await client.getLogs({
        address: deploymentAddress('AccountModule', HUB_CHAIN_ID),
        event: accountCallEvent,
        args: { account: master },
        fromBlock
      })
      const closed = logs.find(log => {
        const data = log.args.executionData
        if (data === undefined || data.slice(0, 10) !== entry.selector || (data.length - 2) / 2 !== entry.size) return false
        const values = decodeAbiParameters([{ type: 'bytes4', name: 'selector' }, ...entry.args], data)
        return (values[3] as IFundStore__Redemption).owedLeft === 0n
      })
      return closed === undefined ? undefined : { chainId: HUB_CHAIN_ID, account: master, block: closed.blockNumber, txHash: closed.transactionHash }
    }
  )
}

const SWAP_REQUOTE_TOLERANCE_BPS = 500n
const REDEEM_REQUOTE_TOLERANCE_BPS = 20n
const belowReviewedFloor = (reviewedMinOut: bigint, requotedOutput: bigint, toleranceBps: bigint): boolean =>
  reviewedMinOut > 0n && requotedOutput < (reviewedMinOut * (10000n - toleranceBps)) / 10000n

async function requoteRoute<TRoute extends IWithdrawRoute>(
  ctx: ExecContext,
  chainId: ChainId,
  depositor: Address,
  recipient: Address,
  leg: { inputToken: Address; outputToken: Address; inputAmount: bigint; outputAmount: bigint; destinationChainId: bigint; route: TRoute; fillDeadline: number },
  feeOf: (route: IWithdrawRoute) => bigint,
  toleranceBps: bigint
): Promise<{ route: TRoute | ISwapRoute; outputAmount: bigint; fillDeadline: number; relayFee: bigint }> {
  const reviewed: IWithdrawRoute = leg.route
  if (reviewed.kind === 'transfer') return { route: leg.route, outputAmount: leg.outputAmount, fillDeadline: leg.fillDeadline, relayFee: feeOf(reviewed) }
  const quote = async (relayFee: bigint): Promise<{ route: ISwapRoute; outputAmount: bigint; fillDeadline: number }> => {
    const net = leg.inputAmount - relayFee
    if (net <= 0n) {
      const unit = getTokenDescription(chainId, leg.inputToken)
      throw new Error(`The ${readableTokenAmountLabel(unit, relayFee)} relay fee takes all of the ${readableTokenAmountLabel(unit, leg.inputAmount)} you are moving; raise the amount.`)
    }
    const request = { chainId, destinationChainId: leg.destinationChainId, inputToken: leg.inputToken, outputToken: leg.outputToken, inputAmount: net }
    if (reviewed.kind === 'across') return quoteAcrossDeposit(ctx.swapEndpoints.across, recipient, { ...request, timing: await ctx.context.getAcrossTiming(chainId) })
    const settled = await Promise.allSettled(quoteSwapRoutes(ctx.swapEndpoints, depositor, recipient, request, () => ctx.context.getAcrossTiming(chainId)).map(candidate => candidate.plan))
    const same = settled
      .flatMap(s => (s.status === 'fulfilled' ? [s.value] : []))
      .find(plan => plan.route.kind === reviewed.kind && (plan.route.kind !== 'swap' || (reviewed.kind === 'swap' && isAddressEqual(plan.route.provider, reviewed.provider))))
    if (same === undefined) {
      const reasons = settled.flatMap(s => (s.status === 'rejected' ? [s.reason instanceof CompactError ? s.reason.detail : s.reason instanceof Error ? s.reason.message : String(s.reason)] : []))
      throw new CompactError('ROUTE_UNAVAILABLE', `the provider of the route you reviewed no longer quotes it${reasons.length === 0 ? '' : ` (${[...new Set(reasons)].join(' · ')})`}; refresh and retry`)
    }
    return same
  }
  const reviewedFee = feeOf(reviewed)
  const first = await quote(reviewedFee)
  const relayFee = feeOf(first.route) > reviewedFee ? feeOf(first.route) : reviewedFee
  const fresh = relayFee === reviewedFee ? first : await quote(relayFee)
  if (feeOf(fresh.route) > relayFee) throw new Error('the route asks for more gas each time it is quoted than its relay fee covers; refresh and retry')
  if (fresh.outputAmount === 0n || belowReviewedFloor(leg.outputAmount, fresh.outputAmount, toleranceBps)) {
    throw new Error('the route re-quoted materially below the output you reviewed; refresh and retry')
  }
  return { route: fresh.route, outputAmount: fresh.outputAmount, fillDeadline: fresh.fillDeadline, relayFee }
}

async function runSwapStep(
  kind: 'depositAcross' | 'fundSwap',
  leg: IDepositLeg & { route: ISwapRoute },
  account: Address,
  ctx: ExecContext,
  fundedAt: bigint | null,
  toleranceBps: bigint,
  fillWindowSec: number | null,
  onTx?: IReportWalletTx
): Promise<{ swapped: IAttestation; deposit: NonNullable<ReturnType<typeof acrossDepositOf>> | null }> {
  const chainId = resolveDispatchChainId(leg.chainId)
  const token = leg.inputToken
  const publicClient = clientOf(ctx, chainId)
  const wnt = wrappedNativeAddressOf(chainId)
  const destChainId = resolveDispatchChainId(Number(leg.destinationChainId))
  const genesis = await genesisFor(ctx, account, chainId)
  const binding = genesis.key !== '0x'
  const carriesGenesis = isAddressEqual(genesis.parent, zeroAddress) ? fundedAt === null && (await createsAccount(ctx, chainId)) : binding
  const [convert, nonce] = await Promise.all([ctx.context.getFeeConverter(chainId, token, RELAY_RATE_MAX_STALE_MS), envelopeNonce(ctx, account, chainId)])
  const { relayFee, ...fresh } = await requoteRoute(
    ctx,
    chainId,
    account,
    account,
    leg,
    route => relayFeeOf(convert, chainId, kind, carriesGenesis, 0n, routeSubcallGas(route), routeCalldataBytes(route)),
    toleranceBps
  )
  const quoteExpiry = routeQuoteExpiry(fresh.route, await ctx.context.getAcrossTiming(chainId))
  if (fillWindowSec !== null && fresh.route.kind !== 'across') {
    throw new Error('an escrow lands only from a plain Across bridge of the same token, whose fill deadline its one signature outlives')
  }
  const swapHeader = intentHeader(
    ctx,
    kind === 'fundSwap' || routeSwaps(fresh.route),
    account,
    nonce,
    token,
    relayFee,
    fillWindowSec === null ? quoteExpiry : Math.min(quoteExpiry ?? Number.POSITIVE_INFINITY, Math.floor(Date.now() / 1000) + ESCROW_BRIDGE_DEADLINE_SEC)
  )
  const input: IDepositSwapInput = {
    chainId,
    inputToken: token,
    outputToken: leg.outputToken,
    inputAmount: leg.inputAmount,
    outputAmount: fresh.outputAmount,
    destinationChainId: leg.destinationChainId,
    route: fresh.route,
    fillDeadline: fillWindowSec === null ? fresh.fillDeadline : Number(swapHeader.deadline) + fillWindowSec,
    header: swapHeader
  }
  const fusedTokens = [...new Set([token, PROTOCOL.nativeToken, wnt].map(each => getAddress(each)))]
  const balances = new Map(
    await Promise.all(fusedTokens.map(async each => [each, await fetchTokenBalance(publicClient, each, account)] as const))
  )
  const header = binding ? null : { user: getAddress(ctx.wallet.address), nonce }
  const timing = await ctx.context.getAcrossTiming(chainId)
  const { intent, typedData } =
    kind === 'depositAcross'
      ? await attestDepositSwap({ chainId, now: BigInt(Math.floor(Date.now() / 1000)), account: header, genesis, balances, timing }, input)
      : await attestFundSwapIntent({ chainId, now: BigInt(Math.floor(Date.now() / 1000)), account: header, genesis, balance: balances.get(getAddress(token))!, timing }, input)
  await screenSwapValue(ctx.getRate, ctx.clients, await publicClient.getBlockNumber(), {
    routeKind: input.route.kind,
    chainId,
    inputToken: input.inputToken,
    outputToken: input.outputToken,
    destinationChainId: Number(input.destinationChainId),
    inputAmount: input.inputAmount,
    outputAmount: input.outputAmount,
    relayFee
  })
  const swapped = await dispatch(kind, chainId, input, intent, typedData, ctx, genesis)
  onTx?.('swap', { chainId, account: swapped.result.account, block: swapped.settledBlock, txHash: swapped.result.txHash })
  if (destChainId === chainId) return { swapped, deposit: null }
  const receipt = await publicClient.getTransactionReceipt({ hash: swapped.result.txHash })
  const call = accountCallsFromReceipt(chainId, receipt).find(c => isAddressEqual(c.account, account) && c.digest === swapped.digest)
  if (call === undefined) throw new Error(`transaction ${receipt.transactionHash} on chain ${chainId} carries no AccountCall ${swapped.digest} for ${account}`)
  const deposit = acrossDepositOf({ chainId, account, siblingLogs: receipt.logs, logIndex: call.logIndex })
  if (deposit === null) throw new Error(`the ${kind} ${receipt.transactionHash} on chain ${chainId} emitted no Across deposit from ${account}, so its arrival on chain ${destChainId} cannot be followed`)
  return { swapped, deposit }
}

const FILLED_RELAY_EVENT = parseAbiItem(
  'event FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 exclusiveRelayer, bytes32 indexed relayer, bytes32 depositor, bytes32 recipient, bytes32 messageHash, (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType) relayExecutionInfo)'
)
const FILL_LOOKBACK_BLOCKS = 2_000n

async function awaitBridgeFill(ctx: ExecContext, chainId: ChainId, deposit: NonNullable<ReturnType<typeof acrossDepositOf>>): Promise<ISettledTx> {
  const destChainId = resolveDispatchChainId(Number(deposit.destinationChainId))
  const destination = clientOf(ctx, destChainId)
  const spokePool = acrossSpokePoolOf(destChainId)
  const head = await destination.getBlockNumber()
  await awaitWhile(
    {
      timeoutMs: bridgeFillTimeoutMs(deposit.fillDeadline),
      pollMs: 2_000,
      timeoutMessage: `the bridge did not deliver on chain ${destChainId} within its fill deadline; if the fill failed, the funds return as a refund on the origin chain or as the bridged input token on the destination, and either way they show in your Balances`
    },
    async () => {
      const status = await readContract(destination, {
        address: spokePool,
        abi: SPOKE_POOL_ABI,
        functionName: 'fillStatuses',
        args: [deposit.relayHash]
      })
      return status === ACROSS_FILLED ? status : undefined
    }
  )
  const [fill] = await destination.getLogs({
    address: spokePool,
    event: FILLED_RELAY_EVENT,
    args: { originChainId: BigInt(chainId), depositId: deposit.depositId },
    fromBlock: head > FILL_LOOKBACK_BLOCKS ? head - FILL_LOOKBACK_BLOCKS : 0n
  })
  if (fill === undefined) throw new Error(`Across marks deposit ${deposit.depositId} from chain ${chainId} filled on chain ${destChainId}, but its FilledRelay is not in the blocks searched`)
  return { chainId: destChainId, account: getAddress(slice(deposit.recipient, 12)), block: fill.blockNumber, txHash: fill.transactionHash }
}

const accountBalance = (ctx: ExecContext, chainId: ChainId, token: Address): Promise<bigint> =>
  fetchTokenBalance(clientOf(ctx, chainId), token, predictUserAccount(ctx.wallet.address))

const HUB_FEE_TOKENS: readonly Address[] = [HUB_CANONICAL_TOKEN.WETH, PROTOCOL.nativeToken, HUB_CANONICAL_TOKEN.USDC, HUB_CANONICAL_TOKEN.USDT]

async function runWithdrawStep(leg: IUnsealed<IWithdrawInput>, account: Address, sourceChainId: ChainId, ctx: ExecContext): Promise<IAttestation> {
  const chainId = resolveDispatchChainId(sourceChainId)
  const token = leg.inputToken
  const publicClient = clientOf(ctx, chainId)
  const [creates, convert, nonce] = await Promise.all([
    createsAccount(ctx, chainId),
    ctx.context.getFeeConverter(chainId, token, RELAY_RATE_MAX_STALE_MS),
    envelopeNonce(ctx, account, chainId)
  ])
  const { relayFee, ...requoted } = await requoteRoute(
    ctx,
    chainId,
    account,
    ctx.wallet.address,
    leg,
    route => relayFeeOf(convert, chainId, 'withdraw', creates, 0n, routeSubcallGas(route), routeCalldataBytes(route)),
    SWAP_REQUOTE_TOLERANCE_BPS
  )
  const input: IWithdrawInput = {
    ...leg,
    ...requoted,
    outputAmount: leg.route.kind === 'transfer' ? leg.inputAmount - relayFee : requoted.outputAmount,
    header: intentHeader(ctx, routeSwaps(requoted.route), account, nonce, leg.inputToken, relayFee)
  }
  const [balance, timing, genesis] = await Promise.all([
    fetchTokenBalance(publicClient, token, account),
    ctx.context.getAcrossTiming(chainId),
    genesisFor(ctx, account, chainId)
  ])
  const { intent, typedData } = await attestWithdrawIntent(
    { chainId, now: BigInt(Math.floor(Date.now() / 1000)), account: { user: getAddress(ctx.wallet.address), nonce }, genesis, balance, timing },
    input
  )
  if (input.route.kind !== 'transfer') {
    await screenSwapValue(ctx.getRate, ctx.clients, await publicClient.getBlockNumber(), {
      routeKind: input.route.kind,
      chainId,
      inputToken: input.inputToken,
      outputToken: input.outputToken,
      destinationChainId: Number(input.destinationChainId),
      inputAmount: input.inputAmount,
      outputAmount: input.outputAmount,
      relayFee
    })
  }
  return dispatch('withdraw', chainId, input, intent, typedData, ctx, genesis)
}

export async function runMandateBatch(drafts: readonly IMandateDraft[], ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const session = await keysOf(ctx).grantSession(ctx.wallet, HUB_CHAIN_ID)
  const mandateList: IMandateLib__Mandate[] = drafts
    .map(d => ({ ...d.mandate, expiry: d.mandate.expiry < session.expiry ? d.mandate.expiry : session.expiry }))
    .sort((a, b) => (BigInt(a.master) < BigInt(b.master) ? -1 : 1))
  if (mandateList.length === 0) throw new Error('a hub broadcast needs at least one mandate')
  const creates = await createsAccount(ctx, HUB_CHAIN_ID)
  const nonce = await envelopeNonce(ctx, account, HUB_CHAIN_ID)
  let paying: [Address, bigint, bigint] | null = null
  for (const token of HUB_FEE_TOKENS) {
    const [balance, fee] = await Promise.all([
      accountBalance(ctx, HUB_CHAIN_ID, token),
      quoteRelayFee(ctx, HUB_CHAIN_ID, 'mandate', creates, token, BigInt(mandateList.length), 0n, 0n)
    ])
    if (balance >= fee) {
      paying = [token, balance, fee]
      break
    }
  }
  if (paying === null) {
    throw new Error(
      `the mandate's relay fee is paid in WETH, ETH, USDC or USDT on ${HUB_CHAIN.name}, and this account holds too little of each; deposit a little of any of them${drafts.some(d => d.mandate.expiry === 0n) ? '. To stop without a fee, Revoke sessions in Sessions ends every mandate, and every session, from your wallet' : ''}`
    )
  }
  const [feeToken, feeBalance, relayFee] = paying
  const epoch = creates ? 0n : await readContract(clientOf(ctx, HUB_CHAIN_ID), { address: account, abi: useraccountAbi, functionName: 'epoch' })
  const intent: IHubGate__MandateIntent = {
    header: intentHeader(ctx, false, account, nonce, feeToken, relayFee),
    epoch,
    mandateList
  }
  const genesis = await genesisFor(ctx, account, HUB_CHAIN_ID)
  const typedData = await attestMandateIntent(
    {
      chainId: HUB_CHAIN_ID,
      account: await headerStateOf(ctx, HUB_CHAIN_ID, nonce),
      genesis,
      epoch,
      feeBalance,
      now: BigInt(Math.floor(Date.now() / 1000))
    },
    intent
  )
  return dispatch('mandate', HUB_CHAIN_ID, intent, intent, typedData, ctx, genesis)
}

export async function quoteOperateFee(deps: Pick<IClientDeps, 'clients' | 'context'>, user: Address, account: Address, chainId: ChainId, feeToken: Address, callList: readonly IIAccount__Call[]): Promise<bigint> {
  const binding = !isAddressEqual(account, predictUserAccount(user)) && (await delegationOf(clientOf(deps, chainId), chainId, account)).module === null
  const priced = withAllowancePolicy(chainId, callList)
  return quoteRelayFee(deps, chainId, 'operate', binding, feeToken, BigInt(priced.length), declaredCallGas(priced), dynamicCalldataBytes(priced.map(call => call.callData)))
}

export async function runOperateStep(draft: IOperateDraft, ctx: ExecContext, upstream: readonly IAttestation[]): Promise<IAttestation> {
  const account = (await fundOf(ctx)).account
  const chainId = draft.chainId
  const publicClient = clientOf(ctx, chainId)
  const genesis = await genesisFor(ctx, account, chainId)
  const binding = genesis.key !== '0x'
  const priced = withAllowancePolicy(chainId, draft.callList)
  const quoteFee = (token: Address): Promise<bigint> =>
    quoteRelayFee(ctx, chainId, 'operate', binding, token, BigInt(priced.length), declaredCallGas(priced), dynamicCalldataBytes(priced.map(call => call.callData)))
  const feeToken: Address =
    draft.feeToken !== 'any'
      ? draft.feeToken
      : await Promise.all(
          listedTokensOf(chainId).map(async token => {
            const held = await fetchTokenBalance(publicClient, token, account)
            return { token, value: held === 0n ? 0n : held * usdPriceFromRate(await ctx.getRate(symbolOf(chainId, token), USD_SYMBOL, DEFAULT_EVALUATION_CONFIG.maxPriceAgeSec * 1000), USD_DECIMALS) }
          })
        ).then(held => {
          const richest = held.reduce((best, each) => (each.value > best.value ? each : best))
          if (richest.value === 0n) throw new Error(`Your fund holds no token on ${chainNameOf(chainId) ?? `chain ${chainId}`} that Puppet prices, so it cannot pay the relay fee there.`)
          return richest.token
        })
  const tokens = [...new Set([...allowanceTokensOf(draft.callList), getAddress(feeToken)])]
  const [nonce, balanceList, blockNumber] = await Promise.all([
    envelopeNonce(ctx, account, chainId),
    Promise.all(tokens.map(token => fetchTokenBalance(publicClient, token, account))),
    fromChain('the latest block', chainId, publicClient.getBlockNumber())
  ])
  const balances = new Map(tokens.map((token, i) => [token, balanceList[i]!] as const))
  const quoted = await quoteFee(feeToken)
  const relayFee = draft.acceptedFee === null || draft.acceptedFee > quoted ? quoted : draft.acceptedFee
  if (relayFee < relayFeeFloor(chainId, feeToken, quoted)) {
    const unit = getTokenDescription(chainId, feeToken)
    throw new Error(
      `The relay fee rose to ${readableTokenAmountLabel(unit, quoted)} since you approved ${readableTokenAmountLabel(unit, relayFee)}; send the request again from the dApp to approve the new fee.`
    )
  }
  let callList = draft.callList
  if (draft.sweepInto !== null) {
    const venue = VENUES.find(v => v.venueId === draft.sweepInto)
    const deposit = venue?.deposit
    if (venue === undefined || deposit === undefined || deposit.chainId !== chainId || !isAddressEqual(deposit.token, feeToken)) {
      throw new Error(`${draft.sweepInto} takes no deposit of ${feeToken} on chain ${chainId}`)
    }
    const token = getAddress(feeToken)
    const unit = getTokenDescription(chainId, token)
    const arrivals = upstream.flatMap(step =>
      step.request.kind === 'fundSwap' && resolveDispatchChainId(Number(step.request.intent.destinationChainId)) === chainId && isAddressEqual(step.request.intent.swap.outputToken, token)
        ? [step.request.intent.swap.outputAmount]
        : []
    )
    const cap =
      arrivals.length > 0
        ? arrivals.reduce((total, amount) => total + amount, 0n)
        : operateOutflows(account, draft.callList).reduce((total, flow) => (isAddressEqual(flow.token, token) ? total + flow.amount : total), 0n) +
          (operateExchange(chainId, account, draft.callList).spent.get(token) ?? 0n)
    if (cap === 0n) throw new Error(`the ${venue.name} deposit names no ${unit.symbol} to move`)
    const held = balances.get(token)! - relayFee
    const swept = held < cap ? held : cap
    if (swept < deposit.min) {
      throw new Error(
        `${venue.name} takes deposits of at least ${readableTokenAmountLabel(unit, deposit.min)}, but only ${readableTokenAmountLabel(unit, swept > 0n ? swept : 0n)} is left to deposit after the ${readableTokenAmountLabel(unit, relayFee)} relay fee; it stays in your fund's balance.`
      )
    }
    callList = deposit.callsOf(account, swept)
  }
  const policed = withAllowancePolicy(chainId, callList)
  const intent: ISpokeGate__OperateIntent = {
    header: intentHeader(ctx, operateExchange(chainId, account, policed).received.size > 0, account, nonce, feeToken, relayFee),
    callList: policed,
    tokenList: operateTokenList({ chainId }, account, feeToken, policed)
  }
  const typedData = await attestOperateIntent(
    {
      chainId,
      now: BigInt(Math.floor(Date.now() / 1000)),
      account: binding ? null : { user: getAddress(ctx.wallet.address), nonce },
      genesis,
      clients: { ...ctx.clients, ...ctx.venueClients },
      blockNumber,
      getRate: ctx.getRate,
      balances
    },
    intent
  )
  return dispatch('operate', chainId, intent, intent, typedData, ctx, genesis)
}

export const OPERATE_SWAP_SLIPPAGE_BPS = 50n

async function runOperateSwapStep(draft: IOperateSwapDraft, ctx: ExecContext, upstream: readonly IAttestation[], onWalletTx?: IReportWalletTx): Promise<IAttestation> {
  const pinned = UNISWAP_POOLS[draft.chainId]
  if (pinned === undefined) throw new Error(`no Uniswap pools are pinned on ${chainNameOf(draft.chainId) ?? `chain ${draft.chainId}`}, so the swap cannot be quoted`)
  const publicClient = clientOf(ctx, draft.chainId)
  const blockNumber = await fromChain('the latest block', draft.chainId, publicClient.getBlockNumber())
  const quotes = await uniswapQuotes(publicClient, pinned, draft.inputToken, await uniswapPools(publicClient, pinned, draft.chainId, draft.inputToken, blockNumber), draft.inputAmount, blockNumber)
  const quote = quotes.find(each => isAddressEqual(each.token, draft.outputToken) && each.fee === draft.poolFee)
  if (quote === undefined) throw new Error('the Uniswap pool you reviewed no longer takes this swap; open Swap again')
  const floor = (quote.quoted * (PRECISION.basisPoints - OPERATE_SWAP_SLIPPAGE_BPS)) / PRECISION.basisPoints
  const swapCalls = uniswapSwapCalls(draft.chainId, draft.inputToken, draft.inputAmount, quote, floor)
  if (draft.bridge === null) {
    if (belowReviewedFloor(draft.outputAmount, quote.quoted, SWAP_REQUOTE_TOLERANCE_BPS)) {
      throw new Error('the swap re-quoted materially below the output you reviewed; refresh and retry')
    }
    return runOperateStep({ kind: 'operate', id: draft.id, chainId: draft.chainId, feeToken: draft.outputToken, callList: swapCalls, sweepInto: null, acceptedFee: null }, ctx, upstream)
  }
  const reviewed = draft.bridge
  const account = (await fundOf(ctx)).account
  await assertNoOpenTransit(ctx, account)
  const relayFee = await quoteOperateFee(ctx, ctx.wallet.address, account, draft.chainId, draft.outputToken, [
    ...swapCalls,
    ...acrossBridgeCalls(draft.chainId, account, draft.outputToken, reviewed)
  ])
  const unit = getTokenDescription(draft.chainId, draft.outputToken)
  if (relayFee >= floor) {
    throw new Error(`the swap returns at least ${readableTokenAmountLabel(unit, floor)}, which the ${readableTokenAmountLabel(unit, relayFee)} relay fee takes whole; raise the amount`)
  }
  const fresh = await quoteAcrossDeposit(ctx.swapEndpoints.across, account, {
    chainId: draft.chainId,
    destinationChainId: BigInt(reviewed.destinationChainId),
    inputToken: draft.outputToken,
    outputToken: reviewed.outputToken,
    inputAmount: floor - relayFee,
    timing: await ctx.context.getAcrossTiming(draft.chainId)
  })
  if (fresh.isAmountTooLow) {
    throw new Error(`Across bridges at least ${readableTokenAmountLabel(unit, fresh.limits.minDeposit)}, and only ${readableTokenAmountLabel(unit, floor - relayFee)} is left after the swap's slippage bound and the relay fee; raise the amount`)
  }
  if (belowReviewedFloor(reviewed.outputAmount, fresh.outputAmount, SWAP_REQUOTE_TOLERANCE_BPS)) {
    throw new Error('the swap and bridge re-quoted materially below the output you reviewed; refresh and retry')
  }
  const bridged = await runOperateStep(
    {
      kind: 'operate',
      id: draft.id,
      chainId: draft.chainId,
      feeToken: draft.outputToken,
      callList: [
        ...swapCalls,
        ...acrossBridgeCalls(draft.chainId, account, draft.outputToken, {
          inputAmount: floor - relayFee,
          destinationChainId: reviewed.destinationChainId,
          outputToken: reviewed.outputToken,
          outputAmount: fresh.outputAmount,
          route: fresh.route,
          fillDeadline: fresh.fillDeadline
        })
      ],
      sweepInto: null,
      acceptedFee: relayFee
    },
    ctx,
    upstream
  )
  const receipt = await publicClient.getTransactionReceipt({ hash: bridged.result.txHash })
  const call = accountCallsFromReceipt(draft.chainId, receipt).find(c => isAddressEqual(c.account, account) && c.digest === bridged.digest)
  if (call === undefined) throw new Error(`transaction ${receipt.transactionHash} on chain ${draft.chainId} carries no AccountCall ${bridged.digest} for ${account}`)
  const deposit = acrossDepositOf({ chainId: draft.chainId, account, siblingLogs: receipt.logs, logIndex: call.logIndex })
  if (deposit === null) {
    throw new Error(`the swap ${receipt.transactionHash} on chain ${draft.chainId} emitted no Across deposit from ${account}, so its arrival on chain ${reviewed.destinationChainId} cannot be followed`)
  }
  await awaitBridgeFill(ctx, draft.chainId, deposit).catch((error: unknown) => {
    if (onWalletTx === undefined) throw error
    onWalletTx('operate', { missed: error instanceof Error ? error.message : String(error) })
  })
  return bridged
}

async function runSellStep(draft: ISellDraft, ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const hub = clientOf(ctx, HUB_CHAIN_ID)
  const block = await fromChain('the latest block', HUB_CHAIN_ID, hub.getBlockNumber())
  const [fund, nonce, holders] = await Promise.all([
    fundRowOf(ctx, draft.master).then(row => readFundState(ctx, row, block)),
    envelopeNonce(ctx, account, HUB_CHAIN_ID),
    readHolderStates(ctx, draft.master, draft.shareToken, [account], block)
  ])
  const holder = holders.get(getAddress(account))!
  for (const feeToken of HUB_FEE_TOKENS) {
    const [feeBalance, relayFee] = await Promise.all([accountBalance(ctx, HUB_CHAIN_ID, feeToken), quoteRelayFee(ctx, HUB_CHAIN_ID, 'sell', false, feeToken, 0n, 0n, 0n)])
    const intent: IRedeem__SellIntent = {
      header: intentHeader(ctx, false, account, nonce, feeToken, relayFee),
      shareToken: draft.shareToken,
      shares: draft.shares
    }
    let typedData: TypedDataDefinition
    try {
      typedData = attestSellIntent(
        {
          chainId: HUB_CHAIN_ID,
          now: BigInt(Math.floor(Date.now() / 1000)),
          account: { user: getAddress(ctx.wallet.address), nonce },
          master: draft.master,
          fund,
          holder,
          feeBalance
        },
        intent
      )
    } catch (err) {
      if (err instanceof CompactError && err.code === 'FEE_UNFUNDED') continue
      throw err
    }
    return dispatch('sell', HUB_CHAIN_ID, intent, intent, typedData, ctx)
  }
  throw new Error(`the sell's relay fee is paid in WETH, ETH, USDC or USDT on ${HUB_CHAIN.name}, and this account holds too little of each, even with what the sale settles; deposit a little of any of them`)
}

const REDEEM_TOP_UPS = 2
const HUB_CATCH_UP_MS = 60_000

async function runEscrowLandingStep(chainId: ChainId, token: Address, landed: bigint, ctx: ExecContext, onTx?: IReportWalletTx): Promise<IAttestation> {
  const user = getAddress(ctx.wallet.address)
  const account = predictUserAccount(user)
  const [nonce, balance, creates] = await Promise.all([
    envelopeNonce(ctx, account, chainId),
    fetchTokenBalance(clientOf(ctx, chainId), token, account),
    createsAccount(ctx, chainId)
  ])
  const fee = await quoteRelayFee(ctx, chainId, 'retireEscrow', creates, token, 0n, 0n, 0n)
  if (landed <= fee) {
    throw new Error(`your account holds ${landed} of ${token} to escrow on chain ${chainId}, which does not cover the ${fee} fee of escrowing it; it stays in your account there`)
  }
  const intent: ILiquidityGate__RetireEscrowIntent = { header: intentHeader(ctx, false, account, nonce, token, fee), token, amount: landed - fee }
  const typedData = attestRetireEscrowIntent({ chainId, now: BigInt(Math.floor(Date.now() / 1000)), account: { user, nonce }, balances: new Map([[getAddress(token), balance]]) }, intent)
  const escrowed = await dispatch('retireEscrow', chainId, intent, intent, typedData, ctx)
  onTx?.('retireEscrow', { chainId, account, block: escrowed.settledBlock, txHash: escrowed.result.txHash })
  return escrowed
}

async function runRedeemStep(draft: IRedeemDraft, ctx: ExecContext, onTx?: IReportWalletTx): Promise<IAttestation[]> {
  const master = (await fundOf(ctx)).account
  await requireFolded(ctx, HUB_CHAIN_ID, master)
  const fundRow = await fundRowOf(ctx, master)
  const shareToken = getAddress(fundRow.shareToken)
  const hub = clientOf(ctx, HUB_CHAIN_ID)
  const user = getAddress(ctx.wallet.address)
  const token = getAddress(draft.token)
  const wrappable = isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH)
  let fraction = draft.fraction
  const prepare = async (landedAt: bigint) => {
    const block = await awaitWhile(
      { timeoutMs: HUB_CATCH_UP_MS, pollMs: 1_000, timeoutMessage: `chain ${HUB_CHAIN_ID} has not reached block ${landedAt}, where the bridge delivered; retry in a moment` },
      async () => {
        const head = await fromChain('the latest block', HUB_CHAIN_ID, hub.getBlockNumber())
        return head >= landedAt ? head : undefined
      }
    )
    const [fund, held, native, book, convert, nonce, genesis] = await Promise.all([
      readFundState(ctx, fundRow, block),
      readContract(hub, { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [master], blockNumber: block }),
      hub.getBalance({ address: master, blockNumber: block }),
      readFundBook(ctx, master),
      ctx.context.getFeeConverter(HUB_CHAIN_ID, token, RELAY_RATE_MAX_STALE_MS),
      envelopeNonce(ctx, master, HUB_CHAIN_ID),
      genesisFor(ctx, master, HUB_CHAIN_ID)
    ])
    if (isOpen(fund.redemption)) throw new Error(`redemption ${fund.redemption.id} of your fund is still paying out; resume it from Redeem before opening another`)
    const holders = await readHolderStates(ctx, master, shareToken, book.holdings.map(holding => getAddress(holding.holder)), block)
    const planAt = (valuation: IFund__Valuation, fee: bigint) => {
      const line = payoutLineOf(valuation.assetList, token)
      return planRedeem({
        supply: fund.supply,
        masterBalance: fund.masterShares,
        redemption: fund.redemption,
        fraction,
        join: draft.join,
        valuation: valuationOf(valuation),
        token,
        price: line === null ? null : { amount: line.amount, value: line.value },
        held,
        native,
        fee
      })
    }
    const compose = () => approverFor(ctx, HUB_CHAIN_ID).then(approve => requestValuation(ctx.matchmakerUrl, master, shareToken, token, { user, approve }, null))
    const appraise = async (): Promise<IFund__Valuation> => {
      const composed = await compose()
      return redeemValuationOf({ valuation: composed.valuation, token, fraction, planOf: () => planAt(composed.valuation, 0n), performanceFee: fund.performanceFee })
    }
    const feeOf = (valuation: IFund__Valuation): bigint => redeemFeeFor(convert, claimantsOf(master, holders, fraction), planAt(valuation, 0n))
    return { fund, held, native, holders, convert, nonce, genesis, compose, appraise, feeOf }
  }
  let ready = await prepare(0n)
  const moved: IAttestation[] = []
  const payoutUnit = getTokenDescription(HUB_CHAIN_ID as ChainId, token)
  const leg = draft.leg
  const relayFeeOf = async (chainId: ChainId, inputToken: Address, route: IRedeemLeg['route'] | null): Promise<bigint> => {
    const dispatchChainId = resolveDispatchChainId(chainId)
    return quoteRelayFee(
      ctx,
      dispatchChainId,
      'fundSwap',
      (await delegationOf(clientOf(ctx, dispatchChainId), dispatchChainId, master)).module === null,
      inputToken,
      0n,
      route === null ? TYPICAL_SUBCALL_GAS : routeSubcallGas(route),
      route === null ? 0n : routeCalldataBytes(route)
    )
  }
  const bridge = async (gross: bigint, relayFee: bigint): Promise<void> => {
    if (leg === null) throw new Error('this redeem has no bridge route; reopen Redeem to size it again')
    const routed = gross - relayFee
    const { swapped, filled } = await runFundSwapStep(
      {
        kind: 'fundSwap',
        id: draft.id,
        chainId: leg.chainId,
        destinationChainId: HUB_CHAIN_ID as ChainId,
        inputToken: leg.inputToken,
        outputToken: token,
        inputAmount: gross,
        routeInput: routed,
        outputAmount: (leg.outputAmount * routed) / leg.routeInput,
        expectedOutput: (leg.expectedOutput * routed) / leg.routeInput,
        route: leg.route,
        fillDeadline: leg.fillDeadline
      },
      ctx,
      REDEEM_REQUOTE_TOLERANCE_BPS
    )
    onTx?.('fundSwap', { chainId: leg.chainId, account: master, block: swapped.settledBlock, txHash: swapped.result.txHash })
    moved.push(swapped)
    ready = await prepare(filled === null ? swapped.settledBlock : filled.block)
  }
  const source = draft.source
  if (source !== null && source.chainId !== HUB_CHAIN_ID && tokenKeyOf(source.chainId, source.token) === tokenKeyOf(HUB_CHAIN_ID, token)) {
    if (leg === null) throw new Error('this redeem was drafted without its bridge route; reopen Redeem to size it again')
    const unit = getTokenDescription(source.chainId, source.token)
    const sizing = async (at: bigint | null) => {
      const [balance, composed, convert, relayFee] = await Promise.all([
        fetchTokenBalance(clientOf(ctx, source.chainId), source.token, master),
        ready.compose(),
        ctx.context.getFeeConverter(source.chainId, source.token, RELAY_RATE_MAX_STALE_MS),
        relayFeeOf(source.chainId, source.token, leg.route)
      ])
      const budget = at === null && !source.whole ? source.amount : balance
      if (budget > balance) {
        throw new Error(
          `the fund holds ${readableTokenAmountLabel(unit, balance)} on chain ${source.chainId}, less than the ${readableTokenAmountLabel(unit, budget)} this redeem drafted; reopen Redeem to size it again`
        )
      }
      const line =
        payoutLineOf(composed.valuation.assetList, token) ??
        composed.valuation.assetList.find(asset => Number(asset.chainId) === source.chainId && isAddressEqual(asset.token, source.token) && asset.id === 0n && asset.amount > 0n)
      const price = wrappable ? { amount: 1n, value: 1n } : line === undefined ? null : { amount: line.amount, value: line.value }
      if (price === null) throw new Error(`the attestor's valuation prices no ${payoutUnit.symbol} to pay out in`)
      const input: IRedeemSizeInput = {
        fund: ready.fund,
        valuation: composed.valuation,
        token,
        price,
        convert: ready.convert,
        claimants: each => claimantsOf(master, ready.holders, each),
        hub: { held: ready.held, native: ready.native },
        source: { chainId: source.chainId, token: source.token, amount: budget },
        leg: budget > relayFee ? { relayFee, input: leg.routeInput, output: leg.outputAmount, least: convert(CROSS_CHAIN_MIN_USD * 10n ** BigInt(USD_DECIMALS)), price } : null
      }
      return { sized: at === null ? sizeRedeem(input) : sizeRedeemAt(input, at), relayFee, budget }
    }
    const initial = await sizing(null)
    fraction = initial.sized.fraction
    if (initial.sized.leg !== null) await bridge(initial.sized.leg.gross, initial.relayFee)
    for (let round = 1; initial.sized.leg !== null && !initial.sized.plan.full; round++) {
      const again = await sizing(fraction)
      if (again.sized.leg === null) break
      if (round > REDEEM_TOP_UPS || again.sized.spend > again.budget) {
        const plan = again.sized.plan
        const short = plan.redemption.potLeft + plan.redemption.masterPay - ready.held - (wrappable ? ready.native : 0n)
        throw new Error(
          `the bridge left the hub ${readableTokenAmountLabel(payoutUnit, short)} short of what this redemption pays; ${
            round > REDEEM_TOP_UPS
              ? `${round - 1} top-ups did not cover it`
              : `a top-up needs ${readableTokenAmountLabel(unit, again.sized.spend)} on chain ${source.chainId}, and the fund holds ${readableTokenAmountLabel(unit, again.budget)} there`
          }; reopen Redeem to size it again`
        )
      }
      await bridge(again.sized.leg.gross, again.relayFee)
    }
  } else if (leg !== null) {
    await bridge(leg.inputAmount, await relayFeeOf(leg.chainId, leg.inputToken, leg.route))
  } else if (source !== null && source.chainId === HUB_CHAIN_ID && fraction > 0n && fraction !== PRECISION.basisPoints) {
    const composed = await ready.compose()
    const cash = ready.held + (wrappable ? ready.native : 0n)
    const budget = source.whole ? cash : source.amount
    if (budget > cash) {
      throw new Error(`the fund holds ${readableTokenAmountLabel(payoutUnit, cash)} on ${HUB_CHAIN.name}, less than the ${readableTokenAmountLabel(payoutUnit, budget)} this redeem drafted; reopen Redeem to size it again`)
    }
    const line = payoutLineOf(composed.valuation.assetList, token)
    fraction = sizeRedeem({
      fund: ready.fund,
      valuation: composed.valuation,
      token,
      price: wrappable ? { amount: 1n, value: 1n } : line === null ? null : { amount: line.amount, value: line.value },
      convert: ready.convert,
      claimants: each => claimantsOf(master, ready.holders, each),
      hub: { held: ready.held, native: ready.native },
      source: { chainId: HUB_CHAIN_ID, token, amount: budget },
      leg: null
    }).fraction
  }
  const valuation = await ready.appraise()
  const fee = ready.feeOf(valuation)
  const intent: IRedeem__RedeemIntent = {
    header: intentHeader(ctx, true, master, ready.nonce, token, fee),
    shareToken,
    valuation,
    token,
    fraction,
    join: draft.join
  }
  const { typedData } = await attestRedeemIntent(
    {
      chainId: HUB_CHAIN_ID,
      now: BigInt(Math.floor(Date.now() / 1000)),
      account: { user, nonce: ready.nonce },
      genesis: ready.genesis,
      fund: ready.fund,
      audit: null,
      held: ready.held,
      native: ready.native,
      holders: ready.holders,
      convert: ready.convert
    },
    intent
  )
  const opened = await dispatch('redeem', HUB_CHAIN_ID, intent, intent, typedData, ctx, ready.genesis)
  onTx?.('redeem', { chainId: HUB_CHAIN_ID, account: master, block: opened.settledBlock, txHash: opened.result.txHash })
  return [...moved, opened]
}

async function openingFundOf(ctx: ExecContext): Promise<bigint> {
  const funds = (await rootOf(ctx)).funds
  if ('unknown' in funds) throw new Error(funds.unknown)
  return funds.next
}

async function fundForRound(identity: IFundIdentityDraft | null, funded: { chainId: ChainId; token: Address }, ctx: ExecContext, funding: Hex | null): Promise<IFund> {
  if (identity === null) return fundOf(ctx)
  const fund = await openingFundOf(ctx)
  const keys = keysOf(ctx)
  const held = keys.fundsOf(ctx.wallet.address).find(record => record.fund === fund)
  const account = held !== undefined ? held.account : (await keys.openFund(ctx.wallet, fund, identity.symbol, identity.cells, funded, funding)).account
  keys.selectFund(ctx.wallet.address, account)
  return { account, fund, symbol: identity.symbol, cells: identity.cells }
}

async function fundEscrow(draft: IDepositDraft, ctx: ExecContext, landed: ISettledTx | { sent: ISentTx } | null, onTx?: IReportWalletTx): Promise<IAttestation[]> {
  const leg = draft.deposit
  const chainId = resolveDispatchChainId(leg.chainId)
  if (leg.route !== null) {
    throw new Error('escrow holds what your wallet already has on this chain, in place; a route belongs to a crosschain deposit')
  }
  const token = providerToken(leg.outputToken, chainId)
  const known = (await rootOf(ctx)).fund
  if (known !== null && 'unknown' in known) throw new Error(known.unknown)
  const free = creditableOf(
    await readEscrowCredit(ctx, predictUserAccount(ctx.wallet.address), chainId, token)
  )
  const funded = known !== null || free < leg.outputAmount ? await fundAccount(draft, ctx, landed, onTx) : null
  if (draft.identity !== undefined) {
    const fund = await fundForRound(draft.identity, { chainId, token }, ctx, funded === null ? null : funded.funding)
    onTx?.('key', null)
    await keysOf(ctx).approveFund(ctx.wallet, HUB_CHAIN_ID, fund.account)
    onTx?.('genesis', null)
  }
  return []
}

async function runAllocateStep(draft: IAllocateDraft, record: IFund, ctx: ExecContext, onTx?: IReportWalletTx): Promise<IAttestation> {
  const master = record.account
  const chainId = draft.escrowChainId
  const token = draft.escrowToken
  const booked = providerToken(token, chainId)
  const local = chainId === HUB_CHAIN_ID
  const hubForm = chainTokenOfKey(HUB_CHAIN_ID, tokenKeyOf(chainId, token))
  const roundToken = local ? hubForm : providerToken(hubForm, HUB_CHAIN_ID)
  const where = chainNameOf(chainId) ?? `chain ${chainId}`
  const user = getAddress(ctx.wallet.address)
  const owner = predictUserAccount(user)
  const held = keysOf(ctx).fundsOf(user).find(fund => isAddressEqual(fund.account, master))
  if (held === undefined || !isAddressEqual(publicKeyToAddress(held.share.pk), master)) {
    throw new Error(`this device holds no key share of ${master}; restore the fund's key before allocating, since a round proves the fund's key includes the attestor's half`)
  }
  if (local && draft.contribution > 0n) {
    const open = openEscrowOf(await readEscrowCredit(ctx, owner, HUB_CHAIN_ID, booked))
    if (open < draft.contribution) {
      const [balance, creates] = await Promise.all([accountBalance(ctx, HUB_CHAIN_ID, token), createsAccount(ctx, HUB_CHAIN_ID)])
      const fee = await quoteRelayFee(ctx, HUB_CHAIN_ID, 'retireEscrow', creates, token, 0n, 0n, 0n)
      const short = draft.contribution - open
      const escrowing = balance - fee < short ? balance - fee : short
      if (escrowing > 0n && fee * PRECISION.basisPoints <= escrowing * PROTOCOL.maxRelayFeeBps) await runEscrowLandingStep(HUB_CHAIN_ID, token, escrowing + fee, ctx, onTx)
    }
  }
  let releasedHere = false
  let repriced = false
  const walletSigned = new Map<Hex, Hex>()
  for (;;) {
    const pinned = await fromChain('the latest block', HUB_CHAIN_ID, clientOf(ctx, HUB_CHAIN_ID).getBlock())
    const block = pinned.number
    const fundRowQuery = requireFolded(ctx, HUB_CHAIN_ID, master)
      .then(() => ctx.chronicle.select(fundTable, { where: { master } }))
      .then(rows => rows[0] ?? null)
    const fundQuery = fundRowQuery.then(row => (row === null ? null : readFundState(ctx, row, block)))
    const shareQuery = fundQuery.then(fund =>
      fund === null
        ? predictShare(deploymentAddress('HubGate', HUB_CHAIN_ID), deploymentAddress('ShareToken', HUB_CHAIN_ID), fundProfile(record.symbol, record.cells), master)
        : fund.shareToken
    )
    const [quote, genesis, fund, shareToken, candidates, escrow, nonce, credited, released, bound, epochs, feeReserve, convert] = await Promise.all([
      Promise.all([shareQuery, approverFor(ctx, HUB_CHAIN_ID)]).then(([share, approve]) =>
        requestValuation(ctx.matchmakerUrl, master, share, roundToken, { user, approve }, draft.contribution > 0n ? { chainId, token: booked } : null)
      ),
      genesisFor(ctx, master, HUB_CHAIN_ID, onTx),
      fundQuery,
      shareQuery,
      Promise.all([fundQuery, readFundBook(ctx, master).then(book => readMandateWindow(ctx, book, [roundToken], pinned))])
        .then(([fund, windows]) => readAllocationCandidates(ctx, master, fund === null ? null : fund.shareToken, [roundToken], block, windows))
        .then(([candidates]) => candidates!),
      readEscrowCredit(ctx, owner, chainId, booked),
      envelopeNonce(ctx, master, HUB_CHAIN_ID),
      draft.contribution > 0n ? readCreditBook(ctx, owner, master, chainId, booked) : null,
      draft.contribution > 0n && !local ? readReleased(ctx, owner, master, chainId, booked) : null,
      local ? true : delegationOf(clientOf(ctx, chainId), chainId, master).then(binding => binding.module !== null),
      local
        ? null
        : Promise.all(
            [HUB_CHAIN_ID, chainId].map(async id => {
              const client = clientOf(ctx, id)
              const code = await client.getCode({ address: owner })
              return code === undefined || code === '0x' ? 0n : readContract(client, { address: owner, abi: useraccountAbi, functionName: 'epoch' })
            })
          ),
      quoteRelayFee(ctx, HUB_CHAIN_ID, 'sell', false, roundToken, 0n, 0n, 0n),
      ctx.context.getFeeConverter(HUB_CHAIN_ID, HUB_CANONICAL_TOKEN.WETH, RELAY_RATE_MAX_STALE_MS)
    ])
    const opening = genesis.key !== '0x'
    if (!opening && fund === null) throw new Error(`the chronicle has not recorded the fund of ${master} yet; retry once it catches up`)
    const kind: 'createFund' | 'allocate' = opening ? 'createFund' : 'allocate'
    const profile = opening ? fundProfile(record.symbol, record.cells) : null
    const pending = released === null || credited === null ? 0n : released.total - credited.total
    const amount = draft.contribution === 0n ? 0n : pending > 0n ? pending : openEscrowOf(escrow)
    if (draft.contribution > 0n && amount === 0n) {
      throw new Error(
        `This round credits up to ${readableTokenAmountLabel(getTokenDescription(chainId, token), draft.contribution)} from your escrow on ${where}, which holds none of it now.`
      )
    }
    const abroad = !local && amount > 0n
    const header = intentHeader(ctx, true, master, nonce, HUB_CANONICAL_TOKEN.WETH, 0n)
    const round = {
      kind,
      ...(fund ?? {
        shareToken,
        performanceFee: PROTOCOL.performanceFee,
        owner,
        supply: 0n,
        masterShares: 0n,
        redemption: { id: 0n, fraction: 0, fee: 0n, masterPay: 0n, queued: 0n, owedLeft: 0n, potLeft: 0n, token: zeroAddress, price: 0n }
      }),
      master,
      now: pinned.timestamp,
      deadline: header.deadline,
      feeReserve,
      feeCeiling: relayFeeOf(convert, HUB_CHAIN_ID, 'allocate', true, PROTOCOL.maxCohortSize, 0n, 0n),
      candidates
    }
    const puppets = allocationTermsOf({ ...round, value: valuationOf(quote.valuation), price: quote.price }, amount).reduce((total, row) => total + row.amount, 0n)
    const gain = allocateSignerGain({
      masterShares: round.masterShares,
      supply: round.supply,
      valuation: valuationOf(quote.valuation),
      creditValue: valueFor(amount, quote.price),
      puppetValue: valueFor(puppets, quote.price),
      performanceFee: round.performanceFee,
      protocolFeeShare: PROTOCOL.protocolFeeShare
    })
    const signed = shadeQuote(quote, roundToken, gain, DEFAULT_EVALUATION_CONFIG.driftToleranceBps)
    const allocationList = allocationTermsOf({ ...round, value: valuationOf(signed.valuation), price: signed.price }, amount)
    const fee = relayFeeOf(convert, HUB_CHAIN_ID, kind, opening, BigInt(allocationList.length), 0n, 0n)
    const masterSlice = ((fee / (BigInt(allocationList.length) + 1n)) * signed.price.amount) / signed.price.value
    const paid = released !== null && credited !== null && pending > 0n ? released.feeTotal - credited.feeTotal : null
    if (paid !== null && paid < masterSlice) {
      throw new CompactError(
        'RELAY_FEE_MOVED',
        `The relay fee rose since your release on ${where}, past what that release paid toward this round. The release stays yours and the next Allocate credits it; submit again shortly.`,
        'soft'
      )
    }
    const masterBilled =
      paid !== null
        ? paid
        : abroad
          ? masterSlice + relayFeeOf(await ctx.context.getFeeConverter(chainId, booked, RELAY_RATE_MAX_STALE_MS), chainId, 'fulfil', !bound, 0n, 0n, 0n)
          : masterSlice
    const credit =
      amount === 0n || credited === null
        ? { chainId: 0n, token: zeroAddress, total: 0n, feeTotal: 0n }
        : { chainId: BigInt(chainId), token: booked, total: credited.total + amount, feeTotal: credited.feeTotal + masterBilled }
    const intent: IFund__AllocateIntent = { header: { ...header, fee }, shareToken, valuation: signed.valuation, token: roundToken, price: signed.price, credit, allocationList }
    const typedCredit = creditTotalTypedData(owner, master, credit)
    const creditDigest = hashTypedData(typedCredit)
    const split = abroad && epochs !== null && epochs[0] !== epochs[1]
    const ownerSignature =
      credit.total === 0n
        ? null
        : split
          ? (walletSigned.get(creditDigest) ?? (await ctx.wallet.walletClient.signTypedData(typedCredit)))
          : await (await approverFor(ctx, HUB_CHAIN_ID))(creditDigest)
    if (split && ownerSignature !== null && !walletSigned.has(creditDigest)) {
      walletSigned.set(creditDigest, ownerSignature)
      onTx?.('credit', null)
    }
    if (abroad && released !== null && paid === null) {
      if (releasedHere) throw new Error(`Your release on ${where} landed, but ${where} does not show it yet. Submit again shortly and the round credits it.`)
      if (ownerSignature === null) throw new Error(`a release on ${where} needs your signature over the credit it settles`)
      verifyFulfil(escrow, released, credit)
      const release = await ctx.compact.fulfil({
        kind: 'fulfil',
        chainId,
        body: master,
        token: booked,
        total: credit.total,
        feeTotal: credit.feeTotal,
        ownerSignature,
        genesis: await genesisFor(ctx, master, chainId)
      })
      const receipt = await clientOf(ctx, chainId).waitForTransactionReceipt({ hash: release.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
      if (receipt.status === 'reverted') throw new Error(`The release on ${where} reverted (tx ${release.txHash}); your escrow there is untouched. Submit again.`)
      onTx?.('fulfil', { chainId, account: master, block: receipt.blockNumber, txHash: release.txHash })
      releasedHere = true
      for (const started = Date.now(); ; ) {
        try {
          await requireFolded(ctx, chainId, master)
          break
        } catch (err) {
          if (!(err instanceof CompactError) || err.code !== 'CHRONICLE_BEHIND' || Date.now() - started >= CHRONICLE_CATCH_UP_MS) throw err
        }
        await new Promise(resolve => setTimeout(resolve, CHRONICLE_POLL_MS))
      }
      continue
    }
    const { typedData } = await attestAllocateIntent(
      {
        chainId: HUB_CHAIN_ID,
        now: pinned.timestamp,
        account: opening ? null : { user, nonce },
        genesis,
        profile,
        fund,
        credit: local && amount > 0n ? escrow : null,
        credited: amount > 0n ? credited : null,
        released: abroad ? released : null,
        puppets: new Map(
          candidates.map(
            c =>
              [
                c.puppet,
                { mandate: c.registered, epoch: c.epoch, user: c.user, available: c.available, held: c.held, cost: c.cost, allocatedAt: c.allocatedAt }
              ] as const
          )
        ),
        audit: null,
        priceMark: quote.price.value,
        priceGain: { above: 0n, below: 0n },
        config: DEFAULT_EVALUATION_CONFIG
      },
      intent
    )
    try {
      return await dispatch(kind, HUB_CHAIN_ID, profile === null ? { ...intent, ownerSignature } : { ...intent, profile, ownerSignature }, intent, typedData, ctx, genesis, {
        sid: held.share.sid,
        pkA: encodePoint(G.multiply(shareScalar(held.share)))
      })
    } catch (error) {
      if (!(error instanceof CompactError) || error.code !== 'RELAY_DECLINED') throw error
      const fresh = await approverFor(ctx, HUB_CHAIN_ID).then(approve =>
        requestValuation(ctx.matchmakerUrl, master, shareToken, roundToken, { user, approve }, draft.contribution > 0n ? { chainId, token: booked } : null)
      )
      const verdict = driftVerdict(valuationOf(signed.valuation), valuationOf(fresh.valuation), gain.valuation, DEFAULT_EVALUATION_CONFIG.driftToleranceBps)
      if (verdict.drift <= verdict.allowed) throw error
      if (!repriced) {
        repriced = true
        continue
      }
      const pct = (bps: bigint): string => `${(Number(bps) / 100).toFixed(2)}%`
      throw new CompactError(
        'VALUATION_DRIFT',
        `the fund's value ${verdict.above ? 'fell' : 'rose'} ${pct(verdict.drift)} while the attestor checked this allocate, past the ${verdict.profits ? '0% allowed in your favour' : `${pct(verdict.allowed)} allowed`}, and again after one automatic re-price, so nothing was dispatched. Submit again to price it fresh.`,
        'soft'
      )
    }
  }
}

async function runFundSwapStep(draft: IFundSwapDraft, ctx: ExecContext, toleranceBps: bigint): Promise<{ swapped: IAttestation; filled: ISettledTx | null }> {
  const account = (await fundOf(ctx)).account
  if (resolveDispatchChainId(draft.destinationChainId) !== draft.chainId) await assertNoOpenTransit(ctx, account)
  const { swapped, deposit } = await runSwapStep(
    'fundSwap',
    {
      chainId: draft.chainId,
      inputToken: draft.inputToken,
      outputToken: draft.outputToken,
      inputAmount: draft.inputAmount,
      routeInput: draft.inputAmount,
      outputAmount: draft.outputAmount,
      destinationChainId: BigInt(draft.destinationChainId),
      route: draft.route,
      fillDeadline: draft.fillDeadline
    },
    account,
    ctx,
    null,
    toleranceBps,
    null
  )
  return { swapped, filled: deposit === null ? null : await awaitBridgeFill(ctx, swapped.request.chainId, deposit) }
}

const hostedGate = (chainId: ChainId): Address => deploymentAddress(chainId === HUB_CHAIN_ID ? 'HubGate' : 'SpokeGate', chainId)

async function runEscrowReturnStep(draft: IEscrowReturnDraft, ctx: ExecContext, onTx?: IReportWalletTx): Promise<void> {
  const user = getAddress(ctx.wallet.address)
  const owner = predictUserAccount(user)
  const client = clientOf(ctx, draft.chainId)
  const chain = chainNameOf(draft.chainId) ?? `chain ${draft.chainId}`
  const [block, returnAt] = await Promise.all([
    client.getBlock(),
    readContract(client, { address: deploymentAddress('EscrowStore', draft.chainId), abi: escrowstoreAbi, functionName: 'returnAtMap', args: [owner, draft.token] })
  ])
  const readyAt = new Date(Number(returnAt) * 1000).toLocaleString()
  if (draft.phase === 'request' && returnAt !== 0n) {
    throw new Error(`A return of your escrow on ${chain} is already pending, claimable from ${readyAt}; asking again would restart its one-day wait.`)
  }
  if (draft.phase === 'claim' && returnAt === 0n) throw new Error(`No return of your escrow on ${chain} is pending; ask for one first.`)
  if (draft.phase === 'claim' && block.timestamp < returnAt) throw new Error(`Your escrow return on ${chain} is claimable from ${readyAt}.`)
  const wallet = await ctx.wallet.switchChain(draft.chainId)
  const hash = await writeContract(wallet, {
    address: hostedGate(draft.chainId),
    abi: spokegateAbi,
    functionName: draft.phase === 'request' ? 'requestReturn' : 'returnEscrow',
    args: [draft.token],
    chain: wallet.chain
  })
  const receipt = await walletReceipt(client, draft.chainId, hash)
  if (receipt.status !== 'success') throw new Error(`the escrow return reverted on ${chain} (tx ${receipt.transactionHash}); nothing moved`)
  onTx?.('escrowReturn', { chainId: draft.chainId, account: owner, block: receipt.blockNumber, txHash: receipt.transactionHash })
}

async function runWalletWithdrawStep(draft: IWalletWithdrawDraft, ctx: ExecContext, onTx?: IReportWalletTx): Promise<void> {
  const user = getAddress(ctx.wallet.address)
  const account = predictUserAccount(user)
  const client = clientOf(ctx, draft.chainId)
  const chain = chainNameOf(draft.chainId) ?? `chain ${draft.chainId}`
  const [rows, block] = await Promise.all([ctx.chronicle.select(accountTable, { where: { account } }), client.getBlock()])
  const row = rows.find(each => Number(each.chainId) === draft.chainId)
  if (row === undefined || row.revokedAt === 0) throw new Error(`Your sessions on ${chain} were never revoked, so no withdraw window is open there; revoke first.`)
  const opens = BigInt(row.revokedAt) + SESSION_REVOKE_DELAY
  const closes = opens + SESSION_REVOKE_DELAY
  if (block.timestamp < opens) throw new Error(`The withdraw window on ${chain} opens at ${new Date(Number(opens) * 1000).toLocaleString()}.`)
  if (block.timestamp >= closes) throw new Error(`The withdraw window on ${chain} closed at ${new Date(Number(closes) * 1000).toLocaleString()}; revoke again to reopen it.`)
  const wallet = await ctx.wallet.switchChain(draft.chainId)
  const hash = await writeContract(wallet, { address: account, abi: useraccountAbi, functionName: 'withdraw', args: [draft.token, draft.amount], chain: wallet.chain })
  const receipt = await walletReceipt(client, draft.chainId, hash)
  if (receipt.status !== 'success') throw new Error(`the withdraw reverted on ${chain} (tx ${receipt.transactionHash}); nothing moved`)
  onTx?.('walletWithdraw', { chainId: draft.chainId, account, block: receipt.blockNumber, txHash: receipt.transactionHash })
}

async function runRevokeStep(draft: IRevokeDraft, ctx: ExecContext, onTx?: IReportWalletTx): Promise<void> {
  const user = getAddress(ctx.wallet.address)
  const account = predictUserAccount(user)
  const client = clientOf(ctx, draft.chainId)
  const code = await client.getCode({ address: account })
  if (code === undefined || code === '0x') throw new Error(`your account does not exist on chain ${draft.chainId} yet, so no session there can be revoked`)
  const wallet = await ctx.wallet.switchChain(draft.chainId)
  const hash = await writeContract(wallet, { address: account, abi: useraccountAbi, functionName: 'revokeSessions', chain: wallet.chain })
  const receipt = await walletReceipt(client, draft.chainId, hash)
  if (receipt.status !== 'success') throw new Error(`revoking sessions reverted on chain ${draft.chainId} (tx ${receipt.transactionHash}); every session there still stands`)
  await keysOf(ctx).forgetSessions(user, draft.chainId)
  onTx?.('revoke', { chainId: draft.chainId, account, block: receipt.blockNumber, txHash: receipt.transactionHash })
}

export async function runDraft(draft: IDraft, ctx: ExecContext, landed: ISettledTx | { sent: ISentTx } | null, upstream: readonly IAttestation[], onWalletTx?: IReportWalletTx): Promise<IAttestation[]> {
  if (draft.kind === 'session') return []
  if (draft.kind === 'revoke') {
    await runRevokeStep(draft, ctx, onWalletTx)
    return []
  }
  if (draft.kind === 'walletWithdraw') {
    await runWalletWithdrawStep(draft, ctx, onWalletTx)
    return []
  }
  if (draft.kind === 'escrowReturn') {
    await runEscrowReturnStep(draft, ctx, onWalletTx)
    return []
  }
  const user = getAddress(ctx.wallet.address)
  const accountRows = await ctx.chronicle.select(accountTable, { where: { account: predictUserAccount(user) } })
  verifyRevokeSettled(user, revokedAtIn(accountRows), BigInt(Math.floor(Date.now() / 1000)))
  if (draft.kind === 'mandate') return [await runMandateBatch([draft], ctx)]
  if (draft.kind === 'operate') return [await runOperateStep(draft, ctx, upstream)]
  if (draft.kind === 'allocate') {
    const owner = predictUserAccount(getAddress(ctx.wallet.address))
    for (const chainId of new Set<ChainId>([HUB_CHAIN_ID, draft.escrowChainId])) {
      for (const started = Date.now(); ; ) {
        try {
          await requireFolded(ctx, chainId, owner)
          break
        } catch (err) {
          if (!(err instanceof CompactError) || err.code !== 'CHRONICLE_BEHIND' || Date.now() - started >= CHRONICLE_CATCH_UP_MS) throw err
        }
        await new Promise(resolve => setTimeout(resolve, CHRONICLE_POLL_MS))
      }
    }
    const record = await fundForRound(draft.identity, { chainId: draft.escrowChainId, token: providerToken(draft.escrowToken, draft.escrowChainId) }, ctx, null)
    onWalletTx?.('key', null)
    return [await runAllocateStep(draft, record, ctx, onWalletTx)]
  }
  if (draft.kind === 'sell') return [await runSellStep(draft, ctx)]
  if (draft.kind === 'redeem') return runRedeemStep(draft, ctx, onWalletTx)
  if (draft.kind === 'fundSwap') return [(await runFundSwapStep(draft, ctx, SWAP_REQUOTE_TOLERANCE_BPS)).swapped]
  if (draft.kind === 'operateSwap') return [await runOperateSwapStep(draft, ctx, upstream, onWalletTx)]
  if (draft.kind === 'venueWithdraw') {
    const fund = await fundOf(ctx)
    const { withdraw } = venueWithdrawOf(draft.venueId)
    const payout = clientOf(ctx, withdraw.chainId)
    const fromBlock = await payout.getBlockNumber()
    const typedData = await withdraw.typedData({ clients: { ...ctx.clients, ...ctx.venueClients } }, fund.account, draft.amount, Date.now())
    await fundSignerFor(ctx, fund.account).submit({ kind: 'typedData', typedData })
    const due = draft.amount - withdraw.feeOf(draft.amount)
    try {
      const landing = await awaitWhile(
        {
          timeoutMs: VENUE_ARRIVAL_WAIT_MS,
          pollMs: VENUE_ARRIVAL_POLL_MS,
          timeoutMessage: `The withdrawal did not reach your fund on ${chainNameOf(withdraw.chainId) ?? `chain ${withdraw.chainId}`} within ${VENUE_ARRIVAL_WAIT_MS / 60_000} minutes. Check the venue before withdrawing again.`
        },
        async () => (await withdraw.landing(payout, fund.account, typedData, due, fromBlock)) ?? undefined
      )
      if ('expired' in landing) throw new Error(landing.expired)
      onWalletTx?.('venueWithdraw', { chainId: withdraw.chainId, account: fund.account, ...landing })
    } catch (error) {
      if (onWalletTx === undefined) throw error
      onWalletTx('venueWithdraw', { missed: error instanceof Error ? error.message : String(error) })
    }
    return []
  }
  if (draft.kind === 'venueIntent') {
    const fund = await fundOf(ctx)
    const { venue, intents, intent } = venueIntentOf(draft.venueId, draft.intent)
    const clients = { ...ctx.clients, ...ctx.venueClients }
    const landingClient = clients[intents.chainId]
    if (landingClient === undefined) throw new Error(`${venue.name} actions land on chain ${intents.chainId}, and no client for it was handed in`)
    const signer = fundSignerFor(ctx, fund.account)
    const sign = async (each: IVenueIntent, params: IVenueIntentParams) => {
      const fromBlock = await landingClient.getBlockNumber()
      const typedData = await each.typedData({ clients }, fund.account, params, Date.now())
      await signer.submit({ kind: 'typedData', typedData })
      return { each, typedData, fromBlock }
    }
    const land = async (signed: Awaited<ReturnType<typeof sign>>): Promise<void> => {
      const landing = await awaitWhile(
        {
          timeoutMs: VENUE_ARRIVAL_WAIT_MS,
          pollMs: VENUE_ARRIVAL_POLL_MS,
          timeoutMessage: `${venue.name} did not confirm "${signed.each.label}" within ${VENUE_ARRIVAL_WAIT_MS / 60_000} minutes. Check ${venue.name} before trying again.`
        },
        async () => (await signed.each.landing(landingClient, fund.account, signed.typedData, signed.fromBlock)) ?? undefined
      )
      if ('expired' in landing) throw new Error(landing.expired)
    }
    const report = (error: unknown): void => {
      if (onWalletTx === undefined) throw error
      onWalletTx('venueIntent', { missed: error instanceof Error ? error.message : String(error) })
    }
    const prerequisite = intents.prerequisite === undefined ? null : await intents.prerequisite({ clients }, fund.account, Date.now())
    if (prerequisite !== null && prerequisite.intent !== draft.intent) {
      const signed = await sign(venueIntentOf(draft.venueId, prerequisite.intent).intent, prerequisite.params)
      try {
        await land(signed)
      } catch (error) {
        report(error)
        return []
      }
    }
    const signed = await sign(intent, draft.params)
    try {
      await land(signed)
      onWalletTx?.('venueIntent', null)
    } catch (error) {
      report(error)
    }
    return []
  }
  if (draft.kind === 'withdraw') return [await runWithdrawStep(draft.input, (await rootOf(ctx)).account, draft.chainId, ctx)]
  const leg = draft.deposit
  const crossChain = BigInt(leg.chainId) !== leg.destinationChainId
  if (draft.toEscrow && !crossChain) return fundEscrow(draft, ctx, landed, onWalletTx)
  const funded = await fundAccount(draft, ctx, landed, onWalletTx)
  const plain = !crossChain && leg.route === null
  if (draft.identity !== undefined) {
    const keyedOn = plain
      ? { chainId: resolveDispatchChainId(Number(leg.destinationChainId)), token: leg.outputToken }
      : { chainId: resolveDispatchChainId(leg.chainId), token: leg.inputToken }
    const fund = await fundForRound(draft.identity, keyedOn, ctx, funded === null ? null : funded.funding)
    onWalletTx?.('key', null)
    await keysOf(ctx).approveFund(ctx.wallet, HUB_CHAIN_ID, fund.account)
    onWalletTx?.('genesis', null)
  }
  if (plain) return []
  if (leg.route === null) throw new Error('a crosschain deposit needs a bridge route')
  const bridged = await runSwapStep(
    'depositAcross',
    { ...leg, route: leg.route },
    (await rootOf(ctx)).account,
    ctx,
    funded === null ? null : funded.block,
    SWAP_REQUOTE_TOLERANCE_BPS,
    draft.toEscrow ? ESCROW_FILL_WINDOW_SEC : null,
    onWalletTx
  )
  const deposit = bridged.deposit
  if (!draft.toEscrow) {
    if (deposit !== null) await awaitBridgeFill(ctx, bridged.swapped.request.chainId, deposit)
    return [bridged.swapped]
  }
  if (deposit === null) throw new Error(`the bridge to chain ${leg.destinationChainId} emitted no Across deposit to escrow`)
  const escrowChainId = resolveDispatchChainId(Number(deposit.destinationChainId))
  const escrowToken = getAddress(slice(deposit.outputToken, 12))
  const deferred = await deferEscrow(ctx, escrowChainId, escrowToken, deposit.outputAmount, BigInt(deposit.fillDeadline) + ESCROW_FIRE_MARGIN_SEC)
  await awaitBridgeFill(ctx, bridged.swapped.request.chainId, deposit)
  if ('digest' in deferred) {
    const escrowAccount = predictUserAccount(getAddress(ctx.wallet.address))
    const until = Number(deferred.intent.header.deadline) * 1000 + LANDING_MARGIN_MS
    const settled = await awaitWhile(
      {
        timeoutMs: until - Date.now() + ESCROW_POLL_MS * 2,
        pollMs: ESCROW_POLL_MS,
        timeoutMessage: `the escrow held for your account on chain ${escrowChainId} could not be looked up before its deadline passed`
      },
      async (): Promise<ISettledTx | null | undefined> => {
        const journal = ctx.journal(escrowAccount)
        await journal.sync('all')
        const call = await journal.callOf(escrowChainId, deferred.digest)
        if (call !== null) return { chainId: escrowChainId, account: escrowAccount, block: call.blockNumber, txHash: call.transactionHash }
        return Date.now() >= until ? null : undefined
      }
    )
    if (settled !== null) {
      onWalletTx?.('retireEscrow', settled)
      return [
        bridged.swapped,
        {
          request: { kind: 'retireEscrow', chainId: escrowChainId, intent: deferred.intent },
          result: { account: settled.account, txHash: settled.txHash, relayFee: deferred.intent.header.fee },
          settledBlock: settled.block,
          digest: deferred.digest
        }
      ]
    }
  }
  return [bridged.swapped, await runEscrowLandingStep(escrowChainId, escrowToken, deposit.outputAmount, ctx, onWalletTx)]
}

async function deferEscrow(
  ctx: ExecContext,
  chainId: ChainId,
  token: Address,
  landing: bigint,
  deadline: bigint
): Promise<{ intent: ILiquidityGate__RetireEscrowIntent; digest: Hex } | { refused: string }> {
  const user = getAddress(ctx.wallet.address)
  const account = predictUserAccount(user)
  const [nonce, creates] = await Promise.all([envelopeNonce(ctx, account, chainId), createsAccount(ctx, chainId)])
  const fee = await quoteRelayFee(ctx, chainId, 'retireEscrow', creates, token, 0n, 0n, 0n)
  if (landing <= fee) {
    throw new Error(`the bridge delivers ${landing} of ${token} to your account on chain ${chainId}, which does not cover the ${fee} fee of escrowing it; it stays in your account there`)
  }
  const intent: ILiquidityGate__RetireEscrowIntent = {
    header: { account, user, nonce, deadline, feeToken: token, fee },
    token,
    amount: landing - fee
  }
  const digest = hashTypedData(intentTypedData('retireEscrow', chainId, intent))
  const signature = await (await approverFor(ctx, chainId))(digest)
  const res = await fetch(`${ctx.matchmakerUrl}/defer`, { method: 'POST', body: encode({ kind: 'retireEscrow', chainId, input: intent, signature }) })
  if (res.status === 409) return { refused: (decode(await res.text()) as { detail: string }).detail }
  if (!res.ok) return { refused: `the matchmaker answered ${res.status}` }
  return { intent, digest }
}
