import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type {
  IAccountLib__AccountInitParams,
  IFundAccountLib__FundAccountInitParams,
  IIAccount__SignTransfer
} from '@puppet/contracts/types'
import { predictDepositRoute, predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import {
  attestAllocateIntent,
  attestClaimIntent,
  attestFundRecognizeIntent,
  attestFundSwapIntent,
  attestLiquidateIntent,
  attestMandateIntent,
  attestOperateIntent,
  attestRecognizeBalanceIntent,
  attestRedeemIntent,
  attestSellIntent,
  attestSwapIntent,
  attestWithdrawIntent,
  attestWrapIntent,
  type IAllocateInput,
  type IClaimInput,
  type IDepositRoute,
  type IFundRecognizeInput,
  type IFundSwapInput,
  type ILiquidateInput,
  type IMandateInput,
  type IMandateRule,
  type IOperateInput,
  type IRecognizeBalanceInput,
  type IRedeemInput,
  type ISellInput,
  type ISwapInput,
  type IWithdrawInput,
  type IWrapInput,
  resolveDispatchChainId
} from '@puppet/sdk/attestation'
import { CompactError, type IDispatchedFrame, type IRelayRequest, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { awaitWhile } from '@puppet/sdk/core'
import { assertNavSignable, evaluateCrossChainSwapValue, evaluateSwapValue } from '@puppet/sdk/evaluate'
import { fundPositionTable } from '@puppet/sdk/schema'
import {
  awaitAccountCall,
  awaitWalletDeposit,
  computeClaimable,
  fetchDepositRouteBalance,
  fetchRouteBalance,
  isNonceConsumed,
  pollDepositRouteBalance,
  pollRouteBalance,
  randomNonce,
  symbolByAddress,
  tokenInfoFor,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import {
  type Address,
  erc20Abi,
  getAddress,
  type Hex,
  isAddressEqual,
  type PublicClient,
  type TypedDataDefinition
} from 'viem'
import { getBalance, readContract, sendCalls, writeContract } from 'viem/actions'
import { fetchLifiSwapQuote } from '../../../io/bridge/lifiSwap.js'
import { fetchSwapQuote } from '../../../io/bridge/swapQuote.js'
import { getRate } from '../../../io/context.js'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../../io/datastore/query.js'
import { client } from '../../../io/datastore/reads.js'
import { compact } from '../../../io/matchmaker/index.js'
import { readAccountDeployed, readSignedBalance } from '../../../io/onchain/account.js'
import { homePublicClient, } from '../../../wallet/index.js'
import type { IDepositDraft, IDraft, IFundSwapDraft, ISubscribeDraft } from '../draft.js'
import {
  DEFAULT_DEADLINE_SEC,
  type ExecContext,
  pollCallsStatus,
  publicClientForChain,
  resolveRelayFee,
  stepMetadata,
  supportsAtomicBatch,
  walletClientForChain
} from './_shared.js'
import { buildAllocateInput } from './allocate.js'
import { buildClaimInput, buildLiquidateInput, buildRedeemInput, buildSellInput } from './redeem.js'
import { buildMandateInput } from './subscribe.js'

export type IAttestation = {
  request: IRelayRequest
  token: Address
  result: IDispatchedFrame
  // The dispatch tx's mined block (from its receipt) — the floor the settlement REFRESH reads pin at: an eth_call
  // served by a load-balanced node lagging this block answers with pre-settlement state and would otherwise be cached
  // as fresh. Falls back to the confirming client's head when the receipt is unavailable (e.g. the relay repriced).
  settledBlock: bigint
}

async function signAndSettle(
  request: Omit<IRelayRequest, 'signature'>,
  typedData: TypedDataDefinition,
  token: Address,
  ctx: ExecContext
): Promise<IAttestation | null> {
  // Idempotent re-run: a draft retried after a settle-timeout re-signs the SAME nonce (deposit/withdraw bake it at
  // Save). If the chain already consumed it, the step settled on the first attempt — skip instead of dispatching a
  // guaranteed nonce-revert; downstream steps re-read live balances.
  const intent = request.intent as { chainId: bigint; nonce: bigint }
  const execChainId = resolveDispatchChainId(Number(intent.chainId))
  const account = accountForRequest(request as IRelayRequest)
  const consumed = await isNonceConsumed(publicClientForChain(execChainId), account, intent.nonce).catch(() => false)
  if (consumed) return null
  const signature = await ctx.session.account.signTypedData(typedData)
  const signed = { ...request, signature } as IRelayRequest
  const ack = await compact.attest(signed)
  const settleClient = publicClientForChain(Number(ack.chainId))
  try {
    await awaitAccountCall(settleClient, ack.account, ack.nonce, SETTLEMENT_TIMEOUT_MS)
  } catch (err) {
    throw new Error(
      `${signed.kind} was dispatched (tx ${ack.txHash}) but its settlement was not confirmed in time, verify the transaction before retrying: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const settledBlock = await settleClient
    .getTransactionReceipt({ hash: ack.txHash })
    .then(r => r.blockNumber)
    .catch(() => settleClient.getBlockNumber())
  return { request: signed, token, result: ack, settledBlock }
}

export function computeSignedDelta(request: IRelayRequest, actualRelayFee: bigint): bigint {
  const intent = request.intent as unknown as {
    amount?: bigint
    inputAmount?: bigint
    initialDepositAmount?: bigint
    masterAmount?: bigint
  }
  switch (request.kind) {
    case 'allocate': {
      const allocatedAmountList = (request.input as { allocatedAmountList?: bigint[] }).allocatedAmountList ?? []
      const allocated = allocatedAmountList.reduce((acc, amount) => acc + amount, 0n)
      return (intent.masterAmount ?? 0n) + allocated - actualRelayFee
    }
    case 'recognize':
    case 'fundRecognize':
      return (intent.amount ?? 0n) - actualRelayFee
    case 'operate': {
      const legs = (request.input as { transferList?: { amountIn: bigint; amountOut: bigint }[] }).transferList ?? []
      return legs.reduce((acc, leg) => acc + leg.amountIn - leg.amountOut, 0n) - actualRelayFee
    }
    case 'withdraw':
      return -(intent.inputAmount ?? 0n)
    case 'swap':
      return 0n
    case 'fundSwap':
      // fromRoute=false debits the fund's signed inputToken by inputAmount; record() keys this delta by the request's
      // inputToken. The output-token credit rides a DIFFERENT token and is not projected by this single-token model
      // (a later same-draft step touching the output token re-reads live); the input debit is what intra-draft sizing needs.
      return -(intent.inputAmount ?? 0n)
    default:
      return -actualRelayFee
  }
}

// Recognize a closed position's return (funds the fund holds raw but hasn't co-signed) via a single pure-recognition
// operate: one leg per surplus token (base ERC-20 via balanceOf, native ETH via the account balance), amountIn = held -
// signedBalanceOf, empty callList. The fee binds to the first leg's token. The matchmaker screens it as pure
// recognition and the contract validates the amount against the live on-chain surplus, so a stale read can only
// under-credit, never over-credit. Returns null when there is nothing to recognize, so it folds in front of
// redeem/allocate the same way the deposit route-recognize folds into allocate/mandate (settled-but-uncosigned funds
// are credited first, then the value-action prices a correct NAV). signAndSettle waits for the recognize to settle
// on-chain, so the following step reads the updated signed balance.
async function recognizeFundSurplus(
  fundParams: { master: Address; fund: Address; baseToken: Address },
  ctx: ExecContext
): Promise<IAttestation | null> {
  const fund = getAddress(fundParams.fund)
  const nativeToken = PROTOCOL.nativeToken
  const [pool, baseSigned, baseHeld, nativeSigned, nativeHeld] = await Promise.all([
    fetchMasterPoolState(fund),
    fetchSignedBalance(ctx, fund, HUB_CHAIN_ID, fundParams.baseToken),
    readContract(homePublicClient, { address: fundParams.baseToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
    fetchSignedBalance(ctx, fund, HUB_CHAIN_ID, nativeToken),
    getBalance(homePublicClient, { address: fund })
  ])
  if (!pool) return null
  const baseSurplus = baseHeld > baseSigned ? baseHeld - baseSigned : 0n
  const nativeSurplus = nativeHeld > nativeSigned ? nativeHeld - nativeSigned : 0n
  const transferList: IIAccount__SignTransfer[] = []
  if (baseSurplus > 0n) {
    transferList.push({ token: fundParams.baseToken, amountIn: baseSurplus, amountOut: 0n })
  }
  if (nativeSurplus > 0n) {
    transferList.push({ token: nativeToken, amountIn: nativeSurplus, amountOut: 0n })
  }
  if (transferList.length === 0) return null

  const feeToken = transferList[0].token
  const acceptableRelayFee = await resolveRelayFee(ctx, HUB_CHAIN_ID, 'FundGate', 'operate', feeToken, 0n)
  const input: IOperateInput = {
    params: { user: ctx.wallet.address, signer: ctx.session.signer },
    fundParams: { master: fundParams.master, baseToken: fundParams.baseToken, name: pool.name as Hex },
    ...stepMetadata(ctx),
    acceptableRelayFee,
    chainId: BigInt(HUB_CHAIN_ID),
    callList: [],
    transferList
  }
  const { intent, typedData } = attestOperateIntent(
    {
      chainId: HUB_CHAIN_ID,
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: input.blockNumber,
      signedBalanceByToken: { [fundParams.baseToken]: baseSigned, [nativeToken]: nativeSigned }
    },
    input
  )
  return signAndSettle({ kind: 'operate', input, intent }, typedData, feeToken, ctx)
}

const PUPPET_GATE_ABI = DEPLOYMENTS[`PuppetGate:${HUB_CHAIN_ID}`].abi
const PUPPET_GATE_ADDRESS = DEPLOYMENTS[`PuppetGate:${HUB_CHAIN_ID}`].address

const BRIDGE_FILL_TIMEOUT_MS = 15 * 60 * 1000
// Local preconditions (same-chain wallet transfer landing, input funds reaching the route) settle in seconds; a
// planner/state bug there should fail fast, not consume the 15-minute bridge budget.
const LOCAL_SETTLE_TIMEOUT_MS = 2 * 60 * 1000
function resolveTokenAddress(ctx: ExecContext, chainIdNum: number, token: Address): Address {
  return tokenInfoFor(ctx.tokenRegistry, chainIdNum as ChainId, token).token
}

// Re-stamp the intent envelope at EXECUTION time: blockNumber AND deadline. Drafts bake a deadline at Save
// (now + DEFAULT_DEADLINE_SEC) which expires while the draft sits in the cart or while earlier steps (wallet
// approvals, bridge fills) run — signing must always use a fresh window since the session key signs here anyway.
async function freshEnvelope<T extends { blockNumber: bigint; deadline: bigint }>(
  input: T,
  _ctx: ExecContext,
  chainId: number
): Promise<T> {
  // Live head per SIGNING, not the submit-time chainLiveness snapshot: a multi-step draft whose earlier legs burn the
  // staleness window (wallet confirm, up-to-15min bridge fill, a recognize round-trip) would otherwise re-stamp a
  // blockNumber the matchmaker + contract already reject as Intent__StaleSignature, aborting mid-flow with funds
  // already bridged. One live getBlockNumber per signed step keeps every intent inside maxBlockDelay at attest time.
  const blockNumber = await publicClientForChain(resolveDispatchChainId(chainId)).getBlockNumber()
  return {
    ...input,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)
  }
}

// Reads ONE token's signed balance for signing (fail-loud): a transient RPC failure throws so signing aborts, rather
// than signing an intent against a fabricated 0 (readAccountBalances swallowed failures to 0n for its display sweep). An
// undeployed account is the one provable 0 — signedBalanceOf reverts with no data before lazy onboarding deploys it, so
// probe the code FRESH (a prior step may have just deployed it) and return 0n only when it definitively has no code.
async function fetchSignedBalance(_ctx: ExecContext, account: Address, chainId: number, token: Address): Promise<bigint> {
  const addr = getAddress(account)
  if (!(await readAccountDeployed(addr, chainId as ChainId, true))) return 0n
  // Force-refresh: this is a signing read, so it must reflect on-chain state at sign time, never a stale SW view-cache
  // entry (a prior step that just settled changed this balance). The intra-draft `balances` map handles same-draft
  // sequencing; this guards the FIRST read of any account/token that gets baked into the signed intent's safety bound.
  return readSignedBalance(addr, chainId as ChainId, token, true)
}

async function runDeposit(input: IDepositRoute, ctx: ExecContext): Promise<void> {
  if (input.amount <= 0n) return
  const account = predictPuppetAccount(input.params)
  // Effect-based idempotency for the one leg that moves REAL wallet money: a retried draft whose prior attempt
  // already landed this transfer must not send again. The route balance IS the transfer's effect, so a funded route
  // means done (the read fails loud — retrying blind on a dead RPC could double-send). Save-time walletBalance is
  // checked after, so a wallet drained by the prior successful send does not false-fail the retry.
  const delivered = await fetchDepositRouteBalance(publicClientForChain(input.chainId), input.token, account)
  if (delivered >= input.amount) return
  if (input.walletBalance < input.amount) {
    throw new Error(`wallet balance ${input.walletBalance} below required ${input.amount}`)
  }

  const settle = async (depositHash: Hex): Promise<void> => {
    await awaitWalletDeposit(publicClientForChain(input.chainId), depositHash, BRIDGE_FILL_TIMEOUT_MS)
  }

  if (input.mode === 'erc20Gate') {
    if (!input.spender) throw new Error('erc20Gate deposit requires a spender')
    const liveAllowance = await readContract(publicClientForChain(input.chainId), {
      address: input.token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [ctx.wallet.address, input.spender]
    })
    const needsApprove = liveAllowance < input.amount
    const wallet = await walletClientForChain(ctx.wallet.walletClient, input.chainId)
    const chain = wallet.chain
    if (!chain || chain.id !== input.chainId) {
      throw new Error(`wallet not on chain ${input.chainId} (current: ${chain?.id ?? 'none'})`)
    }
    const depositCall = {
      to: PUPPET_GATE_ADDRESS,
      abi: PUPPET_GATE_ABI,
      functionName: 'deposit',
      args: [input.params, input.token, input.amount]
    } as const

    let depositHash: Hex
    if (needsApprove && (await supportsAtomicBatch(wallet, chain.id))) {
      const result = await sendCalls(wallet, {
        account: ctx.wallet.address,
        chain,
        calls: [
          { to: input.token, abi: erc20Abi, functionName: 'approve', args: [input.spender, input.amount] },
          depositCall
        ]
      })
      const final = await pollCallsStatus(wallet, result.id)
      if (final.status !== 'success') throw new Error(`deposit batch reverted (id ${result.id})`)
      const depositReceipt = final.receipts?.[final.receipts.length - 1]
      if (!depositReceipt) throw new Error(`no deposit receipt in batch (id ${result.id})`)
      depositHash = depositReceipt.transactionHash as Hex
    } else {
      if (needsApprove) {
        await writeContract(wallet, {
          address: input.token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [input.spender, input.amount],
          account: ctx.wallet.address,
          chain
        })
      }
      depositHash = await writeContract(wallet, {
        address: PUPPET_GATE_ADDRESS,
        abi: PUPPET_GATE_ABI,
        functionName: 'deposit',
        args: [input.params, input.token, input.amount],
        account: ctx.wallet.address,
        chain
      })
    }
    await settle(depositHash)
    return
  }

  if (input.mode === 'native') {
    const wallet = await walletClientForChain(ctx.wallet.walletClient, input.chainId)
    const chain = wallet.chain
    if (!chain || chain.id !== input.chainId) {
      throw new Error(`wallet not on chain ${input.chainId} (current: ${chain?.id ?? 'none'})`)
    }
    const depositHash = await writeContract(wallet, {
      address: PUPPET_GATE_ADDRESS,
      abi: PUPPET_GATE_ABI,
      functionName: 'depositWnt',
      args: [input.params],
      value: input.amount,
      account: ctx.wallet.address,
      chain
    })
    await settle(depositHash)
    return
  }

  const wallet = await walletClientForChain(ctx.wallet.walletClient, input.chainId)
  const routeAddr = predictDepositRoute(account)
  const routeClient = publicClientForChain(input.chainId)
  // Delta wait: an absolute >= amount check can pass on a pre-existing surplus BEFORE the transfer mines, letting the
  // next step read a short balance. Capture before, wait for before + amount.
  const before = await fetchRouteBalance(routeClient, input.token, routeAddr)
  await writeContract(wallet, {
    address: input.token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [routeAddr, input.amount],
    account: ctx.wallet.address,
    chain: wallet.chain
  })
  await pollRouteBalance(routeClient, input.token, routeAddr, before + input.amount, LOCAL_SETTLE_TIMEOUT_MS)
}

// Multi-key CREATE2: a fund address no longer reverse-derives to its {master, baseToken,
// name}. The operate/swap flows act on a user's already-deployed fund, so resolve its
// identity from the indexed Fund entity at the fund address.
async function resolveFundParams(ctx: ExecContext, fund: Address): Promise<IFundAccountLib__FundAccountInitParams> {
  const row = await fetchMasterPoolState(fund)
  if (!row) throw new Error(`fund ${fund} not in datastore; cannot derive its identity`)
  return { master: row.master as Address, baseToken: row.baseToken as Hex, name: row.name as Hex }
}

// Off-chain value bound for every external swap leg, mirroring the matchmaker's screenSwapValue (the relay is the
// attestor and enforces the same gate; running it here too fails a bad route BEFORE the user is asked to sign). A LOCAL
// swap's on-chain SignTransfer only proves the account received the client-signed outputAmount (the ratio check is
// tautological) and a cross-chain leg signs no on-chain floor at all (SignLib.none) — so the value is bounded here
// against the median oracle (cross-token swap) or an in-domain same-token ratio (across bridge). Fail closed on an
// unpriceable / stale pair.
async function screenSwapValue(swap: {
  routeKind: 'swap' | 'across'
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  outputAmount: bigint
  acceptableRelayFee: bigint
}): Promise<void> {
  if (swap.routeKind === 'across') {
    if (symbolByAddress(swap.inputToken) !== symbolByAddress(swap.outputToken)) {
      throw new CompactError(
        'CROSS_CHAIN_ASSET_MISMATCH',
        `across must bridge the same asset; ${swap.inputToken} and ${swap.outputToken} are different assets`,
        'hard'
      )
    }
    assertNavSignable(
      evaluateCrossChainSwapValue({
        inputAmount: swap.inputAmount - swap.acceptableRelayFee,
        outputAmount: swap.outputAmount
      })
    )
    return
  }
  assertNavSignable(
    await evaluateSwapValue({
      input: { token: swap.inputToken, amount: swap.inputAmount },
      output: { token: swap.outputToken, amount: swap.outputAmount },
      nowSec: Math.floor(Date.now() / 1000),
      getRate
    })
  )
}

// The quote's own fillDeadline IS the failure boundary: past it no relayer can fill (Across enforces it on-chain),
// so the wait is bounded by min(deadline, the 15m cap) — no provider status API needed. On timeout the draft fails
// loudly; whatever the bridge ultimately does with the funds (origin refund, or the input token delivered on the
// destination) lands back at a route the editors already watch and surface as recoverable surplus.
const BRIDGE_FILL_FLOOR_MS = 30_000
function bridgeFillTimeoutMs(fillDeadlineSec: number): number {
  const untilDeadline = Math.floor(fillDeadlineSec * 1000) - Date.now()
  return Math.min(BRIDGE_FILL_TIMEOUT_MS, Math.max(BRIDGE_FILL_FLOOR_MS, untilDeadline))
}

async function awaitBridgeFill(p: {
  client: PublicClient
  token: Address
  route: Address
  min: bigint
  fillDeadline: number
}): Promise<bigint> {
  const timeoutMs = bridgeFillTimeoutMs(p.fillDeadline)
  return awaitWhile(
    async () => {
      const balance = await fetchRouteBalance(p.client, p.token, p.route)
      return balance >= p.min ? balance : undefined
    },
    {
      timeoutMs,
      pollMs: 2_000,
      timeoutMessage: `the bridge did not deliver to ${p.route} within its fill deadline; if the fill failed, the funds return as a refund on the origin chain or as the bridged input token on the destination — both surface as recoverable surplus in the deposit editor`
    }
  )
}

async function runSwapStep(input: ISwapInput, ctx: ExecContext): Promise<IAttestation | null> {
  const account = predictPuppetAccount(input.params)
  const chainId = Number(input.chainId)
  const token = resolveTokenAddress(ctx, chainId, input.inputToken)
  const publicClient = publicClientForChain(chainId)

  const minAmount = input.inputAmount > 0n ? input.inputAmount : 1n
  const routeBalance = await pollDepositRouteBalance(publicClient, token, account, minAmount, LOCAL_SETTLE_TIMEOUT_MS)

  const fresh = await freshEnvelope(
    { ...input, userDeploySig: ctx.session.bindSig, userSignerProof: ctx.session.signerProof },
    ctx,
    chainId
  )
  await screenSwapValue({
    routeKind: fresh.route.kind,
    inputToken: fresh.inputToken,
    outputToken: fresh.outputToken,
    inputAmount: fresh.inputAmount,
    outputAmount: fresh.outputAmount,
    acceptableRelayFee: fresh.acceptableRelayFee
  })
  const { intent, typedData } = attestSwapIntent(
    {
      chainId: resolveDispatchChainId(chainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      sourceBalance: routeBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  return signAndSettle({ kind: 'swap', input: fresh, intent }, typedData, fresh.inputToken, ctx)
}

async function runRecognizeStep(
  input: IRecognizeBalanceInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation | null> {
  const account = predictPuppetAccount(input.params)
  const chainIdNum = Number(input.chainId)
  const token = resolveTokenAddress(ctx, chainIdNum, input.token)
  const publicClient = publicClientForChain(chainIdNum)
  const routeBalance = await pollDepositRouteBalance(publicClient, token, account, input.amount, BRIDGE_FILL_TIMEOUT_MS)
  const acceptableRelayFee = await resolveRelayFee(ctx, chainIdNum, 'PuppetGate', 'recognize', input.token)

  const fresh = await freshEnvelope(
    {
      ...input,
      amount: routeBalance,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
      acceptableRelayFee,
      userDeploySig: ctx.session.bindSig,
      userSignerProof: ctx.session.signerProof
    },
    ctx,
    chainIdNum
  )
  const { intent, typedData } = attestRecognizeBalanceIntent(
    {
      chainId: chainIdNum as ChainId,
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      routeBalance
    },
    fresh
  )
  return signAndSettle({ kind: 'recognize', input: fresh, intent }, typedData, fresh.token, ctx)
}

async function runWithdrawStep(input: IWithdrawInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation | null> {
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestWithdrawIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  return signAndSettle({ kind: 'withdraw', input: fresh, intent }, typedData, fresh.inputToken, ctx)
}

async function runAllocateStep(input: IAllocateInput, ctx: ExecContext): Promise<IAttestation | null> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const [positions, fundState] = await Promise.all([
    fetchMasterSubscribers(fund, fresh.fundParams.baseToken),
    fetchMasterPoolState(fund)
  ])
  const { intent, typedData } = attestAllocateIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      totalShareSupply: fundState?.totalShareSupply ?? 0n,
      seeded: fundState?.seeded ?? false,
      liquidationRate: fundState?.liquidationRate ?? 0n,
      poolWeight: fundState?.weight ?? 0n,
      positions
    },
    fresh
  )
  return signAndSettle({ kind: 'allocate', input: fresh, intent }, typedData, fresh.fundParams.baseToken, ctx)
}

async function runSellStep(input: ISellInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation | null> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const pool = await fetchMasterPoolState(fund)
  const { intent, typedData } = attestSellIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      claimable: computeClaimable(
        await client.find(fundPositionTable, {
          holder: getAddress(predictPuppetAccount(input.params)),
          fund: getAddress(fund)
        }),
        pool
      ),
      shareToken: (pool?.shareToken as Address | undefined) ?? null,
      liquidationRate: pool?.liquidationRate ?? 0n,
      poolWeight: pool?.weight ?? 0n,
      queuedShares: pool?.queuedShares ?? 0n
    },
    fresh
  )
  return signAndSettle({ kind: 'sell', input: fresh, intent }, typedData, fresh.fundParams.baseToken, ctx)
}

async function runClaimStep(input: IClaimInput, ctx: ExecContext): Promise<IAttestation | null> {
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestClaimIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber
    },
    fresh
  )
  return signAndSettle({ kind: 'claim', input: fresh, intent }, typedData, fresh.fundParams.baseToken, ctx)
}

async function runRedeemStep(input: IRedeemInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation | null> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const [pool, masterPosition] = await Promise.all([
    fetchMasterPoolState(fund),
    client.find(fundPositionTable, { holder: getAddress(input.fundParams.master), fund: getAddress(fund) })
  ])
  const { intent, typedData } = attestRedeemIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      shareToken: (pool?.shareToken as Address | undefined) ?? null,
      liquidationRate: pool?.liquidationRate ?? 0n,
      totalShareSupply: pool?.totalShareSupply ?? 0n,
      queuedShares: pool?.queuedShares ?? 0n,
      poolWeight: pool?.weight ?? 0n,
      masterWeight: masterPosition?.weight ?? 0n,
      masterEpoch: masterPosition?.epoch ?? 0n,
      poolEpoch: pool?.epoch ?? 0n,
      masterWalletShares: masterPosition?.sharesHeld ?? 0n
    },
    fresh
  )
  return signAndSettle({ kind: 'redeem', input: fresh, intent }, typedData, fresh.fundParams.baseToken, ctx)
}

async function runLiquidateStep(input: ILiquidateInput, ctx: ExecContext): Promise<IAttestation | null> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const pool = await fetchMasterPoolState(fund)
  const { intent, typedData } = attestLiquidateIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance: await fetchSignedBalance(ctx, fund, HUB_CHAIN_ID, fresh.fundParams.baseToken),
      shareToken: (pool?.shareToken as Address | undefined) ?? null,
      liquidationRate: pool?.liquidationRate ?? 0n,
      totalShareSupply: pool?.totalShareSupply ?? 0n,
      queuedShares: pool?.queuedShares ?? 0n,
      poolWeight: pool?.weight ?? 0n
    },
    fresh
  )
  return signAndSettle({ kind: 'liquidate', input: fresh, intent }, typedData, fresh.fundParams.baseToken, ctx)
}

type IRecord = (settled: IAttestation | null) => IAttestation | null

async function runMandateStep(
  input: IMandateInput,
  ctx: ExecContext,
  signedBalance: bigint,
  routeBalance: bigint
): Promise<IAttestation | null> {
  const fresh = await freshEnvelope(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestMandateIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      routeBalance
    },
    fresh
  )
  return signAndSettle({ kind: 'mandate', input: fresh, intent }, typedData, fresh.baseToken, ctx)
}

const push = (out: IAttestation[], value: IAttestation | null): void => {
  if (value !== null) out.push(value)
}

const balanceKey = (account: Address, chainId: number, token: Address): string =>
  `${account.toLowerCase()}:${chainId}:${token.toLowerCase()}`

// Fund-routed requests settle against the fund account, identified by input.fundParams under
// multi-key CREATE2 (a bare puppet account address can no longer reconstruct its fund). Every
// such kind carries fundParams on its input; non-fund-routed kinds settle on the puppet account.
const FUND_ROUTED: ReadonlySet<string> = new Set([
  'operate',
  'allocate',
  'redeem',
  'liquidate',
  'fundSwap',
  'fundRecognize'
])

function accountForRequest(req: IRelayRequest): Address {
  const input = req.input as {
    params: IAccountLib__AccountInitParams
    fundParams?: IFundAccountLib__FundAccountInitParams
  }
  if (FUND_ROUTED.has(req.kind)) {
    if (!input.fundParams) throw new Error(`fund-routed ${req.kind} missing fundParams`)
    return predictFundAccount(input.fundParams)
  }
  return predictPuppetAccount(input.params)
}

// A mandate settles on-chain when its nonce is consumed (signAndSettle → awaitAccountCall), but the following list reads
// the journal's folded fundPositionTable, which the indexer updates a beat LATER. Await that fold so the mandate step
// doesn't resolve — and the UI doesn't refetch the list — until the subscription is actually queryable: a subscribe
// lands body+mandate on the (holder, fund) row, a revoke clears them. Same await-the-settled-post-state pattern as
// awaitAccountCall, extended to the indexed read the list depends on. Best-effort: a slow/broken indexer must never
// turn an already-settled action into a failure, so a timeout only warns (the list then lags until a reload).
const MANDATE_INDEX_TIMEOUT_MS = 20_000
async function awaitMandateIndexed(puppet: Address, rules: readonly IMandateRule[]): Promise<void> {
  const holder = getAddress(puppet)
  await Promise.all(
    rules.map(async rule => {
      const fund = getAddress(predictFundAccount(rule.fundParams))
      const wantActive = rule.body !== '0x'
      await awaitWhile(
        async () => {
          const row = await client.find(fundPositionTable, { holder, fund })
          const active = row?.body !== undefined && row?.mandate !== undefined
          return active === wantActive ? true : undefined
        },
        { timeoutMs: MANDATE_INDEX_TIMEOUT_MS, pollMs: 250, maxPollMs: 1000 }
      ).catch((err: unknown) =>
        console.warn(`[mandate] subscription for ${fund} not indexed in time; following list may lag until reload:`, err)
      )
    })
  )
}

export async function runMandateBatch(drafts: ISubscribeDraft[], ctx: ExecContext): Promise<IAttestation[]> {
  const out: IAttestation[] = []
  const input = await buildMandateInput(drafts, ctx)
  const puppet = predictPuppetAccount(input.params)
  // The gate auto-recognizes the deposit route on mandate, paying the fee from signedBalance + routeBalance; read both so
  // the attestation mirrors the on-chain check and a deposit-then-subscribe needs no separate recognize step.
  const [signedBalance, routeBalance] = await Promise.all([
    fetchSignedBalance(ctx, puppet, HUB_CHAIN_ID, input.baseToken),
    fetchDepositRouteBalance(publicClientForChain(HUB_CHAIN_ID), resolveTokenAddress(ctx, HUB_CHAIN_ID, input.baseToken), puppet)
  ])
  push(out, await runMandateStep(input, ctx, signedBalance, routeBalance))
  // Gate the step's resolution on the indexer reflecting the mandate, so the following-list refetch (fired off this
  // attestation) reads the settled state in one shot — no post-hoc polling in the view layer.
  await awaitMandateIndexed(puppet, input.rules)
  return out
}

// The DEX quote refreshes at execution; abort if it falls materially below the minimum output the user
// reviewed (a generous band absorbs normal preview-to-execution drift, both already slippage-floored).
const SWAP_REQUOTE_TOLERANCE_BPS = 500n
const belowReviewedFloor = (reviewedMinOut: bigint, requotedOutput: bigint): boolean =>
  reviewedMinOut > 0n && requotedOutput < (reviewedMinOut * (10000n - SWAP_REQUOTE_TOLERANCE_BPS)) / 10000n

// A draft staged BEFORE the session existed (pre-session exploration) quoted its swap leg for a placeholder
// identity, and the delivery route is baked inside providerCallData — rebinding params alone cannot rewrite it.
// Re-quote the same leg for the live identity and floor-check against the output the user reviewed, so those
// drafts self-heal at submit instead of being refused. Composed leg 1 is covered too: its input and output ids
// are the same asset, so crossToken resolves false and the race re-runs the same-asset bridge lanes.
async function rebindSwapLeg(
  swap: ISwapInput,
  params: IAccountLib__AccountInitParams,
  ctx: ExecContext
): Promise<ISwapInput> {
  const originChainId = Number(swap.chainId)
  const destinationChainId = Number(swap.destinationChainId)
  const inputToken = resolveTokenAddress(ctx, originChainId, swap.inputToken)
  const outputToken = resolveTokenAddress(ctx, destinationChainId, swap.outputToken)
  // The gate approves the provider only inputAmount - actualRelayFee (the fee is skimmed BEFORE the DEX runs), so
  // the provider calldata MUST be quoted for that NET amount — a gross-amount quote transferFroms past the on-chain
  // allowance and reverts TransferFromFailed (burned a live dispatch on 42161, 2026-07-03). acceptableRelayFee is
  // the fee ceiling, so netting by it stays at or under the approval.
  const netInput = swap.inputAmount - swap.acceptableRelayFee
  if (netInput <= 0n) throw new Error('Swap amount does not cover the relay fee; remove and re-add the action')
  const quote = await fetchSwapQuote({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount: netInput,
    route: predictDepositRoute(predictPuppetAccount(params)),
    // Same ASSET on two chains has two different addresses, so cross-asset-ness compares priced symbols, never
    // raw addresses (an address compare would race a cross-asset quote for a plain same-asset bridge).
    crossToken: symbolByAddress(inputToken) !== symbolByAddress(outputToken)
  })
  if (belowReviewedFloor(swap.outputAmount, quote.outputAmount)) {
    throw new Error(
      `The route re-quoted for your new session pays materially less than the one you reviewed (${quote.outputAmount} vs ${swap.outputAmount}). Remove and re-add the deposit to review the current route.`
    )
  }
  return { ...swap, params, route: quote.route, outputAmount: quote.outputAmount, fillDeadline: quote.fillDeadline }
}

// Leg 2 of a composed deposit: the bridge delivered the input's hub-side twin to the route; convert it to the base
// with a hub-LOCAL swap. The executable calldata cannot be pre-baked (the delivered amount is only known after the
// fill), so it is quoted FRESH here from the live route balance and floor-checked against the Save-time estimate
// the user reviewed. A failed leg leaves the bridged token on the route — the deposit editor surfaces it as
// recoverable surplus.
async function runHubSwapLeg(
  hubSwap: { inputToken: Hex; estimateOut: bigint },
  baseToken: Hex,
  params: IAccountLib__AccountInitParams,
  ctx: ExecContext
): Promise<IAttestation | null> {
  const account = predictPuppetAccount(params)
  const inputToken = resolveTokenAddress(ctx, HUB_CHAIN_ID, hubSwap.inputToken)
  const outputToken = resolveTokenAddress(ctx, HUB_CHAIN_ID, baseToken)
  const routeBalance = await fetchDepositRouteBalance(homePublicClient, inputToken, account)
  if (routeBalance === 0n) {
    throw new Error('the bridged funds were not found on the hub route yet; retry shortly')
  }
  const acceptableRelayFee = await resolveRelayFee(ctx, HUB_CHAIN_ID, 'PuppetGate', 'swap', hubSwap.inputToken)
  const netInput = routeBalance - acceptableRelayFee
  if (netInput <= 0n) throw new Error('the bridged amount does not cover the hub swap relay fee')
  const quote = await fetchLifiSwapQuote({
    chainId: HUB_CHAIN_ID,
    inputToken,
    outputToken,
    inputAmount: netInput,
    fromAddress: predictDepositRoute(account),
    toAddress: predictDepositRoute(account)
  })
  if (quote.outputAmount === 0n || belowReviewedFloor(hubSwap.estimateOut, quote.outputAmount)) {
    throw new Error(
      'the hub swap re-quoted materially below the output you reviewed; the bridged funds remain on your route as recoverable surplus in the deposit editor'
    )
  }
  const input: ISwapInput = {
    params,
    inputToken: hubSwap.inputToken,
    outputToken: baseToken,
    ...stepMetadata(ctx, HUB_CHAIN_ID),
    acceptableRelayFee,
    chainId: BigInt(HUB_CHAIN_ID),
    inputAmount: routeBalance,
    outputAmount: quote.outputAmount,
    destinationChainId: BigInt(HUB_CHAIN_ID),
    route: quote.route,
    fillDeadline: Math.floor(quote.fillDeadline),
    userDeploySig: ctx.session.bindSig,
    userSignerProof: ctx.session.signerProof
  }
  return runSwapStep(input, ctx)
}

// FA internal rebalance: one guarded FundGate.swap (fromRoute=false) debiting the fund's signed
// inputToken, running the DEX on the fund account, crediting signed outputToken. A LOCAL swap delivers the
// output to the fund and credits it in the same intent. A CROSS-CHAIN swap (destinationChainId !== chainId) debits
// the input, bridges the output to the fund's route on the destination, and credits it via a second FundGate
// recognize there (mirrors the cross-chain deposit's source -> destination-recognize, but for the fund account).
// Wrap the fund's native holding (NATIVE_TOKEN signed balance — e.g. GMX execution-fee refunds accrue as native) into
// its wrapped-native ERC-20 so a dust balance becomes a swappable source. A dedicated, atomic FundGate.wrap: a fixed
// WNT.deposit + a 1:1 signed re-key, no DEX or provider calldata to screen; the on-chain shortfall check makes it exact.
async function runWrapStep(
  fundParams: IFundAccountLib__FundAccountInitParams,
  chainId: number,
  amount: bigint,
  ctx: ExecContext,
  unwrap = false
): Promise<IAttestation | null> {
  const wnt = wrappedNativeAddressOf(chainId as ChainId)
  const acceptableRelayFee = await resolveRelayFee(ctx, chainId, 'FundGate', 'wrap', wnt, 0n)
  const input: IWrapInput = {
    params: { user: ctx.wallet.address, signer: ctx.session.signer },
    fundParams,
    amount,
    unwrap,
    ...stepMetadata(ctx, chainId),
    acceptableRelayFee,
    chainId: BigInt(chainId)
  }
  const fresh = await freshEnvelope(input, ctx, chainId)
  const { intent, typedData } = attestWrapIntent(
    { chainId: resolveDispatchChainId(chainId), tokenRegistry: ctx.tokenRegistry, currentBlock: fresh.blockNumber },
    fresh
  )
  return signAndSettle({ kind: 'wrap', input: fresh, intent }, typedData, wnt, ctx)
}

async function runFundSwapDraft(draft: IFundSwapDraft, ctx: ExecContext): Promise<IAttestation[]> {
  const fundParams = await resolveFundParams(ctx, draft.account)
  const fund = predictFundAccount(fundParams)
  const destChainId = draft.destinationChainId ?? draft.chainId
  const isLocal = destChainId === draft.chainId
  // UNWRAP: wrapped-native -> native on the same chain (WMON -> MON) is a dedicated 1:1 FundGate.wrap(unwrap), not a DEX
  // swap (the DEX can't produce the codeless native marker).
  if (
    isLocal &&
    isAddressEqual(getAddress(draft.tokenIn), getAddress(wrappedNativeAddressOf(draft.chainId as ChainId))) &&
    isAddressEqual(getAddress(draft.tokenOut), getAddress(PROTOCOL.nativeToken))
  ) {
    const unwrapped = await runWrapStep(fundParams, draft.chainId, draft.amountIn, ctx, true)
    return unwrapped ? [unwrapped] : []
  }
  // Native is not an ERC-20 the DEX can approve/transferFrom, so a native-input swap first WRAPS the holding to the
  // chain's wrapped-native token (1:1), then swaps that. tokenIn from here on is the wrapped ERC-20.
  const wrapResults: IAttestation[] = []
  const nativeInput = isAddressEqual(getAddress(draft.tokenIn), getAddress(PROTOCOL.nativeToken))
  if (nativeInput) {
    const wrap = await runWrapStep(fundParams, draft.chainId, draft.amountIn, ctx)
    if (wrap) wrapResults.push(wrap)
  }
  const tokenIn: Hex = nativeInput ? wrappedNativeAddressOf(draft.chainId as ChainId) : draft.tokenIn
  const inputToken = resolveTokenAddress(ctx, draft.chainId, tokenIn)
  const outputToken = resolveTokenAddress(ctx, destChainId, draft.tokenOut)
  // MON -> WMON is the wrap ALONE: after wrapping, the wrapped input already IS the output, so there is no DEX swap.
  if (nativeInput && isLocal && isAddressEqual(getAddress(inputToken), getAddress(outputToken))) return wrapResults

  // COMPOSED cross-token cross-chain: a single cross-chain swap-and-bridge has an unpinnable delivery recipient (the
  // co-signer rejects it), so route through a bridgeable intermediate X: local swap tokenIn -> X on the origin, a
  // SAME-ASSET Across bridge X -> X to the dest (recipient pinned), then a local swap X -> tokenOut on the dest. Each leg
  // is signable on its own. X = the editor's chosen bridgeToken (the output's twin when Across bridges it, else a
  // stablecoin) so execution matches the priced route; every leg is sized from the amount the PRIOR leg actually
  // delivered. leg 1 is skipped when the input already IS X, leg 3 when the bridge already delivered the output asset.
  if (!isLocal && symbolByAddress(tokenIn) !== symbolByAddress(draft.tokenOut)) {
    const originTokens = CHAIN_TOKEN_MAP[draft.chainId as keyof typeof CHAIN_TOKEN_MAP] as Record<string, Hex> | undefined
    const destTokens = CHAIN_TOKEN_MAP[destChainId as keyof typeof CHAIN_TOKEN_MAP] as Record<string, Hex> | undefined
    const xOrigin = draft.bridgeToken ?? originTokens?.[symbolByAddress(draft.tokenOut)]
    if (!xOrigin) throw new Error(`no bridge intermediate for ${symbolByAddress(draft.tokenOut)} on chain ${draft.chainId}`)
    const xSymbol = symbolByAddress(xOrigin)
    const xDest = destTokens?.[xSymbol]
    if (!xDest) throw new Error(`bridge intermediate ${xSymbol} is not registered on chain ${destChainId}`)
    const needsDestSwap = xSymbol !== symbolByAddress(draft.tokenOut)
    const results = [...wrapResults]

    // leg 1: local swap tokenIn -> X on the origin. Floor it at the reviewed minOut ONLY when X is already the output
    // asset (the 2-leg direct shape); a stablecoin intermediate is floored downstream at leg 3.
    let bridgeAmount = draft.amountIn
    if (xSymbol !== symbolByAddress(tokenIn)) {
      const before = await fetchSignedBalance(ctx, fund, draft.chainId, xOrigin)
      const leg1 = await runFundSwapDraft(
        { ...draft, tokenIn, tokenOut: xOrigin, destinationChainId: undefined, bridgeToken: undefined, minOut: needsDestSwap ? 0n : draft.minOut },
        ctx
      )
      bridgeAmount = (await fetchSignedBalance(ctx, fund, draft.chainId, xOrigin)) - before
      if (bridgeAmount <= 0n) throw new Error('the local swap produced no output to bridge')
      results.push(...leg1)
    }

    // leg 2: same-asset X -> X bridge to the dest (recipient pinned) + dest recognize.
    const beforeDest = needsDestSwap ? await fetchSignedBalance(ctx, fund, destChainId, xDest) : 0n
    const leg2 = await runFundSwapDraft(
      { ...draft, tokenIn: xOrigin, tokenOut: xDest, amountIn: bridgeAmount, minOut: 0n, bridgeToken: undefined },
      ctx
    )
    results.push(...leg2)
    if (!needsDestSwap) return results

    // leg 3: local swap the bridged intermediate -> the requested output on the dest chain, sized from what the bridge
    // actually delivered, floored at the reviewed overall minOut (the cumulative-slippage backstop).
    const producedDest = (await fetchSignedBalance(ctx, fund, destChainId, xDest)) - beforeDest
    if (producedDest <= 0n) throw new Error('the bridge produced no output to swap on the destination')
    const leg3 = await runFundSwapDraft(
      {
        ...draft,
        chainId: destChainId,
        tokenIn: xDest,
        tokenOut: draft.tokenOut,
        amountIn: producedDest,
        destinationChainId: undefined,
        bridgeToken: undefined
      },
      ctx
    )
    results.push(...leg3)
    return results
  }

  const route = predictDepositRoute(fund)

  // FundGate.swap skims the relay fee off the input token BEFORE running the DEX: it approves the provider only
  // inputAmount - actualRelayFee. So the provider calldata must be quoted for that NET amount, not the full input, or the
  // DEX's transferFrom exceeds the on-chain approval and reverts TRANSFER_FROM_FAILED. acceptableRelayFee is the fee
  // ceiling (the matchmaker's actual fee is <= it), so netting by it stays at or under the on-chain approval.
  const acceptableRelayFee = await resolveRelayFee(ctx, draft.chainId, 'FundGate', 'swap', tokenIn)
  const swapInputAmount = draft.amountIn - acceptableRelayFee
  if (swapInputAmount <= 0n) throw new Error('Swap amount does not cover the relay fee; increase the amount and retry')

  const quote = isLocal
    ? await fetchLifiSwapQuote({
        chainId: draft.chainId,
        inputToken,
        outputToken,
        inputAmount: swapInputAmount,
        fromAddress: fund,
        toAddress: fund
      })
    : await fetchSwapQuote({
        originChainId: draft.chainId,
        destinationChainId: destChainId,
        inputToken,
        outputToken,
        inputAmount: swapInputAmount,
        route,
        crossToken: symbolByAddress(tokenIn) !== symbolByAddress(draft.tokenOut)
      })
  if (quote.outputAmount === 0n) throw new Error('swap route quoted zero output, adjust the amount and retry')
  if (belowReviewedFloor(draft.minOut, quote.outputAmount)) {
    throw new Error('Swap re-quoted materially below your reviewed minimum output; refresh and retry')
  }

  const destRouteBefore = isLocal ? 0n : await fetchRouteBalance(publicClientForChain(destChainId), outputToken, route)
  const signedBalance = await fetchSignedBalance(ctx, fund, draft.chainId, tokenIn)

  const input: IFundSwapInput = {
    params: { user: ctx.wallet.address, signer: ctx.session.signer },
    fundParams,
    inputToken: tokenIn,
    outputToken: draft.tokenOut,
    ...stepMetadata(ctx, draft.chainId),
    acceptableRelayFee,
    chainId: BigInt(draft.chainId),
    inputAmount: draft.amountIn,
    outputAmount: quote.outputAmount,
    destinationChainId: BigInt(destChainId),
    route: quote.route,
    fillDeadline: Math.floor(quote.fillDeadline),
    fromRoute: false
  }
  const fresh = await freshEnvelope(input, ctx, draft.chainId)
  await screenSwapValue({
    routeKind: fresh.route.kind,
    inputToken: fresh.inputToken,
    outputToken: fresh.outputToken,
    inputAmount: fresh.inputAmount,
    outputAmount: fresh.outputAmount,
    acceptableRelayFee: fresh.acceptableRelayFee
  })
  const { intent, typedData } = attestFundSwapIntent(
    {
      chainId: resolveDispatchChainId(draft.chainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      sourceBalance: signedBalance,
      expectedOutputAmount: quote.outputAmount
    },
    fresh
  )
  const swapped = await signAndSettle({ kind: 'fundSwap', input: fresh, intent }, typedData, fresh.inputToken, ctx)
  if (isLocal) return [...wrapResults, ...(swapped === null ? [] : [swapped])]

  await awaitBridgeFill({
    client: publicClientForChain(destChainId),
    token: outputToken,
    route,
    min: destRouteBefore + quote.outputAmount,
    fillDeadline: quote.fillDeadline
  })
  const recognized = await runFundRecognizeStep(
    fundParams,
    destChainId,
    draft.tokenOut,
    destRouteBefore + quote.outputAmount,
    ctx
  )
  const settledSteps: IAttestation[] = [...wrapResults]
  if (swapped !== null) settledSteps.push(swapped)
  if (recognized !== null) settledSteps.push(recognized)
  return settledSteps
}

// Destination leg of a cross-chain fund swap: wait for the bridge to fill the fund's route on the destination chain,
// then sweep it into the fund's signed outputToken balance via FundGate.recognize. The matchmaker re-attests against
// the live route balance and appends deploy proofs (creating the master PA + fund on the destination when absent).
async function runFundRecognizeStep(
  fundParams: IFundAccountLib__FundAccountInitParams,
  destChainId: number,
  outputToken: Hex,
  minRouteBalance: bigint,
  ctx: ExecContext
): Promise<IAttestation | null> {
  const fund = predictFundAccount(fundParams)
  const route = predictDepositRoute(fund)
  const token = resolveTokenAddress(ctx, destChainId, outputToken)
  const destClient = publicClientForChain(destChainId)
  const routeBalance = await pollRouteBalance(destClient, token, route, minRouteBalance, BRIDGE_FILL_TIMEOUT_MS)
  const signedBalance = await fetchSignedBalance(ctx, fund, destChainId, outputToken)
  // The recognize DISPATCHES on the dest chain, so its fee must be priced against THAT chain's gas price (the matchmaker
  // quotes with getChainGasPrice(destChainId)); ctx.gasPrice is the hub's and under-quotes a pricier spoke, tripping
  // RELAY_FEE_EXCEEDED — same reason the cross-chain swap leg above fetches the dest gas price.
  const acceptableRelayFee = await resolveRelayFee(ctx, destChainId, 'FundGate', 'recognize', outputToken)

  const input: IFundRecognizeInput = {
    params: { user: ctx.wallet.address, signer: ctx.session.signer },
    fundParams,
    token: outputToken,
    ...stepMetadata(ctx, destChainId),
    acceptableRelayFee,
    amount: routeBalance,
    chainId: BigInt(destChainId),
    userDeploySig: ctx.session.bindSig,
    userSignerProof: ctx.session.signerProof
  }
  const fresh = await freshEnvelope(input, ctx, destChainId)
  const { intent, typedData } = attestFundRecognizeIntent(
    {
      chainId: destChainId as ChainId,
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      routeBalance
    },
    fresh
  )
  return signAndSettle({ kind: 'fundRecognize', input: fresh, intent }, typedData, fresh.token, ctx)
}

export async function runDraft(draft: IDraft, ctx: ExecContext, recognize = true): Promise<IAttestation[]> {
  const out: IAttestation[] = []
  const balances = new Map<string, bigint>()

  const getBalance = async (account: Address, chainId: number, token: Address): Promise<bigint> => {
    const key = balanceKey(account, chainId, token)
    const cached = balances.get(key)
    if (cached !== undefined) return cached
    const signedBalance = await fetchSignedBalance(ctx, account, chainId, token)
    balances.set(key, signedBalance)
    return signedBalance
  }

  const record = (settled: IAttestation | null): IAttestation | null => {
    if (settled === null) return null
    const acc = accountForRequest(settled.request)
    const chainId = Number((settled.request.intent as { chainId: bigint }).chainId)
    const token = settled.token
    const key = balanceKey(acc, chainId, token)
    // Project the delta ONLY onto a balance this draft already read: seeding an unread key from 0n fabricates a
    // balance that a later step would sign against. An unread key stays absent, so its first read is live (correct:
    // signAndSettle already awaited settlement).
    const prior = balances.get(key)
    if (prior !== undefined) {
      balances.set(key, prior + computeSignedDelta(settled.request, settled.result.actualRelayFee))
    }
    return settled
  }

  if (draft.kind === 'mandate') return runMandateBatch([draft], ctx)
  if (draft.kind === 'allocate') {
    const params = { user: ctx.wallet.address, signer: ctx.session.signer }
    // The swap's providerCallData bakes the DELIVERY ROUTE of the identity that drafted it (pre-session placeholder
    // or a stale prior session); rebinding params alone cannot rewrite that calldata, so re-quote the same leg for
    // the live identity instead of executing a route the live account does not own.
    let swapLeg = draft.swap
    if (
      swapLeg &&
      (!isAddressEqual(getAddress(swapLeg.params.user), getAddress(params.user)) ||
        !isAddressEqual(getAddress(swapLeg.params.signer), getAddress(params.signer)))
    ) {
      swapLeg = await rebindSwapLeg(swapLeg, params, ctx)
    }
    const puppet = predictPuppetAccount(params)
    const hubBefore = await fetchDepositRouteBalance(homePublicClient, draft.baseToken, puppet)
    if (draft.wallet) await runDeposit({ ...draft.wallet, params }, ctx)
    let bridged: bigint | null = null
    if (swapLeg) {
      push(out, await runSwapStep({ ...swapLeg, params }, ctx))
      bridged = swapLeg.outputAmount
    }
    // Cross-chain only: the swapped funds reach the hub route asynchronously (the bridge fill), so wait for them. A
    // same-chain swap already settled synchronously in runSwapStep (its output is on the route), so polling for the
    // exact expected output would only stall on normal swap slippage — read the actual route balance below instead.
    if (bridged !== null && bridged > 0n && swapLeg && swapLeg.chainId !== swapLeg.destinationChainId) {
      await awaitBridgeFill({
        client: homePublicClient,
        token: draft.baseToken,
        route: predictDepositRoute(puppet),
        min: hubBefore + bridged,
        fillDeadline: swapLeg.fillDeadline
      })
    }
    const masterAmount = await fetchDepositRouteBalance(homePublicClient, draft.baseToken, puppet)
    // Fold the settled-position recognize in front of the allocate (same as the redeem path): a re-allocate to a fund
    // holding a closed position's uncosigned return must credit it first so the seeded-fund NAV check passes.
    const recognized = await recognizeFundSurplus(
      {
        master: draft.master,
        fund: predictFundAccount({ master: draft.master, baseToken: draft.baseToken, name: draft.name }),
        baseToken: draft.baseToken
      },
      ctx
    )
    if (recognized) push(out, record(recognized))
    const input = await buildAllocateInput({ ...draft, masterAmount }, ctx)
    push(out, record(await runAllocateStep(input, ctx)))
    return out
  }
  if (draft.kind === 'fundSwap') {
    for (const attestation of await runFundSwapDraft(draft, ctx)) push(out, record(attestation))
    return out
  }
  if (draft.kind === 'sell') {
    const input = await buildSellInput(draft, ctx)
    const puppet = predictPuppetAccount(input.params)
    push(
      out,
      record(await runSellStep(input, ctx, await getBalance(puppet, HUB_CHAIN_ID, input.fundParams.baseToken)))
    )
    return out
  }
  if (draft.kind === 'claim') {
    push(out, record(await runClaimStep(await buildClaimInput(draft, ctx), ctx)))
    return out
  }
  if (draft.kind === 'claimRoute') {
    const fundParams = await resolveFundParams(ctx, draft.account)
    const claimed = await runFundRecognizeStep(fundParams, draft.chainId, draft.token, draft.amount, ctx)
    return claimed ? [claimed] : []
  }
  if (draft.kind === 'recognizeFund') {
    const recognized = await recognizeFundSurplus(
      { master: draft.master, fund: draft.masterAccount, baseToken: draft.baseToken },
      ctx
    )
    if (recognized) push(out, record(recognized))
    return out
  }
  if (draft.kind === 'redeem') {
    if (draft.liquidate) {
      push(out, record(await runLiquidateStep(await buildLiquidateInput(draft, ctx), ctx)))
      return out
    }
    // Fold the settled-position recognize in front of the redeem (mirrors the deposit route-recognize that folds into
    // allocate/mandate): co-sign a closed position's returned funds first so the redeem prices a correct NAV.
    const recognized = await recognizeFundSurplus(
      { master: draft.master, fund: draft.masterAccount, baseToken: draft.baseToken },
      ctx
    )
    if (recognized) push(out, record(recognized))
    const input = await buildRedeemInput(draft, ctx)
    const fund = predictFundAccount(input.fundParams)
    push(
      out,
      record(await runRedeemStep(input, ctx, await getBalance(fund, HUB_CHAIN_ID, input.fundParams.baseToken)))
    )
    return out
  }

  const rebindParams =
    draft.kind === 'deposit' ? { user: draft.params.user, signer: ctx.session.signer } : undefined
  const withParams = <T extends { params: IAccountLib__AccountInitParams }>(input: T): T =>
    rebindParams ? { ...input, params: rebindParams } : input

  if (draft.kind === 'deposit') {
    let deposit = draft
    if (
      deposit.swap !== null &&
      rebindParams !== undefined &&
      (!isAddressEqual(getAddress(deposit.swap.params.user), getAddress(rebindParams.user)) ||
        !isAddressEqual(getAddress(deposit.swap.params.signer), getAddress(rebindParams.signer)))
    ) {
      const swap = await rebindSwapLeg(deposit.swap, rebindParams, ctx)
      deposit = {
        ...deposit,
        swap,
        output: deposit.hubSwap ? deposit.output : { ...deposit.output, amount: swap.outputAmount }
      }
    }
    if (deposit.wallet) await runDeposit(withParams(deposit.wallet), ctx)
    const crossChain = deposit.swap !== null && deposit.swap.chainId !== deposit.swap.destinationChainId
    const input = withParams(depositRecognizeInput(deposit))
    const puppet = predictPuppetAccount(input.params)
    const hubSwap = deposit.hubSwap ?? null
    // Composed delivery waits on the BRIDGED token (the input's hub twin), not the base — capture its baseline
    // BEFORE the bridge dispatches so the fill is measured as a delta.
    const hubLegToken = hubSwap !== null ? resolveTokenAddress(ctx, HUB_CHAIN_ID, hubSwap.inputToken) : null
    const hubLegBefore =
      hubLegToken !== null ? await fetchDepositRouteBalance(homePublicClient, hubLegToken, puppet) : 0n
    if (deposit.swap) push(out, record(await runSwapStep(withParams(deposit.swap), ctx)))
    // For a CROSS-CHAIN deposit the swapped funds reach the hub route asynchronously (the bridge fill), so hold here
    // until they land — whether the recognize runs next or was folded into a following ALLOCATE/MANDATE sweep. The
    // wait is bounded by the quote's fill deadline; past it the fill cannot happen and the draft fails loudly (funds
    // resurface as route surplus). A SAME-CHAIN swap is NOT polled: runSwapStep already settled it synchronously
    // (awaitAccountCall confirmed the output mined onto the route), so polling for the exact expected output would
    // only stall on normal DEX slippage. A home deposit needs no wait.
    if (crossChain && deposit.swap) {
      await awaitBridgeFill({
        client: publicClientForChain(Number(input.chainId)),
        token: hubLegToken ?? resolveTokenAddress(ctx, Number(input.chainId), input.token),
        route: predictDepositRoute(puppet),
        min: hubLegToken !== null ? hubLegBefore + deposit.swap.outputAmount : deposit.output.amount,
        fillDeadline: deposit.swap.fillDeadline
      })
    }
    if (hubSwap !== null) {
      // The local swap credits the SIGNED balance directly, so no recognize follows a composed delivery.
      push(out, record(await runHubSwapLeg(hubSwap, deposit.output.baseToken, input.params, ctx)))
    } else if (recognize) {
      push(
        out,
        record(await runRecognizeStep(input, ctx, await getBalance(puppet, Number(input.chainId), input.token)))
      )
    }
    return out
  }

  // Rebind the signing identity to the live session (a pre-session draft bakes the placeholder signer). The
  // withdraw's delivery needs no re-quote: its receiver is the user's WALLET, identity-independent by construction.
  const input = { ...draft.input, params: { user: draft.input.params.user, signer: ctx.session.signer } }
  const puppet = predictPuppetAccount(input.params)
  push(out, record(await runWithdrawStep(input, ctx, await getBalance(puppet, HUB_CHAIN_ID, input.inputToken))))
  return out
}

function depositRecognizeInput(draft: IDepositDraft): IRecognizeBalanceInput {
  return {
    params: draft.params,
    token: draft.output.baseToken,
    blockNumber: 0n,
    deadline: 0n,
    acceptableRelayFee: 0n,
    nonce: randomNonce(),
    chainId: BigInt(HUB_CHAIN_ID),
    amount: draft.output.amount,
    userDeploySig: '0x',
    userSignerProof: '0x'
  }
}
