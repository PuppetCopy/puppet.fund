import { coregateAbi, hubgateAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type {
  IAccountLib__Mandate,
  ICoreGate__OperateIntent,
  ICoreGate__SettleIntent,
  IDeposit__ScheduledCredit,
  IHubGate__DrawIntent,
  IHubGate__MandateIntent,
  IHubGate__UnbondIntent
} from '@puppet/contracts/types'
import {
  accountCallsFromReceipt,
  entryDeltas,
  type IBodyGenesis,
  type IBodySigner,
  predictDepositRoute,
  signBodyGenesis
} from '@puppet/sdk/account'
import { CompactError, type IDispatchedFrame, type IDispatchRequest, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import { type ChainId, deploymentAddress, resolveDispatchChainId } from '@puppet/sdk/const'
import { awaitWhile, getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { screenSwapValue, VALUE_KEY } from '@puppet/sdk/evaluate'
import {
  attestDepositSwap,
  attestMandateIntent,
  attestScheduledCredit,
  attestWithdrawIntent,
  type IActionKind,
  type IDepositSwapInput,
  type IIntentByKind,
  type IScheduledCredit,
  type ISwapRoute,
  type ITermsDeps,
  type IWithdrawInput,
  type IWithdrawRoute,
  intentTypedData,
  isDerivedAction,
  mandateDigest,
  operateTermsOf,
  quoteAcrossDeposit,
  quoteAcrossSwapAndBridge,
  quoteLifiSwap,
  readOperateContext,
  readSettleContext,
  routeCalldataBytes,
  routeQuoteExpiry,
  scheduledCreditTypedData,
  settleTermsOf
} from '@puppet/sdk/intent'
import {
  bondTokenOf,
  chainTokenOfKey,
  declaredCallGas,
  dynamicCalldataBytes,
  fetchTokenBalance,
  tokenInfoFor,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import { operateOutflows } from '@puppet/sdk/venue'
import { type Address, erc20Abi, getAddress, type Hex, hashTypedData, isAddressEqual, type PublicClient, type TypedDataDefinition, } from 'viem'
import { readContract, writeContract } from 'viem/actions'
import context, { getRate } from '../../../io/context.js'
import { client as chronicle } from '../../../io/datastore/reads.js'
import { journal } from '../../../io/journal/journal.js'
import { compact } from '../../../io/matchmaker/index.js'
import { readTokenBalance } from '../../../io/onchain/account.js'
import { publicClientMap } from '../../../wallet/wallet.js'
import {
  type ICreditDraft,
  type IDepositFunding,
  type IDepositLeg,
  type IDraft,
  type IMandateDraft,
  type IOperateDraft,
  type IReportWalletTx,
  type ISettleDraft,
  type IUnbondDraft,
  type IUnsealed
} from '../draft.js'
import { DEFAULT_DEADLINE_SEC, type ExecContext, envelopeNonce, publicClientForChain, quoteRelayFee, rootOf, walletClientForChain } from './_shared.js'

const terms: ITermsDeps = { chronicle, clients: publicClientMap, getRate, getTokenRegistry: context.getTokenRegistry }

type IStepIntentByKind = IIntentByKind & { credit: IScheduledCredit }

type IStepRequest =
  | { [K in IActionKind]: { kind: K; chainId: ChainId; intent: IStepIntentByKind[K] } }[IActionKind]
  | { kind: 'deposit'; chainId: ChainId; intent: { account: Address; token: Address; amount: bigint; bond: bigint } }

export type IAttestation = {
  request: IStepRequest
  result: IDispatchedFrame
  settledBlock: bigint
  deltas: Map<Address, bigint>
}

async function bodySigner(ctx: ExecContext, account: Address): Promise<IBodySigner> {
  if (ctx.bodyKeys === null) throw new Error(`this build carries no body key service; ${account} cannot sign`)
  const signer = await ctx.bodyKeys.signerOf(ctx.wallet.address)
  if (signer === null) throw new Error(`no key share cached for ${ctx.wallet.address}; sign a session to re-derive it`)
  if (!isAddressEqual(signer.account, account)) {
    throw new Error(`this wallet derives ${signer.account}, not ${account}; only the wallet that derived it can reproduce its key`)
  }
  return signer
}

async function dispatchAndSettle(wire: IDispatchRequest, record: IStepRequest, intentDigest: Hex): Promise<IAttestation> {
  const ack = await compact.dispatch(wire).catch(async (err: unknown) => {
    if (!(err instanceof CompactError) || err.code !== 'DISPATCH_TIMEOUT') throw err
    if (!('header' in record.intent)) throw err
    const account = record.intent.header.account
    await journal(account).refresh()
    if (await journal(account).holds(record.chainId, intentDigest)) {
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
      `transaction ${ack.txHash} settled without an AccountCall for your ${record.kind} (digest ${intentDigest}); nonce ${ack.nonce} on ${ack.account} was consumed by a different action, so nothing of yours moved. Resubmit from a fresh quote.`
    )
  }
  const logs = receipt.logs.map(log => ({ address: getAddress(log.address), topics: [...log.topics], data: log.data, logIndex: log.logIndex }))
  await journal(ack.account).settle({ chainId: record.chainId, block: call.blockNumber })
  return { request: record, result: ack, settledBlock: call.blockNumber, deltas: entryDeltas(ack.account, { chainId: record.chainId, callList: call.callList, logs, value }) }
}

const SCHEDULED_CREDIT_TTL_SEC = 6 * 60 * 60

function scheduledClaim(token: Address, amount: bigint, fee: bigint): IScheduledCredit['claim'] {
  return { token, amount, expiry: BigInt(Math.floor(Date.now() / 1000) + SCHEDULED_CREDIT_TTL_SEC), fee }
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
  const account = 'header' in intent ? intent.header.account : intent.account
  if (isDerivedAction(kind) || kind === 'unbond') {
    const deadline = Date.now() + CHRONICLE_CATCHUP_TIMEOUT_MS
    for (;;) {
      const standing = await journal(account).chronicle()
      if ('behind' in standing) {
        const behind = standing.behind.get(chainId)
        if (behind === undefined) throw new Error(`chain ${chainId} could not be probed for your account; retry once it answers`)
        if (behind === 0) break
        if (Date.now() > deadline) {
          throw new Error(
            `the chronicle has not folded your last ${behind} action${behind === 1 ? '' : 's'} on chain ${chainId} within ${CHRONICLE_CATCHUP_TIMEOUT_MS}ms; the attestor refuses ${kind} until it catches up, retry in a moment`
          )
        }
      } else if (Date.now() > deadline) {
        throw new Error(
          'unreachable' in standing
            ? `the chronicle could not be reached (${standing.unreachable}); the attestor compares your account against it before co-signing ${kind}`
            : standing.disagrees
        )
      }
      await new Promise(r => setTimeout(r, 3_000))
    }
  }
  const signature = await (await bodySigner(ctx, account)).signIntent(digest)
  return dispatchAndSettle(
    { kind, chainId, input, signature, genesis } as IDispatchRequest,
    { kind, chainId, intent } as IStepRequest,
    digest
  )
}

const createsAccount = async (ctx: ExecContext, chainId: ChainId): Promise<boolean> => {
  const root = await rootOf(ctx)
  if (root.unreachable.has(chainId)) throw new Error(`chain ${chainId} could not be probed for your account; retry once it answers`)
  return !root.deployed.has(chainId)
}

function accountSession(ctx: ExecContext): { signature: Hex; expiry: bigint } {
  const keys = ctx.bodyKeys === null ? null : ctx.bodyKeys.keysOf(ctx.wallet.address)
  if (keys === null) throw new Error(`no session is cached for ${ctx.wallet.address}; sign a session to re-derive it`)
  return { signature: keys.session, expiry: keys.sessionExpiry }
}

async function bodyGenesis(
  ctx: ExecContext,
  account: Address,
  chainId: ChainId
): Promise<IBodyGenesis | undefined> {
  if (!(await createsAccount(ctx, chainId))) return undefined
  const signer = await bodySigner(ctx, account)
  const genesis = { account, user: ctx.wallet.address, signer: signer.signer }
  return signBodyGenesis(signer, genesis, accountSession(ctx), false)
}

const BRIDGE_FILL_TIMEOUT_MS = 15 * 60 * 1000
const LOCAL_SETTLE_TIMEOUT_MS = 2 * 60 * 1000

function resolveTokenAddress(ctx: ExecContext, chainId: ChainId, token: Address): Address {
  if (isAddressEqual(token, PROTOCOL.nativeToken)) return token
  return tokenInfoFor(ctx.tokenRegistry, chainId, token).token
}

async function fundRoute(funding: IDepositFunding, ctx: ExecContext, onTx?: IReportWalletTx): Promise<void> {
  const leg = funding.deposit
  const chainId = resolveDispatchChainId(leg.chainId)
  const route = predictDepositRoute(ctx.wallet.address)
  const publicClient = publicClientForChain(chainId)
  const wnt = wrappedNativeAddressOf(chainId)
  const delivered = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const fused = isAddressEqual(delivered, PROTOCOL.nativeToken) || isAddressEqual(delivered, wnt)
  const held = fused
    ? (await fetchTokenBalance(publicClient, wnt, route)) + (await publicClient.getBalance({ address: route }))
    : await fetchTokenBalance(publicClient, delivered, route)
  if (held >= leg.inputAmount) return
  const short = leg.inputAmount - held
  const wallet = await walletClientForChain(ctx.wallet.walletClient, chainId)
  let value = 0n
  if (fused) {
    const walletWrapped = await fetchTokenBalance(publicClient, wnt, ctx.wallet.address)
    value = walletWrapped < short ? short - walletWrapped : 0n
    if (value > 0n) {
      const nativeBalance = await publicClient.getBalance({ address: ctx.wallet.address })
      if (nativeBalance < value) {
        throw new Error(
          `this deposit needs ${value} native on chain ${chainId} beyond your wrapped balance and the wallet holds ${nativeBalance}. Bridge more native first or lower the amount.`
        )
      }
    }
  }
  const pull = short - value
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
      onTx?.('approve', approveHash, chainId)
    }
  }
  const hash = await writeContract(wallet, {
    address: deploymentAddress('CoreGate', chainId),
    abi: coregateAbi,
    functionName: 'depositRoute',
    args: [delivered, short],
    value,
    account: ctx.wallet.address,
    chain: wallet.chain
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: LOCAL_SETTLE_TIMEOUT_MS })
  if (receipt.status !== 'success') {
    throw new Error(`funding your deposit route with ${short} ${delivered} reverted on-chain (tx ${hash}); nothing moved, retry from a fresh quote`)
  }
  onTx?.('fund', hash, chainId)
}

async function runDirectDeposit(ctx: ExecContext, account: Address, funding: IDepositFunding, bond: bigint, onTx?: IReportWalletTx): Promise<IAttestation> {
  const leg = funding.deposit
  const chainId = resolveDispatchChainId(leg.chainId)
  const publicClient = publicClientForChain(chainId)
  const wnt = wrappedNativeAddressOf(chainId)
  const token = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const fused = isAddressEqual(token, PROTOCOL.nativeToken) || isAddressEqual(token, wnt)
  const pulled = fused ? wnt : token
  const pull = leg.inputAmount - funding.nativeValue
  const wallet = await walletClientForChain(ctx.wallet.walletClient, chainId)
  if (pull > 0n) {
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
      onTx?.('approve', approveHash, chainId)
    }
  }
  const txHash =
    bond > 0n
      ? await writeContract(wallet, {
          address: deploymentAddress('HubGate', chainId),
          abi: hubgateAbi,
          functionName: 'deposit',
          args: [account, token, leg.inputAmount, bond],
          value: funding.nativeValue,
          account: ctx.wallet.address,
          chain: wallet.chain
        })
      : await writeContract(wallet, {
          address: deploymentAddress('CoreGate', chainId),
          abi: coregateAbi,
          functionName: 'deposit',
          args: [account, token, leg.inputAmount],
          value: funding.nativeValue,
          account: ctx.wallet.address,
          chain: wallet.chain
        })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: LOCAL_SETTLE_TIMEOUT_MS })
  if (receipt.status !== 'success') throw new Error(`the deposit reverted on-chain (tx ${txHash}); nothing moved, retry from a fresh quote`)
  onTx?.('deposit', txHash, chainId)
  const logs = receipt.logs.map(log => ({ address: getAddress(log.address), topics: [...log.topics], data: log.data, logIndex: log.logIndex }))
  const deltas = entryDeltas(account, { chainId, callList: [], logs, value: 0n })
  if (isAddressEqual(token, PROTOCOL.nativeToken)) deltas.set(token, (deltas.get(token) ?? 0n) + leg.inputAmount - bond)
  return {
    request: { kind: 'deposit', chainId, intent: { account, token, amount: leg.inputAmount, bond } },
    result: { account, nonce: await envelopeNonce(account, chainId), txHash, relayFee: 0n },
    settledBlock: receipt.blockNumber,
    deltas
  }
}

const BRIDGE_FILL_FLOOR_MS = 30_000
function bridgeFillTimeoutMs(fillDeadlineSec: number): number {
  const untilDeadline = Math.floor(fillDeadlineSec * 1000) - Date.now()
  return Math.min(BRIDGE_FILL_TIMEOUT_MS, Math.max(BRIDGE_FILL_FLOOR_MS, untilDeadline))
}

async function awaitBridgeFill(p: { client: PublicClient; token: Address; route: Address; min: bigint; fillDeadline: number }): Promise<bigint> {
  return awaitWhile(
    {
      timeoutMs: bridgeFillTimeoutMs(p.fillDeadline),
      pollMs: 2_000,
      timeoutMessage: `the bridge did not deliver to ${p.route} within its fill deadline; if the fill failed, the funds return as a refund on the origin chain or as the bridged input token on the destination, and both surface as recoverable surplus in the deposit editor`
    },
    async () => {
      const balance = await fetchTokenBalance(p.client, p.token, p.route)
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
  account: Address,
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
    const fresh = await quoteAcrossSwapAndBridge('', account, recipient, {
      chainId,
      destinationChainId: leg.destinationChainId,
      inputToken,
      outputToken: resolveTokenAddress(ctx, resolveDispatchChainId(Number(leg.destinationChainId)), leg.outputToken),
      inputAmount: net,
      timing: await context.getAcrossTiming(chainId)
    })
    return { route: fresh.route, outputAmount: fresh.outputAmount, fillDeadline: fresh.fillDeadline }
  }
  const fresh = await quoteLifiSwap('', account, recipient, { chainId, inputToken, outputToken: resolveTokenAddress(ctx, chainId, leg.outputToken), inputAmount: net })
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
  const route = predictDepositRoute(ctx.wallet.address)
  const token = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const publicClient = publicClientForChain(chainId)
  const wnt = wrappedNativeAddressOf(chainId)
  const destChainId = resolveDispatchChainId(Number(leg.destinationChainId))
  const arrivalToken = resolveTokenAddress(ctx, destChainId, leg.outputToken)
  const [relayFee, creditFee, nonce, signer] = await Promise.all([
    quoteRelayFee(chainId, 'depositAcross', await createsAccount(ctx, chainId), token, 0n, 0n, routeCalldataBytes(leg.route)),
    quoteRelayFee(destChainId, 'credit', await createsAccount(ctx, destChainId), arrivalToken, 1n, 0n, 0n),
    envelopeNonce(account, chainId),
    bodySigner(ctx, account)
  ])
  const fresh = await requoteRoute(ctx, chainId, account, route, { ...leg, inputToken: token, outputToken: arrivalToken }, relayFee)
  const notAfter = routeQuoteExpiry(fresh.route, await context.getAcrossTiming(chainId))
  const claim = scheduledClaim(arrivalToken, fresh.outputAmount, creditFee)
  const claimDigest = hashTypedData(scheduledCreditTypedData(destChainId, account, claim))
  const claimSignature = await signer.signIntent(claimDigest)
  const input: IDepositSwapInput = {
    chainId,
    inputToken: token,
    outputToken: arrivalToken,
    inputAmount: leg.inputAmount,
    outputAmount: fresh.outputAmount,
    destinationChainId: leg.destinationChainId,
    credit: { claim, signature: claimSignature },
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
  const routeTokens = [...new Set([token, PROTOCOL.nativeToken, wnt].map(each => getAddress(each)))]
  const routeBalances = new Map(
    await Promise.all(routeTokens.map(async each => [each, await fetchTokenBalance(publicClient, each, route)] as const))
  )
  const { intent, typedData } = attestDepositSwap(
    { chainId, tokenRegistry: ctx.tokenRegistry, routeBalances, timing: await context.getAcrossTiming(chainId) },
    input
  )
  const digest = hashTypedData(typedData)
  const signature = await signer.signIntent(digest)
  const genesis = (await bodyGenesis(ctx, account, chainId)) ?? (await bodyGenesis(ctx, account, destChainId))
  const swapped = await dispatchAndSettle({ kind: 'depositAcross', chainId, input, signature, genesis } as IDispatchRequest, { kind: 'depositAcross', chainId, intent }, digest)
  onTx?.('swap', swapped.result.txHash, chainId)
  const credited = await settleDepositCredit(
    { sourceChainId: chainId, chainId: destChainId, claim, signature: claimSignature, digest: claimDigest, fillDeadline: fresh.fillDeadline, genesis },
    account,
    ctx
  )
  onTx?.('credit', credited.result.txHash, destChainId)
  return { steps: [swapped, credited], arrival: claim.amount - claim.fee }
}

const CREDIT_SWEEP_TIMEOUT_MS = 3 * 60 * 1000
const CHRONICLE_CATCHUP_TIMEOUT_MS = 3 * 60 * 1000

async function settleDepositCredit(
  p: { sourceChainId: ChainId; chainId: ChainId; claim: IDeposit__ScheduledCredit; signature: Hex; digest: Hex; fillDeadline: number; genesis: IBodyGenesis | undefined },
  account: Address,
  ctx: ExecContext
): Promise<IAttestation> {
  const { chainId } = p
  if (chainId !== p.sourceChainId) {
    await awaitBridgeFill({ client: publicClientForChain(chainId), token: p.claim.token, route: predictDepositRoute(ctx.wallet.address), min: p.claim.amount, fillDeadline: p.fillDeadline })
  }
  const input: IScheduledCredit = { account, user: ctx.wallet.address, claim: p.claim }
  const record: IStepRequest = { kind: 'credit', chainId, intent: input }
  let ack: IDispatchedFrame
  try {
    ack = await compact.dispatch({ kind: 'credit', chainId, input, signature: p.signature, genesis: p.genesis } as IDispatchRequest)
  } catch (refused) {
    const landed = await awaitWhile(
      {
        timeoutMs: CREDIT_SWEEP_TIMEOUT_MS,
        pollMs: 3_000,
        timeoutMessage: `the swap output reached your deposit route on chain ${chainId} but its credit into ${account} was not observed within ${CREDIT_SWEEP_TIMEOUT_MS}ms (the relay declined your own credit: ${refused instanceof Error ? refused.message : String(refused)}); the relay keeps trying until the credit expires, reopen later to pick up the new state`
      },
      async () => {
        await journal(account).sync()
        const list = (await journal(account).entries()).get(chainId)
        return list === undefined ? undefined : list.find(e => e.digest === p.digest)
      }
    )
    return {
      request: record,
      result: { account, nonce: await envelopeNonce(account, chainId), txHash: landed.transactionHash, relayFee: p.claim.fee },
      settledBlock: landed.blockNumber,
      deltas: entryDeltas(account, { chainId, callList: landed.callList, logs: landed.logs, value: landed.value })
    }
  }
  return settle(ack, record, p.digest, 0n)
}

async function runWithdrawStep(leg: IUnsealed<IWithdrawInput>, account: Address, sourceChainId: ChainId, ctx: ExecContext): Promise<IAttestation> {
  const chainId = resolveDispatchChainId(sourceChainId)
  const token = resolveTokenAddress(ctx, chainId, leg.inputToken)
  const publicClient = publicClientForChain(chainId)
  const [relayFee, nonce] = await Promise.all([
    quoteRelayFee(chainId, 'withdraw', false, leg.inputToken, 0n, 0n, routeCalldataBytes(leg.route)),
    envelopeNonce(account, chainId)
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
  const sourceBalance = await fetchTokenBalance(publicClient, token, account)
  const { intent, typedData } = attestWithdrawIntent({ chainId, tokenRegistry: ctx.tokenRegistry, sourceBalance, timing: await context.getAcrossTiming(chainId) }, input)
  return dispatch('withdraw', chainId, input, intent, typedData, ctx)
}

export async function runMandateBatch(drafts: readonly IMandateDraft[], ctx: ExecContext, feeFrom: 'balance' | 'bond'): Promise<IAttestation> {
  if (drafts.length === 0) throw new Error('a hub broadcast needs at least one bond or mandate')
  const account = (await rootOf(ctx)).account
  const signer = await bodySigner(ctx, account)
  const mandateList: IAccountLib__Mandate[] = drafts
    .map(d => d.mandate)
    .filter((m): m is IAccountLib__Mandate => m !== null)
    .sort((a, b) => (BigInt(a.master) < BigInt(b.master) ? -1 : 1))
  const feeToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
  const bondToken = bondTokenOf(HUB_CHAIN_ID)
  const hubClient = publicClientForChain(HUB_CHAIN_ID)
  const route = predictDepositRoute(ctx.wallet.address)
  const [nonce, feeTokenBalance, accountBond, routeBond, relayFee] = await Promise.all([
    envelopeNonce(account, HUB_CHAIN_ID),
    fetchTokenBalance(hubClient, feeToken, account),
    fetchTokenBalance(hubClient, bondToken, account),
    fetchTokenBalance(hubClient, bondToken, route),
    quoteRelayFee(HUB_CHAIN_ID, 'mandate', await createsAccount(ctx, HUB_CHAIN_ID), feeToken, BigInt(mandateList.length), 0n, 0n)
  ])
  const asked = drafts.reduce((total, d) => total + d.bond, 0n)
  const bond = feeFrom === 'bond' && isAddressEqual(feeToken, bondToken) ? asked - relayFee : asked
  if (feeFrom === 'bond' && bond <= 0n) {
    throw new Error(`the ${relayFee} relay fee leaves nothing of the ${asked} that arrived to bond`)
  }
  const creditList = routeBond > 0n ? [bondToken] : []
  const bondTokenBalance = accountBond + routeBond
  const signatureList = await Promise.all(mandateList.map(m => signer.signIntent(mandateDigest(account, m))))
  const intent: IHubGate__MandateIntent = {
    header: intentHeader(ctx, account, nonce, feeToken, relayFee),
    creditList,
    bond,
    mandateList,
    signatureList
  }
  const genesis = await bodyGenesis(ctx, account, HUB_CHAIN_ID)
  const typedData = await attestMandateIntent(
    {
      chainId: HUB_CHAIN_ID,
      tokenRegistry: ctx.tokenRegistry,
      nonce,
      body: genesis === undefined ? { user: (await rootOf(ctx)).user, signer: signer.signer } : null,
      genesis: genesis === undefined ? null : { signer: genesis.signer, key: genesis.key },
      routeBalances: new Map([[bondToken, routeBond]]),
      feeTokenBalance,
      bondToken,
      bondTokenBalance
    },
    intent
  )
  return dispatch('mandate', HUB_CHAIN_ID, intent, intent, typedData, ctx, genesis)
}

async function runUnbondStep(draft: IUnbondDraft, ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const feeToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
  const [nonce, relayFee] = await Promise.all([
    envelopeNonce(account, HUB_CHAIN_ID),
    quoteRelayFee(HUB_CHAIN_ID, 'unbond', false, feeToken, 0n, 0n, 0n)
  ])
  const intent: IHubGate__UnbondIntent = {
    header: intentHeader(ctx, account, nonce, feeToken, relayFee),
    amount: draft.amount
  }
  return dispatch('unbond', HUB_CHAIN_ID, intent, intent, intentTypedData('unbond', HUB_CHAIN_ID, intent), ctx)
}

async function runCreditStep(draft: ICreditDraft, ctx: ExecContext): Promise<IAttestation> {
  const root = await rootOf(ctx)
  const account = root.account
  const chainId = draft.chainId
  const tokenList = [...new Set(draft.creditList.map(t => resolveTokenAddress(ctx, chainId, t)))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1
  )
  const feeToken = tokenList[0]
  if (feeToken === undefined) throw new Error('a credit sweeps at least one token')
  const publicClient = publicClientForChain(chainId)
  const route = predictDepositRoute(ctx.wallet.address)
  const readTokens = [...new Set([...tokenList, getAddress(PROTOCOL.nativeToken), wrappedNativeAddressOf(chainId)])]
  const [relayFee, routeBalanceList, signer, genesis] = await Promise.all([
    quoteRelayFee(chainId, 'credit', await createsAccount(ctx, chainId), feeToken, BigInt(tokenList.length), 0n, 0n),
    Promise.all(readTokens.map(token => fetchTokenBalance(publicClient, token, route))),
    bodySigner(ctx, account),
    bodyGenesis(ctx, account, chainId)
  ])
  const routeBalances = new Map(readTokens.map((token, i) => [token, routeBalanceList[i]!]))
  const arrived = tokenList.reduce((total, token) => total + (routeBalances.get(token) ?? 0n), 0n)
  if (arrived === 0n) throw new Error(`nothing has arrived on your deposit route for ${tokenList.join(', ')} on chain ${chainId}; fund the route first`)
  const claim = scheduledClaim(feeToken, arrived, relayFee)
  const input: IScheduledCredit = { account, user: root.user, claim }
  const digest = hashTypedData(scheduledCreditTypedData(chainId, account, claim))
  const signature = await signer.signIntent(digest)
  const wire = { kind: 'credit', chainId, input, signature, genesis } as IDispatchRequest
  const record = { kind: 'credit', chainId, intent: input } as IStepRequest
  attestScheduledCredit({ chainId, tokenRegistry: ctx.tokenRegistry, routeBalances }, input)
  return dispatchAndSettle(wire, record, digest)
}

export async function runOperateStep(draft: IOperateDraft, ctx: ExecContext): Promise<IAttestation> {
  const account = (await rootOf(ctx)).account
  const chainId = draft.chainId
  const feeToken = resolveTokenAddress(ctx, chainId, draft.feeToken)
  const token = resolveTokenAddress(ctx, chainId, draft.token)
  const composed = operateTermsOf(
    await readOperateContext(terms, chainId, account, Math.floor(Date.now() / 1000)),
    tokenInfoFor(ctx.tokenRegistry, chainId, token).tokenId,
    draft.skin
  )
  const [nonce, relayFee] = await Promise.all([
    envelopeNonce(account, chainId),
    quoteRelayFee(
      chainId,
      'operate',
      false,
      feeToken,
      BigInt(composed.backingList.length),
      declaredCallGas(draft.callList),
      dynamicCalldataBytes(draft.callList.map(call => call.callData))
    )
  ])
  const feeTokenBalance = await readTokenBalance(account, chainId, feeToken, 0)
  const feeTokenOutflow = operateOutflows(draft.callList).reduce((total, o) => (isAddressEqual(o.token, feeToken) ? total + o.amount : total), 0n)
  if (feeTokenBalance - feeTokenOutflow < relayFee) {
    const description = getTokenDescription(chainId, feeToken)
    throw new Error(
      `Your account keeps ${readableTokenAmountLabel(description, feeTokenBalance - feeTokenOutflow)} on chain ${chainId} after this action, below the ${readableTokenAmountLabel(description, relayFee)} relay fee. Deposit more into the account first.`
    )
  }
  const intent: ICoreGate__OperateIntent = {
    header: intentHeader(ctx, account, nonce, feeToken, relayFee),
    creditList: [],
    cycle: composed.cycle,
    token,
    value: composed.value,
    collateral: composed.collateral,
    skin: draft.skin,
    backed: composed.backed,
    backingList: composed.backingList,
    callList: draft.callList
  }
  return dispatch('operate', chainId, intent, intent, intentTypedData('operate', chainId, intent), ctx)
}

async function runSettleStep(draft: ISettleDraft, ctx: ExecContext): Promise<IAttestation[]> {
  const account = (await rootOf(ctx)).account
  const spokeChainId = draft.spokeChainId
  const settleCtx = await readSettleContext(terms, spokeChainId, account, resolveTokenAddress(ctx, spokeChainId, draft.token))
  const composed = settleTermsOf(settleCtx)
  const out: IAttestation[] = []
  if (settleCtx.settled === undefined) {
    const spokeFeeToken = chainTokenOfKey(spokeChainId, VALUE_KEY)
    const [spokeNonce, spokeRelayFee] = await Promise.all([
      envelopeNonce(account, spokeChainId),
      quoteRelayFee(spokeChainId, 'settle', false, spokeFeeToken, BigInt(composed.gainList.length), 0n, 0n)
    ])
    const settleIntent: ICoreGate__SettleIntent = {
      header: intentHeader(ctx, account, spokeNonce, spokeFeeToken, spokeRelayFee),
      cycle: composed.cycle,
      token: settleCtx.token,
      value: composed.value,
      gainList: composed.gainList
    }
    out.push(await dispatch('settle', spokeChainId, settleIntent, settleIntent, intentTypedData('settle', spokeChainId, settleIntent), ctx))
  }
  if (composed.lossList.length === 0) return out
  const hubFeeToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
  const [hubNonce, hubRelayFee] = await Promise.all([
    envelopeNonce(account, HUB_CHAIN_ID),
    quoteRelayFee(HUB_CHAIN_ID, 'draw', await createsAccount(ctx, HUB_CHAIN_ID), hubFeeToken, BigInt(composed.lossList.length), 0n, 0n)
  ])
  const drawIntent: IHubGate__DrawIntent = {
    header: intentHeader(ctx, account, hubNonce, hubFeeToken, hubRelayFee),
    spokeChainId: BigInt(spokeChainId),
    cycle: composed.cycle,
    lossList: composed.lossList
  }
  const genesis = await bodyGenesis(ctx, account, HUB_CHAIN_ID)
  return [...out, await dispatch('draw', HUB_CHAIN_ID, drawIntent, drawIntent, intentTypedData('draw', HUB_CHAIN_ID, drawIntent), ctx, genesis)]
}

export async function runDraft(draft: IDraft, ctx: ExecContext, onWalletTx?: IReportWalletTx): Promise<IAttestation[]> {
  if (draft.kind === 'mandate') return [await runMandateBatch([draft], ctx, 'balance')]
  if (draft.kind === 'unbond') return [await runUnbondStep(draft, ctx)]
  if (draft.kind === 'credit') return [await runCreditStep(draft, ctx)]
  if (draft.kind === 'operate') return [await runOperateStep(draft, ctx)]
  if (draft.kind === 'settle') return runSettleStep(draft, ctx)
  if (draft.kind === 'withdraw') return [await runWithdrawStep(draft.input, (await rootOf(ctx)).account, draft.chainId, ctx)]
  const out: IAttestation[] = []
  const leg = draft.deposit
  const sourceChainId = resolveDispatchChainId(leg.chainId)
  const destChainId = resolveDispatchChainId(Number(leg.destinationChainId))
  const arrivalToken = resolveTokenAddress(ctx, destChainId, leg.outputToken)
  const crossChain = BigInt(leg.chainId) !== leg.destinationChainId
  const bondToken = bondTokenOf(HUB_CHAIN_ID)
  if (draft.arrival === 'bond' && (destChainId !== HUB_CHAIN_ID || !isAddressEqual(arrivalToken, bondToken))) {
    throw new Error(
      `this deposit lands ${arrivalToken} on chain ${destChainId}, which cannot be bonded; only ${bondToken} on chain ${HUB_CHAIN_ID} enters the bond pool`
    )
  }
  if (!crossChain && leg.route === null && ctx.root?.deployed.has(sourceChainId)) {
    out.push(await runDirectDeposit(ctx, ctx.root.account, draft, draft.arrival === 'bond' ? leg.outputAmount : 0n, onWalletTx))
    return out
  }
  await fundRoute(draft, ctx, onWalletTx)
  let arrival = leg.outputAmount
  if (!crossChain && leg.route === null) {
    if (draft.arrival === 'credit') {
      const credited = await runCreditStep(
        { kind: 'credit', id: `credit:${sourceChainId}:${arrivalToken}`, chainId: sourceChainId, creditList: [arrivalToken] },
        ctx
      )
      onWalletTx?.('credit', credited.result.txHash, sourceChainId)
      out.push(credited)
    }
  } else {
    if (leg.route === null) throw new Error('a crosschain deposit needs a bridge route')
    const swapped = await runSwapStep({ ...leg, route: leg.route }, (await rootOf(ctx)).account, ctx, onWalletTx)
    out.push(...swapped.steps)
    arrival = swapped.arrival
  }
  if (draft.arrival === 'bond') {
    const bonded = await runMandateBatch([{ kind: 'mandate', id: 'bond', bond: arrival, mandate: null }], ctx, 'bond')
    onWalletTx?.('mandate', bonded.result.txHash, HUB_CHAIN_ID)
    out.push(bonded)
  }
  return out
}
