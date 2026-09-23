import { accountmoduleAbi, fundaccountAbi, spokegateAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, PRECISION, PROTOCOL } from '@puppet/contracts/const'
import type {
  IAccountLib__Mandate,
  IFund__AllocateIntent,
  IFund__RedeemIntent,
  IFund__SellIntent,
  IHubGate__MandateIntent,
  ILiquidityGate__EscrowIntent,
  ISpokeGate__OperateIntent
} from '@puppet/contracts/types'
import {
  accountCallsFromReceipt,
  entryDeltas,
  fundProfile,
  type IBodyGenesis,
  predictShare,
  predictUserAccount,
  signBodyGenesis
} from '@puppet/sdk/account'
import { CompactError, type IDispatchedFrame, type IDispatchRequest, requestAllocation, requestValuation, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import { type ChainId, DEFAULT_DEADLINE_SEC, deploymentAddress, resolveDispatchChainId } from '@puppet/sdk/const'
import { awaitWhile } from '@puppet/sdk/core'
import { DEFAULT_EVALUATION_CONFIG, screenSwapValue, VALUE_KEY, valuationDeadline } from '@puppet/sdk/evaluate'
import {
  allowanceTokensOf,
  attestAllocateIntent,
  attestDepositSwap,
  attestEscrowIntent,
  attestMandateIntent,
  attestOperateIntent,
  attestRedeemIntent,
  attestSellIntent,
  attestWithdrawIntent,
  bestRoutePlan,
  creditableOf,
  type IActionKind,
  type IDepositSwapInput,
  type IIntentByKind,
  type ISwapRoute,
  type IWithdrawInput,
  type IWithdrawRoute,
  mandateDigest,
  pinBlocks,
  quoteAcrossDeposit,
  quoteAcrossSwapAndBridge,
  quoteSwapRoutes,
  readAllocationBlock,
  readAllocationCandidates,
  readBoundParent,
  readEscrowCredit,
  readFundState,
  readPoolPosition,
  readTransits,
  routeCalldataBytes,
  routeQuoteExpiry,
  valuationRatesOf
} from '@puppet/sdk/intent'
import { settlePosition } from '@puppet/sdk/pool'
import { fundTable, type IFundRow } from '@puppet/sdk/schema'
import {
  bondTokenOf,
  chainTokenOfKey,
  declaredCallGas,
  dynamicCalldataBytes,
  fetchTokenBalance,
  tokenInfoFor,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import { PALETTE } from '@puppet/sdk/ui-components'
import { withCappedAllowance } from '@puppet/sdk/venue'
import { type Address, erc20Abi, getAddress, type Hex, hashTypedData, isAddressEqual, type PublicClient, type TypedDataDefinition, zeroAddress } from 'viem'
import { readContract, writeContract } from 'viem/actions'
import context, { getRate } from '../../../io/context.js'
import { client as chronicle } from '../../../io/datastore/reads.js'
import { journal } from '../../../io/journal/journal.js'
import { compact, matchmakerUrl } from '../../../io/matchmaker/index.js'
import type { IFund } from '../../../wallet/index.js'
import type {
  IAllocateDraft,
  IDepositDraft,
  IDepositLeg,
  IDraft,
  IFundIdentityDraft,
  IFundSwapDraft,
  IMandateDraft,
  IOperateDraft,
  IRedeemDraft,
  IReportWalletTx,
  ISellDraft,
  IUnsealed
} from '../draft.js'
import { type ExecContext, envelopeNonce, publicClientForChain, quoteRelayFee, rootOf, terms, walletClientForChain } from './_shared.js'


type IStepRequest = { [K in IActionKind]: { kind: K; chainId: ChainId; intent: IIntentByKind[K] } }[IActionKind]

export type IAttestation = {
  request: IStepRequest
  result: IDispatchedFrame
  settledBlock: bigint
  deltas: Map<Address, bigint>
}

async function approverFor(ctx: ExecContext, chainId: ChainId): Promise<(digest: Hex) => Promise<Hex>> {
  if (ctx.keys === null) throw new Error('this build carries no key service, so nothing can be signed')
  return (await ctx.keys.grantSession(ctx.wallet, chainId)).approve
}

function fundSignerFor(ctx: ExecContext, account: Address) {
  if (ctx.keys === null) throw new Error('this build carries no key service, so nothing can be signed')
  const signer = ctx.keys.fundSignerOf(ctx.wallet.address, account)
  if (signer === null) throw new Error(`this browser holds no trading key for ${account}; reopen the fund on this device first`)
  return signer
}

async function dispatchAndSettle(wire: IDispatchRequest, record: IStepRequest, intentDigest: Hex): Promise<IAttestation> {
  const ack = await compact.dispatch(wire).catch(async (err: unknown) => {
    if (!(err instanceof CompactError) || err.code !== 'DISPATCH_TIMEOUT') throw err
    const account = record.intent.header.account
    const user = record.intent.header.user
    await journal(account, user).refresh()
    if (await journal(account, user).holds(record.chainId, intentDigest)) {
      throw new Error(
        `${record.kind} was not acknowledged in time but has since settled on chain ${record.chainId} (digest ${intentDigest}); do not resubmit it, refresh to pick up the new state.`
      )
    }
    throw err
  })
  return settle(ack, record, intentDigest, 0n)
}

async function settle(ack: IDispatchedFrame, record: IStepRequest, intentDigest: Hex, value: bigint): Promise<IAttestation> {
  const settleClient = publicClientForChain(record.chainId)
  let receipt: Awaited<ReturnType<typeof settleClient.waitForTransactionReceipt>>
  try {
    receipt = await settleClient.waitForTransactionReceipt({ hash: ack.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `${record.kind} was dispatched (tx ${ack.txHash}) and may still settle; its receipt was not observed within ${SETTLEMENT_TIMEOUT_MS}ms. Check the transaction before retrying: ${detail}`
    )
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
  const logs = receipt.logs.map(log => ({ address: getAddress(log.address), topics: [...log.topics], data: log.data, logIndex: log.logIndex }))
  await journal(ack.account, record.intent.header.user).settle({ chainId: record.chainId, block: call.blockNumber })
  return { request: record, result: ack, settledBlock: call.blockNumber, deltas: entryDeltas(ack.account, { chainId: record.chainId, callList: call.callList, logs, value }) }
}

function intentHeader(ctx: ExecContext, account: Address, nonce: bigint, feeToken: Address, fee: bigint, notAfter?: number | null) {
  const deadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC
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
  genesis?: IBodyGenesis
): Promise<IAttestation> {
  const digest = hashTypedData(typedData)
  const signature = await (await approverFor(ctx, chainId))(digest)
  return dispatchAndSettle(
    { kind, chainId, input, intent: intent === input ? undefined : intent, signature, genesis } as IDispatchRequest,
    { kind, chainId, intent } as IStepRequest,
    digest
  )
}

async function fundOf(ctx: ExecContext): Promise<IFund> {
  const fund = (await rootOf(ctx)).fund
  if (fund === null) throw new Error('open a fund before running this action; it acts through the fund, not your wallet account')
  return fund
}

async function fundRowOf(ctx: ExecContext, master: Address): Promise<IFundRow> {
  const rows = await chronicle.select(fundTable, { where: { master } })
  const row = rows[0]
  if (row === undefined) throw new Error(`the chronicle holds no fund for ${master}, so its share token is unknown`)
  return row
}

async function headerStateOf(ctx: ExecContext, account: Address, chainId: ChainId, nonce: bigint) {
  return (await createsAccount(ctx, chainId)) ? null : { user: getAddress(ctx.wallet.address), nonce }
}

const createsAccount = async (ctx: ExecContext, chainId: ChainId): Promise<boolean> =>
  (await readContract(publicClientForChain(chainId), {
    address: deploymentAddress('AccountModule', chainId),
    abi: accountmoduleAbi,
    functionName: 'accountBlockMap',
    args: [predictUserAccount(ctx.wallet.address)]
  })) === 0n

const KEYLESS_GENESIS: IBodyGenesis = { parent: zeroAddress, key: '0x', approval: '0x', authorization: null }

async function genesisFor(ctx: ExecContext, account: Address, chainId: ChainId): Promise<IBodyGenesis> {
  const parent = predictUserAccount(ctx.wallet.address)
  if (isAddressEqual(account, parent)) return KEYLESS_GENESIS
  const client = publicClientForChain(chainId)
  const code = await client.getCode({ address: account })
  const delegated = code?.toLowerCase() === `0xef0100${deploymentAddress('FundAccount', chainId).slice(2)}`.toLowerCase()
  if (delegated) {
    const [module] = await readContract(client, { address: account, abi: fundaccountAbi, functionName: 'bound' })
    if (!isAddressEqual(module, zeroAddress)) return { parent, key: '0x', approval: '0x', authorization: null }
  }
  const signer = fundSignerFor(ctx, account)
  const approve = await approverFor(ctx, chainId)
  const nonce = await client.getTransactionCount({ address: account })
  return signBodyGenesis(
    { account, sign: signer.sign },
    { account, parent },
    approve,
    delegated ? null : { chainId, nonce }
  )
}

const BRIDGE_FILL_TIMEOUT_MS = 15 * 60 * 1000
const LOCAL_SETTLE_TIMEOUT_MS = 2 * 60 * 1000

function resolveTokenAddress(ctx: ExecContext, chainId: ChainId, token: Address): Address {
  if (isAddressEqual(token, PROTOCOL.nativeToken)) return token
  return tokenInfoFor(ctx.tokenRegistry, chainId, token).token
}

async function fundAccount(draft: IDepositDraft, ctx: ExecContext, onTx?: IReportWalletTx): Promise<void> {
  if (draft.source === 'account') return
  const leg = draft.deposit
  const chainId = resolveDispatchChainId(leg.chainId)
  const publicClient = publicClientForChain(chainId)
  const wnt = wrappedNativeAddressOf(chainId)
  const delivered = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const fused = isAddressEqual(delivered, PROTOCOL.nativeToken) || isAddressEqual(delivered, wnt)
  const amount = leg.inputAmount
  const wallet = await walletClientForChain(ctx.wallet.walletClient, chainId)
  let value = 0n
  if (fused) {
    const walletWrapped = await fetchTokenBalance(publicClient, wnt, ctx.wallet.address)
    value = walletWrapped < amount ? amount - walletWrapped : 0n
    if (value > 0n) {
      const nativeBalance = await publicClient.getBalance({ address: ctx.wallet.address })
      if (nativeBalance < value) {
        throw new Error(
          `this deposit needs ${value} native on chain ${chainId} beyond your wrapped balance and the wallet holds ${nativeBalance}. Bridge more native first or lower the amount.`
        )
      }
    }
  }
  const pull = amount - value
  if (pull > 0n) {
    const pulled = fused ? wnt : delivered
    const spender = deploymentAddress('Deposit', chainId)
    const allowance = await readContract(publicClient, { address: pulled, abi: erc20Abi, functionName: 'allowance', args: [ctx.wallet.address, spender] })
    if (allowance < pull) {
      const approveHash = await writeContract(wallet, {
        address: pulled,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, pull],
        account: ctx.wallet.address,
        chain: wallet.chain
      })
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: LOCAL_SETTLE_TIMEOUT_MS })
      if (approveReceipt.status !== 'success') {
        throw new Error(`the ${pulled} approval reverted on-chain (tx ${approveHash}); nothing moved, retry from a fresh quote`)
      }
      onTx?.('approve', { chainId, block: approveReceipt.blockNumber, txHash: approveHash })
    }
  }
  const hash = await writeContract(wallet, {
    address: deploymentAddress(chainId === HUB_CHAIN_ID ? 'HubGate' : 'SpokeGate', chainId),
    abi: spokegateAbi,
    functionName: 'deposit',
    args: [delivered, amount],
    value,
    account: ctx.wallet.address,
    chain: wallet.chain
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: LOCAL_SETTLE_TIMEOUT_MS })
  if (receipt.status !== 'success') {
    throw new Error(`funding your account with ${amount} ${delivered} reverted on-chain (tx ${hash}); nothing moved, retry from a fresh quote`)
  }
  onTx?.('fund', { chainId, block: receipt.blockNumber, txHash: hash })
}

const BRIDGE_FILL_FLOOR_MS = 30_000
function bridgeFillTimeoutMs(fillDeadlineSec: number): number {
  const untilDeadline = Math.floor(fillDeadlineSec * 1000) - Date.now()
  return Math.min(BRIDGE_FILL_TIMEOUT_MS, Math.max(BRIDGE_FILL_FLOOR_MS, untilDeadline))
}

async function awaitBridgeFill(p: { client: PublicClient; token: Address; account: Address; min: bigint; fillDeadline: number }): Promise<bigint> {
  return awaitWhile(
    {
      timeoutMs: bridgeFillTimeoutMs(p.fillDeadline),
      pollMs: 2_000,
      timeoutMessage: `the bridge did not deliver to ${p.account} within its fill deadline; if the fill failed, the funds return as a refund on the origin chain or as the bridged input token on the destination, and either way they show in your Balances`
    },
    async () => {
      const balance = await fetchTokenBalance(p.client, p.token, p.account)
      return balance >= p.min ? balance : undefined
    }
  )
}

const SWAP_REQUOTE_TOLERANCE_BPS = 500n
const belowReviewedFloor = (reviewedMinOut: bigint, requotedOutput: bigint): boolean =>
  reviewedMinOut > 0n && requotedOutput < (reviewedMinOut * (10000n - SWAP_REQUOTE_TOLERANCE_BPS)) / 10000n

async function requoteRoute<TRoute extends IWithdrawRoute>(
  ctx: ExecContext,
  chainId: ChainId,
  depositor: Address,
  recipient: Address,
  leg: { inputToken: Address; outputToken: Address; inputAmount: bigint; outputAmount: bigint; destinationChainId: bigint; route: TRoute; fillDeadline: number },
  relayFee: bigint
): Promise<{ route: TRoute | ISwapRoute; outputAmount: bigint; fillDeadline: number }> {
  if (leg.route.kind !== 'acrossSwap' && leg.route.kind !== 'swap' && leg.route.kind !== 'across') {
    return { route: leg.route, outputAmount: leg.outputAmount, fillDeadline: leg.fillDeadline }
  }
  const net = leg.inputAmount - relayFee
  if (net <= 0n) throw new Error(`relay fee ${relayFee} consumes the whole input ${leg.inputAmount}`)
  const inputToken = resolveTokenAddress(ctx, chainId, leg.inputToken)
  if (leg.route.kind === 'across') {
    const fresh = await quoteAcrossDeposit('', recipient, {
      chainId,
      destinationChainId: leg.destinationChainId,
      inputToken,
      outputToken: resolveTokenAddress(ctx, resolveDispatchChainId(Number(leg.destinationChainId)), leg.outputToken),
      inputAmount: net,
      timing: await context.getAcrossTiming(chainId)
    })
    return { route: fresh.route, outputAmount: fresh.outputAmount, fillDeadline: fresh.fillDeadline }
  }
  if (leg.route.kind === 'acrossSwap') {
    const fresh = await quoteAcrossSwapAndBridge('', depositor, recipient, {
      chainId,
      destinationChainId: leg.destinationChainId,
      inputToken,
      outputToken: resolveTokenAddress(ctx, resolveDispatchChainId(Number(leg.destinationChainId)), leg.outputToken),
      inputAmount: net,
      timing: await context.getAcrossTiming(chainId)
    })
    return { route: fresh.route, outputAmount: fresh.outputAmount, fillDeadline: fresh.fillDeadline }
  }
  const replanned = await bestRoutePlan(
    quoteSwapRoutes(
      { lifi: '', kyber: '', across: '' },
      depositor,
      recipient,
      {
        chainId,
        destinationChainId: BigInt(chainId),
        inputToken,
        outputToken: resolveTokenAddress(ctx, chainId, leg.outputToken),
        inputAmount: net
      },
      () => context.getAcrossTiming(chainId),
      1
    )
  )
  const fresh = replanned[0]
  if (fresh.outputAmount === 0n || belowReviewedFloor(leg.outputAmount, fresh.outputAmount)) {
    throw new Error('the swap re-quoted materially below the output you reviewed; refresh and retry')
  }
  return { route: fresh.route, outputAmount: fresh.outputAmount, fillDeadline: 0 }
}

async function runSwapStep(
  leg: IDepositLeg & { route: ISwapRoute },
  account: Address,
  ctx: ExecContext,
  onTx?: IReportWalletTx
): Promise<{ steps: IAttestation[]; arrival: bigint }> {
  const chainId = resolveDispatchChainId(leg.chainId)
  const token = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const publicClient = publicClientForChain(chainId)
  const wnt = wrappedNativeAddressOf(chainId)
  const destChainId = resolveDispatchChainId(Number(leg.destinationChainId))
  const arrivalToken = resolveTokenAddress(ctx, destChainId, leg.outputToken)
  const genesis = await genesisFor(ctx, account, chainId)
  const binding = genesis.key !== '0x'
  const carriesGenesis = isAddressEqual(genesis.parent, zeroAddress) ? await createsAccount(ctx, chainId) : binding
  const [relayFee, nonce] = await Promise.all([
    quoteRelayFee(chainId, 'depositAcross', carriesGenesis, token, 0n, 0n, routeCalldataBytes(leg.route), null),
    envelopeNonce(account, getAddress(ctx.wallet.address), chainId)
  ])
  const fresh = await requoteRoute(ctx, chainId, account, account, { ...leg, inputToken: token, outputToken: arrivalToken }, relayFee)
  const notAfter = routeQuoteExpiry(fresh.route, await context.getAcrossTiming(chainId))
  const input: IDepositSwapInput = {
    chainId,
    inputToken: token,
    outputToken: arrivalToken,
    inputAmount: leg.inputAmount,
    outputAmount: fresh.outputAmount,
    destinationChainId: leg.destinationChainId,
    route: fresh.route,
    fillDeadline: fresh.fillDeadline,
    header: intentHeader(ctx, account, nonce, token, relayFee, notAfter)
  }
  await screenSwapValue(
    {
      routeKind: input.route.kind,
      chainId,
      inputToken: input.inputToken,
      outputToken: input.outputToken,
      destinationChainId: Number(input.destinationChainId),
      inputAmount: input.inputAmount,
      outputAmount: input.outputAmount,
      relayFee
    },
    getRate
  )
  const fusedTokens = [...new Set([token, PROTOCOL.nativeToken, wnt].map(each => getAddress(each)))]
  const balances = new Map(
    await Promise.all(fusedTokens.map(async each => [each, await fetchTokenBalance(publicClient, each, account)] as const))
  )
  const destinationClient = publicClientForChain(destChainId)
  const landedBefore = await fetchTokenBalance(destinationClient, arrivalToken, account)
  const { intent, typedData } = await attestDepositSwap(
    {
      chainId,
      tokenRegistry: ctx.tokenRegistry,
      account: binding ? null : { user: getAddress(ctx.wallet.address), nonce },
      genesis,
      balances,
      timing: await context.getAcrossTiming(chainId)
    },
    input
  )
  const swapped = await dispatch('depositAcross', chainId, input, intent, typedData, ctx, genesis)
  onTx?.('swap', { chainId, block: swapped.settledBlock, txHash: swapped.result.txHash })
  if (destChainId !== chainId) {
    await awaitBridgeFill({ client: destinationClient, token: arrivalToken, account, min: landedBefore + fresh.outputAmount, fillDeadline: fresh.fillDeadline })
  }
  return { steps: [swapped], arrival: fresh.outputAmount }
}

const accountBalance = (ctx: ExecContext, chainId: ChainId, token: Address): Promise<bigint> =>
  fetchTokenBalance(publicClientForChain(chainId), token, predictUserAccount(ctx.wallet.address))

async function runWithdrawStep(leg: IUnsealed<IWithdrawInput>, account: Address, sourceChainId: ChainId, ctx: ExecContext): Promise<IAttestation> {
  const chainId = resolveDispatchChainId(sourceChainId)
  const token = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const publicClient = publicClientForChain(chainId)
  const [relayFee, nonce] = await Promise.all([
    quoteRelayFee(chainId, 'withdraw', false, leg.inputToken, 0n, 0n, routeCalldataBytes(leg.route), null),
    envelopeNonce(account, getAddress(ctx.wallet.address), chainId)
  ])
  const requoted = await requoteRoute(ctx, chainId, account, ctx.wallet.address, leg, relayFee)
  const input: IWithdrawInput = {
    ...leg,
    ...requoted,
    outputAmount: leg.route.kind === 'transfer' ? leg.inputAmount - relayFee : requoted.outputAmount,
    header: intentHeader(ctx, account, nonce, leg.inputToken, relayFee)
  }
  if (input.route.kind !== 'transfer') {
    await screenSwapValue(
      {
        routeKind: input.route.kind,
        chainId,
        inputToken: input.inputToken,
        outputToken: input.outputToken,
        destinationChainId: Number(input.destinationChainId),
        inputAmount: input.inputAmount,
        outputAmount: input.outputAmount,
        relayFee
      },
      getRate
    )
  }
  const [balance, timing, genesis] = await Promise.all([
    fetchTokenBalance(publicClient, token, account),
    context.getAcrossTiming(chainId),
    genesisFor(ctx, account, chainId)
  ])
  const { intent, typedData } = await attestWithdrawIntent(
    { chainId, tokenRegistry: ctx.tokenRegistry, account: { user: getAddress(ctx.wallet.address), nonce }, genesis, balance, timing },
    input
  )
  return dispatch('withdraw', chainId, input, intent, typedData, ctx, genesis)
}

export async function runMandateBatch(drafts: readonly IMandateDraft[], ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const approve = await approverFor(ctx, HUB_CHAIN_ID)
  const mandateList: IAccountLib__Mandate[] = drafts.map(d => d.mandate).sort((a, b) => (BigInt(a.master) < BigInt(b.master) ? -1 : 1))
  if (mandateList.length === 0) throw new Error('a hub broadcast needs at least one mandate')
  const feeToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
  const [nonce, feeBalance, relayFee] = await Promise.all([
    envelopeNonce(account, getAddress(ctx.wallet.address), HUB_CHAIN_ID),
    accountBalance(ctx, HUB_CHAIN_ID, feeToken),
    quoteRelayFee(HUB_CHAIN_ID, 'mandate', await createsAccount(ctx, HUB_CHAIN_ID), feeToken, BigInt(mandateList.length), 0n, 0n, null)
  ])
  const signatureList = await Promise.all(mandateList.map(m => approve(mandateDigest(account, m))))
  const intent: IHubGate__MandateIntent = {
    header: intentHeader(ctx, account, nonce, feeToken, relayFee),
    mandateList,
    signatureList
  }
  const genesis = await genesisFor(ctx, account, HUB_CHAIN_ID)
  const typedData = await attestMandateIntent(
    {
      chainId: HUB_CHAIN_ID,
      tokenRegistry: ctx.tokenRegistry,
      account: await headerStateOf(ctx, account, HUB_CHAIN_ID, nonce),
      genesis,
      rowAuthority: null,
      client: publicClientForChain(HUB_CHAIN_ID),
      feeBalance,
      nowSec: BigInt(Math.floor(Date.now() / 1000))
    },
    intent
  )
  return dispatch('mandate', HUB_CHAIN_ID, intent, intent, typedData, ctx, genesis)
}

export async function runOperateStep(draft: IOperateDraft, ctx: ExecContext): Promise<IAttestation> {
  const account = (await fundOf(ctx)).account
  const chainId = draft.chainId
  const feeToken = resolveTokenAddress(ctx, chainId, draft.feeToken)
  const tokens = [...new Set([...allowanceTokensOf(draft.callList), getAddress(feeToken)])]
  const publicClient = publicClientForChain(chainId)
  const [nonce, balanceList] = await Promise.all([
    envelopeNonce(account, getAddress(ctx.wallet.address), chainId),
    Promise.all(tokens.map(token => fetchTokenBalance(publicClient, token, account)))
  ])
  const balances = new Map(tokens.map((token, i) => [token, balanceList[i]!] as const))
  const genesis = await genesisFor(ctx, account, chainId)
  const binding = genesis.key !== '0x'
  const relayFee = await quoteRelayFee(
    chainId,
    'operate',
    binding,
    feeToken,
    BigInt(draft.callList.length),
    declaredCallGas(draft.callList),
    dynamicCalldataBytes(draft.callList.map(call => call.callData)),
    null
  )
  const intent: ISpokeGate__OperateIntent = {
    header: intentHeader(ctx, account, nonce, feeToken, relayFee),
    callList: draft.callList.map(call => {
      const held = balances.get(getAddress(call.target))
      if (held === undefined) return call
      const fundBalance = held - (isAddressEqual(call.target, feeToken) ? relayFee : 0n)
      return { ...call, callData: withCappedAllowance(chainId, call.callData, fundBalance) }
    })
  }
  const typedData = await attestOperateIntent(
    { chainId, tokenRegistry: ctx.tokenRegistry, account: binding ? null : { user: getAddress(ctx.wallet.address), nonce }, genesis, balances },
    intent
  )
  return dispatch('operate', chainId, intent, intent, typedData, ctx, genesis)
}

async function runSellStep(draft: ISellDraft, ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const bond = bondTokenOf(HUB_CHAIN_ID)
  const [fundState, standing, nonce, relayFee, feeBalance, units] = await Promise.all([
    readFundState(terms, draft.master, draft.share),
    readPoolPosition(terms, draft.master, account),
    envelopeNonce(account, getAddress(ctx.wallet.address), HUB_CHAIN_ID),
    quoteRelayFee(HUB_CHAIN_ID, 'sell', false, bond, 0n, 0n, 0n, null),
    accountBalance(ctx, HUB_CHAIN_ID, bond),
    accountBalance(ctx, HUB_CHAIN_ID, draft.share)
  ])
  const closed = standing.position.epoch < standing.queue.epoch
  const sellFundRow = await fundRowOf(ctx, draft.master)
  const due = settlePosition(standing.queue, standing.position, fundState.queued, closed ? standing.closedAccrued : undefined, sellFundRow.performanceFee)
  const intent: IFund__SellIntent = {
    header: intentHeader(ctx, account, nonce, bond, relayFee),
    share: draft.share,
    master: draft.master,
    units: draft.units
  }
  const typedData = attestSellIntent(
    {
      chainId: HUB_CHAIN_ID,
      tokenRegistry: ctx.tokenRegistry,
      account: { user: getAddress(ctx.wallet.address), nonce },
      units,
      feeBalance,
      payoutDue: due.payout - due.fee
    },
    intent
  )
  return dispatch('sell', HUB_CHAIN_ID, intent, intent, typedData, ctx)
}

async function runRedeemStep(draft: IRedeemDraft, ctx: ExecContext): Promise<IAttestation> {
  const master = (await fundOf(ctx)).account
  const fundRow = await fundRowOf(ctx, master)
  const share = getAddress(fundRow.share)
  const bond = bondTokenOf(HUB_CHAIN_ID)
  const [quote, fundState, nonce, relayFee, funded, genesis] = await Promise.all([
    requestValuation(matchmakerUrl, master, share),
    readFundState(terms, master, share),
    envelopeNonce(master, getAddress(ctx.wallet.address), HUB_CHAIN_ID),
    quoteRelayFee(HUB_CHAIN_ID, 'redeem', false, bond, 0n, 0n, 0n, null),
    fetchTokenBalance(publicClientForChain(HUB_CHAIN_ID), bond, master),
    genesisFor(ctx, master, HUB_CHAIN_ID)
  ])
  const intent: IFund__RedeemIntent = {
    header: intentHeader(ctx, master, nonce, bond, relayFee, Number(valuationDeadline(BigInt(Math.floor(Date.now() / 1000)), DEFAULT_EVALUATION_CONFIG))),
    share,
    valuation: quote.valuation,
    retire: draft.retire,
    drain: draft.drain
  }
  const { typedData } = await attestRedeemIntent(
    {
      chainId: HUB_CHAIN_ID,
      tokenRegistry: ctx.tokenRegistry,
      account: { user: getAddress(ctx.wallet.address), nonce },
      genesis,
      skin: fundState.skin,
      queue: fundState.queue,
      supply: fundState.supply,
      queued: fundState.queued,
      masterUnits: fundState.masterUnits,
      funded,
      feeBalance: funded,
      audit: null,
      nowSec: BigInt(Math.floor(Date.now() / 1000))
    },
    intent
  )
  return dispatch('redeem', HUB_CHAIN_ID, intent, intent, typedData, ctx, genesis)
}

async function fundForRound(identity: IFundIdentityDraft | null, ctx: ExecContext): Promise<IFund> {
  const fund = (await rootOf(ctx)).fund
  if (fund !== null) return fund
  if (ctx.keys === null) throw new Error('this build carries no key service, so a fund key cannot be created')
  if (identity === null) throw new Error('this round opens a fund but carries no name or avatar to write on chain')
  const signer = await ctx.keys.openFund(ctx.wallet, 0n, identity.symbol, identity.cells)
  return { account: signer.account, symbol: identity.symbol, cells: identity.cells }
}

async function runEscrowStep(master: Address, chainId: ChainId, token: Address, contribution: bigint, ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const [nonce, relayFee, balance, masterParent] = await Promise.all([
    envelopeNonce(account, getAddress(ctx.wallet.address), chainId),
    createsAccount(ctx, chainId).then(creates => quoteRelayFee(chainId, 'escrow', creates, token, 0n, 0n, 0n, null)),
    accountBalance(ctx, chainId, token),
    readBoundParent(terms, chainId, master)
  ])
  if (balance <= relayFee) throw new Error(`your account holds ${balance} of ${token} on chain ${chainId}, which does not cover the ${relayFee} relay fee of the escrow`)
  const amount = balance - relayFee < contribution ? balance - relayFee : contribution
  const intent: ILiquidityGate__EscrowIntent = { header: intentHeader(ctx, account, nonce, token, relayFee), master, token, amount }
  const typedData = attestEscrowIntent(
    { chainId, tokenRegistry: ctx.tokenRegistry, account: await headerStateOf(ctx, account, chainId, nonce), masterParent, balances: new Map([[token, balance]]) },
    intent
  )
  return dispatch('escrow', chainId, intent, intent, typedData, ctx)
}

async function fundEscrow(draft: IDepositDraft, ctx: ExecContext, onTx?: IReportWalletTx): Promise<IAttestation[]> {
  const leg = draft.deposit
  const chainId = resolveDispatchChainId(leg.chainId)
  const destination = resolveDispatchChainId(Number(leg.destinationChainId))
  const arrivalToken = resolveTokenAddress(ctx, destination, leg.outputToken)
  const account = predictUserAccount(ctx.wallet.address)
  if (leg.route !== null) {
    const known = (await rootOf(ctx)).fund
    const credited = known === null ? 0n : creditableOf(await readEscrowCredit(terms, account, known.account, destination, arrivalToken))
    const escrowed = !belowReviewedFloor(leg.outputAmount, credited)
    if (!escrowed) await fundAccount(draft, ctx, onTx)
    const record = await fundForRound(draft.identity ?? null, ctx)
    if (draft.identity !== undefined) onTx?.('key', null)
    if (escrowed) return []
    const swapped = await runSwapStep({ ...leg, route: leg.route }, (await rootOf(ctx)).account, ctx, onTx)
    return [...swapped.steps, await runEscrowStep(record.account, destination, arrivalToken, swapped.arrival, ctx)]
  }
  const record = await fundForRound(draft.identity ?? null, ctx)
  if (draft.identity !== undefined) onTx?.('key', null)
  if (creditableOf(await readEscrowCredit(terms, account, record.account, destination, arrivalToken)) >= leg.outputAmount) return []
  const token = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const native = isAddressEqual(token, PROTOCOL.nativeToken)
  const publicClient = publicClientForChain(chainId)
  const wallet = await walletClientForChain(ctx.wallet.walletClient, chainId)
  const held = await fetchTokenBalance(publicClient, token, ctx.wallet.address)
  if (held < leg.inputAmount) throw new Error(`your wallet holds ${held} of ${token} on chain ${chainId}, short of the ${leg.inputAmount} this deposit escrows`)
  if (!native) {
    const spender = deploymentAddress('Deposit', chainId)
    const allowance = await readContract(publicClient, { address: token, abi: erc20Abi, functionName: 'allowance', args: [ctx.wallet.address, spender] })
    if (allowance < leg.inputAmount) {
      const approveHash = await writeContract(wallet, {
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, leg.inputAmount],
        account: ctx.wallet.address,
        chain: wallet.chain
      })
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: LOCAL_SETTLE_TIMEOUT_MS })
      if (approveReceipt.status !== 'success') throw new Error(`the ${token} approval reverted on-chain (tx ${approveHash}); nothing moved`)
      onTx?.('approve', { chainId, block: approveReceipt.blockNumber, txHash: approveHash })
    }
  }
  const hash = await writeContract(wallet, {
    address: deploymentAddress(chainId === HUB_CHAIN_ID ? 'HubGate' : 'SpokeGate', chainId),
    abi: spokegateAbi,
    functionName: 'depositEscrow',
    args: [record.account, token, leg.inputAmount],
    value: native ? leg.inputAmount : 0n,
    account: ctx.wallet.address,
    chain: wallet.chain
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: LOCAL_SETTLE_TIMEOUT_MS })
  if (receipt.status !== 'success') throw new Error(`escrowing ${leg.inputAmount} for ${record.account} reverted on-chain (tx ${hash}); nothing moved`)
  onTx?.('fund', { chainId, block: receipt.blockNumber, txHash: hash })
  return []
}

async function runAllocateStep(draft: IAllocateDraft, record: IFund, ctx: ExecContext): Promise<IAttestation> {
  const master = record.account
  const bond = bondTokenOf(HUB_CHAIN_ID)
  const genesis = await genesisFor(ctx, master, HUB_CHAIN_ID)
  const opening = genesis.key !== '0x'
  const profile = fundProfile(record.symbol, PALETTE, record.cells)
  const share = predictShare(deploymentAddress('HubGate', HUB_CHAIN_ID), deploymentAddress('Share', HUB_CHAIN_ID), profile, master)
  const chainId = draft.escrowChainId
  const token = draft.escrowToken
  const user = getAddress(ctx.wallet.address)
  const [fundState, credit, rates, candidates, blocked, nonce, feeReserve] = await Promise.all([
    opening ? Promise.resolve(null) : readFundState(terms, master, share),
    readEscrowCredit(terms, predictUserAccount(user), master, chainId, token),
    valuationRatesOf(getRate, [{ chainId, token }]),
    readAllocationCandidates(terms, master),
    readAllocationBlock(terms, master),
    envelopeNonce(master, user, HUB_CHAIN_ID),
    quoteRelayFee(HUB_CHAIN_ID, 'sell', false, bond, 0n, 0n, 0n, null)
  ])
  const kind = opening ? 'createFund' : 'allocate'
  const amount = creditableOf(credit)
  const marked = rates.toValue(chainId, token, amount)
  const value = isAddressEqual(token, bondTokenOf(chainId))
    ? marked
    : (marked * (PRECISION.basisPoints - DEFAULT_EVALUATION_CONFIG.driftToleranceBps)) / PRECISION.basisPoints
  const quote = await requestAllocation(matchmakerUrl, master, share, value, amount > 0n ? { user, chainId, token } : null)
  const none = { chainId: 0n, token: zeroAddress, amount: 0n, value: 0n }
  const relayFee = await quoteRelayFee(HUB_CHAIN_ID, kind, opening, bond, BigInt(quote.allocationList.length), 0n, 0n, amount > 0n ? chainId : null)
  const intent: IFund__AllocateIntent = {
    header: intentHeader(ctx, master, nonce, bond, relayFee, Number(valuationDeadline(BigInt(Math.floor(Date.now() / 1000)), DEFAULT_EVALUATION_CONFIG))),
    share,
    valuation: quote.valuation,
    credit: amount > 0n ? { chainId: BigInt(chainId), token, amount, value } : none,
    allocationList: quote.allocationList
  }
  const { typedData } = await attestAllocateIntent(
    {
      chainId: HUB_CHAIN_ID,
      tokenRegistry: ctx.tokenRegistry,
      account: opening ? null : { user, nonce },
      genesis,
      opening,
      skin: fundState?.skin ?? 0n,
      supply: fundState?.supply ?? 0n,
      queued: fundState?.queued ?? 0n,
      masterUnits: fundState?.masterUnits ?? 0n,
      credit: amount > 0n ? credit : null,
      creditMark: amount > 0n ? marked : null,
      puppets: new Map(candidates.map(c => [c.puppet, { mandate: c.registered, withdrawRequestedAt: c.withdrawRequestedAt, available: c.available, basis: c.basis, allocatedAt: c.allocatedAt }] as const)),
      feeReserve,
      blocked,
      audit: null,
      nowSec: BigInt(Math.floor(Date.now() / 1000))
    },
    intent
  )
  return dispatch(kind, HUB_CHAIN_ID, opening ? { ...intent, profile } : intent, intent, typedData, ctx, genesis)
}

async function runFundSwapStep(draft: IFundSwapDraft, ctx: ExecContext): Promise<IAttestation> {
  const account = (await fundOf(ctx)).account
  if (resolveDispatchChainId(draft.destinationChainId) !== draft.chainId) {
    const transits = await readTransits(terms, account, await pinBlocks(terms))
    const open = transits.filter(transit => transit.kind === 'fillable' || (transit.kind === 'expired' && transit.owed > 0n))
    if (open.length > 0) {
      throw new Error(`a bridge from your fund is still settling (${open.map(transit => transit.kind).join(', ')}); a new cross-chain swap waits until it fills or is refunded`)
    }
  }
  const swapped = await runSwapStep(
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
    ctx
  )
  return swapped.steps[0]!
}

export async function runDraft(draft: IDraft, ctx: ExecContext, onWalletTx?: IReportWalletTx): Promise<IAttestation[]> {
  if (draft.kind === 'mandate') return [await runMandateBatch([draft], ctx)]
  if (draft.kind === 'operate') return [await runOperateStep(draft, ctx)]
  if (draft.kind === 'allocate') {
    const record = await fundForRound(draft.identity, ctx)
    onWalletTx?.('key', null)
    return [await runAllocateStep(draft, record, ctx)]
  }
  if (draft.kind === 'sell') return [await runSellStep(draft, ctx)]
  if (draft.kind === 'redeem') return [await runRedeemStep(draft, ctx)]
  if (draft.kind === 'fundSwap') return [await runFundSwapStep(draft, ctx)]
  if (draft.kind === 'withdraw') return [await runWithdrawStep(draft.input, (await rootOf(ctx)).account, draft.chainId, ctx)]
  if (draft.toEscrow) return fundEscrow(draft, ctx, onWalletTx)
  const leg = draft.deposit
  const crossChain = BigInt(leg.chainId) !== leg.destinationChainId
  await fundAccount(draft, ctx, onWalletTx)
  if (!crossChain && leg.route === null) return []
  if (leg.route === null) throw new Error('a crosschain deposit needs a bridge route')
  const swapped = await runSwapStep({ ...leg, route: leg.route }, (await rootOf(ctx)).account, ctx, onWalletTx)
  return swapped.steps
}
