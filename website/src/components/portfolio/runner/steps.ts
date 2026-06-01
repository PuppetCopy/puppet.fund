import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictMasterAccount, predictPuppetAccount, predictTransientRoute } from '@puppet/sdk/account'
import {
  attestAllocateIntent,
  attestBridgeHubIntent,
  attestBridgeIntent,
  attestBridgeToWalletIntent,
  attestClaimIntent,
  attestCreateMasterAccountIntent,
  attestCreateMasterIntent,
  attestCreatePuppetAccountIntent,
  attestFulfillIntent,
  attestSellIntent,
  attestSignTransientRouteBalanceIntent,
  attestSubscribeIntent,
  attestWithdrawIntent,
  fetchAccountOrThrow,
  type IAllocateInput,
  type IAllocateRulePosition,
  type IBridgeHubInput,
  type IBridgeInput,
  type IBridgeToWalletInput,
  type IClaimInput,
  type ICreateMasterAccountInput,
  type ICreateMasterInput,
  type ICreatePuppetAccountInput,
  type IFulfillInput,
  type ISellInput,
  type ISignTransientRouteBalanceInput,
  type ISubscribeInput,
  type IWalletDepositRoute,
  type IWalletDepositWntRoute,
  type IWithdrawInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import type { IAttestResult, IRelayRequest } from '@puppet/sdk/compact'

// Per-step attest bundle surfaced upward: the original request (so consumers
// know the kind + intent) plus the matchmaker's ack payload (txHash + actual
// relay fee). The signedBalance delta is derivable from intent + actualRelayFee.
export type IAttestation = {
  request: IRelayRequest
  result: IAttestResult
}

// signedBalance delta for the dispatched account, mirroring each gate's exact
// dispatch(amountIn, amountOut, relayFee) split. Per GatedExecutor.execute:
// signedPost = signedPre + amountIn - amountOut - relayFee. Note the relay fee
// is *folded into* the amount for outbound gates (withdraw/bridge: amountOut =
// amount - fee, so the net change is -amount), but *additional* for inbound
// gates (signTransientRouteBalance: amountIn = amount, fee charged on top → amount - fee).
// Execution-time kinds (allocate/claim/fulfill) move amounts not in the intent;
// they reduce by relayFee here and reconcile their full effect on the next fetch.
export function computeSignedDelta(request: IRelayRequest, actualRelayFee: bigint): bigint {
  const intent = request.intent as unknown as {
    amount?: bigint
    inputAmount?: bigint
    initialDepositAmount?: bigint
    amountIn?: bigint
    amountOut?: bigint
    fromTransientRoute?: boolean
  }
  switch (request.kind) {
    case 'signTransientRouteBalance':
      return (intent.amount ?? 0n) - actualRelayFee
    case 'walletWithdraw':
    case 'walletWithdrawWnt':
      return -(intent.amount ?? 0n)
    case 'bridgeToWallet':
      return -(intent.inputAmount ?? 0n)
    case 'bridgeHub':
      // fromTransientRoute funds never entered signedBalance — they bridge from
      // the TransientRoute, so signedBalance is untouched.
      return intent.fromTransientRoute ? 0n : -(intent.inputAmount ?? 0n)
    case 'createPuppetAccount':
      return (intent.initialDepositAmount ?? 0n) - actualRelayFee
    case 'operate':
      return (intent.amountIn ?? 0n) - (intent.amountOut ?? 0n) - actualRelayFee
    default:
      // createMaster, subscribe, sell, claim, fulfill, allocate
      return -actualRelayFee
  }
}

import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import {
  awaitWalletDeposit,
  fetchTransientRouteBalance,
  getAcceptableRelayFee,
  indexerBlock,
  pollTransientRouteBalance,
  randomNonce,
  tokenInfoFor
} from '@puppet/sdk/state'
import { getPublicClient } from '@wagmi/core'
import { type Address, erc20Abi, type Hex, isAddressEqual, type PublicClient } from 'viem'
import { sendCalls, writeContract } from 'viem/actions'
import { fetchAcrossQuote } from '../../../io/bridge/across.js'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../../io/indexer/query.js'
import { compact } from '../../../io/matchmaker/index.js'
import { awaitStreamMatch } from '../../../utils/awaitStreamMatch.js'
import { homePublicClient, wagmi } from '../../../wallet/index.js'
import type { IDraft, IMasterFundStep } from '../draft.js'
import {
  DEFAULT_DEADLINE_SEC,
  type ExecContext,
  isDeployed,
  pollCallsStatus,
  supportsAtomicBatch,
  walletClientForChain
} from './_shared.js'
import { buildAllocateInput, buildCreateMasterInput } from './allocate.js'
import { buildClaimInput, buildFulfillInput, buildSellInput } from './redeem.js'
import { buildSubscribeInput } from './subscribe.js'

const CORE_GATE_ABI = PUPPET_CONTRACT_MAP.CoreGate.abi
const CORE_GATE_ADDRESS = PUPPET_CONTRACT_MAP.CoreGate.address

async function runWalletDeposit(input: IWalletDepositRoute, ctx: ExecContext): Promise<bigint> {
  if (input.walletBalance < input.amount) {
    throw new Error(`wallet balance ${input.walletBalance} below required ${input.amount}`)
  }
  const needsApprove = input.walletAllowance < input.amount
  const wallet = ctx.wallet.walletClient
  const chain = wallet.chain
  if (!chain || chain.id !== input.chainId) {
    throw new Error(`wallet not on chain ${input.chainId} (current: ${chain?.id ?? 'none'})`)
  }

  const depositCall = {
    to: CORE_GATE_ADDRESS,
    abi: CORE_GATE_ABI,
    functionName: 'walletDeposit',
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
      address: CORE_GATE_ADDRESS,
      abi: CORE_GATE_ABI,
      functionName: 'walletDeposit',
      args: [input.params, input.token, input.amount],
      account: ctx.wallet.address,
      chain
    })
  }
  await awaitWalletDeposit(ctx.sql, depositHash, BRIDGE_FILL_TIMEOUT_MS)
  return 0n
}

async function transferToMasterTransientRoute(
  master: Address,
  baseTokenId: Hex,
  amount: bigint,
  chainId: number,
  ctx: ExecContext,
  walletBalance?: bigint
): Promise<void> {
  if (amount <= 0n) return
  if (walletBalance !== undefined && walletBalance < amount) {
    throw new Error(`wallet balance ${walletBalance} below required ${amount}`)
  }
  const token = resolveTokenAddress(ctx, chainId, baseTokenId)
  const wallet = await walletClientForChain(ctx.wallet.walletClient, chainId)
  await writeContract(wallet, {
    address: token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [predictTransientRoute(master), amount],
    account: ctx.wallet.address,
    chain: wallet.chain
  })
  await pollTransientRouteBalance(publicClientForChain(chainId), token, master, amount, BRIDGE_FILL_TIMEOUT_MS)
}

async function runCreateMasterAccountStep(
  input: ICreateMasterAccountInput,
  ctx: ExecContext
): Promise<IAttestation | null> {
  const chainIdNum = Number(input.chainId)
  if (await isDeployed(predictMasterAccount(input.params), chainIdNum)) return null
  const fresh = refreshBlock(input, ctx, chainIdNum)
  const { intent, typedData } = attestCreateMasterAccountIntent(
    {
      chainId: resolveDispatchChainId(chainIdNum),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      transientRouteBalance: 0n
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'createMasterAccount' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runBridgeStep(
  input: IBridgeInput,
  ctx: ExecContext
): Promise<{ attestation: IAttestation; bridgedAmount: bigint }> {
  const master = predictMasterAccount(input.params)
  const spokeChainId = Number(input.chainId)
  const spokeToken = resolveTokenAddress(ctx, spokeChainId, input.params.baseTokenId)
  const hubToken = resolveTokenAddress(ctx, HUB_CHAIN_ID, input.params.baseTokenId)
  const spokeClient = publicClientForChain(spokeChainId)

  await pollTransientRouteBalance(
    spokeClient,
    spokeToken,
    master,
    input.inputAmount > 0n ? input.inputAmount : 1n,
    BRIDGE_FILL_TIMEOUT_MS
  )

  const acceptableRelayFee = await getAcceptableRelayFee(ctx.gasPrice, 'SpokeGate', 'bridge', spokeToken, spokeClient)
  const acrossInput = input.inputAmount > acceptableRelayFee ? input.inputAmount - acceptableRelayFee : 0n
  const quote = await fetchAcrossQuote({
    originChainId: spokeChainId,
    destinationChainId: HUB_CHAIN_ID,
    inputToken: spokeToken,
    outputToken: hubToken,
    inputAmount: acrossInput,
    recipient: predictTransientRoute(master)
  })
  const fresh = refreshBlock(
    {
      ...input,
      acceptableRelayFee,
      exclusiveRelayer: quote.exclusiveRelayer,
      quoteTimestamp: quote.quoteTimestamp,
      fillDeadline: quote.fillDeadline,
      exclusivityDeadline: quote.exclusivityDeadline,
      outputAmount: quote.outputAmount
    },
    ctx,
    spokeChainId
  )
  const transientRouteBalance = await fetchTransientRouteBalance(spokeClient, spokeToken, master)
  const { intent, typedData } = attestBridgeIntent(
    {
      chainId: resolveDispatchChainId(spokeChainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance: 0n,
      transientRouteBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'bridge' as const, input: fresh, intent, signature }
  const attestation = { request, result: await compact.attest(request) }
  const bridgedAmount = await pollTransientRouteBalance(
    publicClientForChain(HUB_CHAIN_ID),
    hubToken,
    master,
    quote.outputAmount,
    BRIDGE_FILL_TIMEOUT_MS
  )
  return { attestation, bridgedAmount }
}

async function runFundSteps(steps: IMasterFundStep[], ctx: ExecContext, out: IAttestation[]): Promise<bigint | null> {
  let bridgedAmount: bigint | null = null
  for (const step of steps) {
    switch (step.kind) {
      case 'transferToMaster':
        await transferToMasterTransientRoute(
          step.input.master,
          step.input.baseTokenId,
          step.input.amount,
          step.input.chainId,
          ctx,
          step.input.walletBalance
        )
        break
      case 'createMasterAccount':
        push(
          out,
          await runCreateMasterAccountStep(
            { ...step.input, userDeploySig: ctx.session.bindSig, userSignerProof: ctx.session.signerProof },
            ctx
          )
        )
        break
      case 'bridge': {
        const bridged = await runBridgeStep(step.input, ctx)
        push(out, bridged.attestation)
        bridgedAmount = bridged.bridgedAmount
        break
      }
    }
  }
  return bridgedAmount
}

async function runCreateMasterStep(input: ICreateMasterInput, ctx: ExecContext): Promise<IAttestation | null> {
  const master = predictMasterAccount(input.params)
  if (await isDeployed(master, HUB_CHAIN_ID)) return null

  const positions: IAllocateRulePosition[] = (await fetchMasterSubscribers(master)).map(r => ({
    puppet: r.puppet,
    body: r.body,
    mandate: r.mandate
  }))

  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const hubToken = resolveTokenAddress(ctx, HUB_CHAIN_ID, input.params.baseTokenId)
  const transientRouteBalance = await fetchTransientRouteBalance(publicClientForChain(HUB_CHAIN_ID), hubToken, master)
  const { intent, typedData } = attestCreateMasterIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      transientRouteBalance,
      positions
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'createMaster' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runWalletDepositWnt(input: IWalletDepositWntRoute, ctx: ExecContext): Promise<bigint> {
  if (input.walletBalance < input.amount) {
    throw new Error(`wallet ETH balance ${input.walletBalance} below required ${input.amount}`)
  }
  const wallet = ctx.wallet.walletClient
  const chain = wallet.chain
  if (!chain || chain.id !== input.chainId) {
    throw new Error(`wallet not on chain ${input.chainId} (current: ${chain?.id ?? 'none'})`)
  }

  const depositHash = await writeContract(wallet, {
    address: CORE_GATE_ADDRESS,
    abi: CORE_GATE_ABI,
    functionName: 'walletDepositWnt',
    args: [input.params],
    value: input.amount,
    account: ctx.wallet.address,
    chain
  })
  await awaitWalletDeposit(ctx.sql, depositHash, BRIDGE_FILL_TIMEOUT_MS)
  return 0n
}

function publicClientForChain(chainIdNum: number): PublicClient {
  const client = chainIdNum === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: chainIdNum })
  if (!client) throw new Error(`no public client for chain ${chainIdNum}`)
  return client as PublicClient
}

const BRIDGE_FILL_TIMEOUT_MS = 15 * 60 * 1000

function resolveTokenAddress(ctx: ExecContext, chainIdNum: number, baseTokenId: Hex): Address {
  return tokenInfoFor(ctx.tokenRegistry, chainIdNum as ChainId, baseTokenId).token
}

function refreshBlock<T extends { blockNumber: bigint }>(input: T, ctx: ExecContext, chainId: number): T {
  const network = resolveDispatchNetwork(resolveDispatchChainId(chainId))
  return { ...input, blockNumber: indexerBlock(ctx.indexerHealth, network) }
}

async function runSignTransientRouteBalanceStep(
  input: ISignTransientRouteBalanceInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const chainIdNum = Number(input.chainId)
  const token = resolveTokenAddress(ctx, chainIdNum, input.params.baseTokenId)
  const publicClient = publicClientForChain(chainIdNum)
  const transientRouteBalance = await pollTransientRouteBalance(
    publicClient,
    token,
    account,
    input.amount,
    BRIDGE_FILL_TIMEOUT_MS
  )

  const fresh = refreshBlock({ ...input, amount: transientRouteBalance }, ctx, chainIdNum)
  const { intent, typedData } = attestSignTransientRouteBalanceIntent(
    {
      chainId: chainIdNum as ChainId,
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      transientRouteBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'signTransientRouteBalance' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runBridgeHubStep(
  input: IBridgeHubInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const spokeChainId = Number(input.chainId)
  const token = resolveTokenAddress(ctx, spokeChainId, input.params.baseTokenId)
  const publicClient = publicClientForChain(spokeChainId)

  if (input.fromTransientRoute) {
    const minAmount = input.inputAmount > 0n ? input.inputAmount : 1n
    await pollTransientRouteBalance(publicClient, token, account, minAmount, BRIDGE_FILL_TIMEOUT_MS)
  } else {
    await awaitStreamMatch(
      ctx.subaccountList,
      accs => {
        const found = accs.find(a => isAddressEqual(a.account, account))?.chains.get(spokeChainId)
        if (!found) return false
        const source = found.signedBalance
        return input.inputAmount > 0n ? source >= input.inputAmount : source > 0n
      },
      BRIDGE_FILL_TIMEOUT_MS
    ).catch(err => {
      throw new Error(`indexer did not reflect ${account} signedBalance for bridgeHub: ${err.message}`)
    })
  }

  const fresh = refreshBlock(input, ctx, spokeChainId)
  const transientRouteBalance = await fetchTransientRouteBalance(publicClient, token, account)
  const { intent, typedData } = attestBridgeHubIntent(
    {
      chainId: resolveDispatchChainId(spokeChainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      transientRouteBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'bridgeHub' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runBridgeToWalletStep(
  input: IBridgeToWalletInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestBridgeToWalletIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'bridgeToWallet' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runWithdrawStep(input: IWithdrawInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestWithdrawIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'walletWithdraw' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runAllocateStep(input: IAllocateInput, ctx: ExecContext): Promise<IAttestation> {
  const masterAccount = predictMasterAccount(input.params)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const [subscribers, shareToken] = await Promise.all([
    fetchMasterSubscribers(masterAccount),
    fetchMasterPoolState(masterAccount)
  ])
  const positions: IAllocateRulePosition[] = subscribers.map(r => ({
    puppet: r.puppet,
    body: r.body,
    mandate: r.mandate
  }))
  const { intent, typedData } = attestAllocateIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      totalShareSupply: shareToken?.totalShareSupply ?? 0n,
      seeded: shareToken?.seeded ?? false,
      positions
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'allocate' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runSellStep(input: ISellInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const masterAccount = predictMasterAccount(input.masterParams)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const pool = await fetchMasterPoolState(masterAccount)
  const { intent, typedData } = attestSellIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      poolTotalStake: pool?.totalStake ?? 0n,
      queuedShares: pool?.queuedShares ?? 0n
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'sell' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runClaimStep(input: IClaimInput, ctx: ExecContext): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestClaimIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'claim' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runFulfillStep(input: IFulfillInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const masterAccount = predictMasterAccount(input.params)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const pool = await fetchMasterPoolState(masterAccount)
  const { intent, typedData } = attestFulfillIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      totalShareSupply: pool?.totalShareSupply ?? 0n,
      queuedShares: pool?.queuedShares ?? 0n
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'fulfill' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runSubscribeStep(
  input: ISubscribeInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestSubscribeIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'subscribe' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

export async function runCreatePuppetAccountStep(
  input: ICreatePuppetAccountInput,
  ctx: ExecContext
): Promise<IAttestation | null> {
  const puppet = predictPuppetAccount(input.params)
  const chainIdNum = Number(input.chainId)
  if (await isDeployed(puppet, chainIdNum)) return null
  const fresh = refreshBlock(input, ctx, chainIdNum)
  const token = resolveTokenAddress(ctx, chainIdNum, input.params.baseTokenId)
  const publicClient = publicClientForChain(chainIdNum)
  const transientRouteBalance =
    fresh.initialDepositAmount > 0n
      ? await pollTransientRouteBalance(publicClient, token, puppet, fresh.initialDepositAmount, BRIDGE_FILL_TIMEOUT_MS)
      : await fetchTransientRouteBalance(publicClient, token, puppet)
  const { intent, typedData } = attestCreatePuppetAccountIntent(
    {
      chainId: resolveDispatchChainId(chainIdNum),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      transientRouteBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'createPuppetAccount' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

const push = (out: IAttestation[], value: IAttestation | null): void => {
  if (value !== null) out.push(value)
}

const balanceKey = (account: Address, chainId: number): string => `${account.toLowerCase()}:${chainId}`

const MASTER_ROUTED: ReadonlySet<string> = new Set(['operate', 'allocate', 'fulfill', 'createMaster'])
function accountForRequest(req: IRelayRequest): Address {
  const params = req.input.params
  return MASTER_ROUTED.has(req.kind) ? predictMasterAccount(params) : predictPuppetAccount(params)
}

export async function runDraft(draft: IDraft, ctx: ExecContext): Promise<IAttestation[]> {
  const out: IAttestation[] = []
  const balances = new Map<string, bigint>()

  // Single fetch per (account, chain). Subsequent steps on the same key thread
  // forward via the local delta (intent + actualRelayFee) — no indexer re-reads.
  const getBalance = async (account: Address, chainId: number): Promise<bigint> => {
    const key = balanceKey(account, chainId)
    const cached = balances.get(key)
    if (cached !== undefined) return cached
    const row = await fetchAccountOrThrow(ctx.sql, account, chainId)
    balances.set(key, row.signedBalance)
    return row.signedBalance
  }

  const record = (settled: IAttestation | null): IAttestation | null => {
    if (settled === null) return null
    const acc = accountForRequest(settled.request)
    const chainId = Number((settled.request.intent as { chainId: bigint }).chainId)
    const key = balanceKey(acc, chainId)
    const prior = balances.get(key) ?? 0n
    balances.set(key, prior + computeSignedDelta(settled.request, settled.result.actualRelayFee))
    return settled
  }

  if (draft.kind === 'subscribe') {
    const input = await buildSubscribeInput(draft, ctx)
    const puppet = predictPuppetAccount(input.params)
    push(
      out,
      record(
        await runCreatePuppetAccountStep(
          {
            chainId: BigInt(HUB_CHAIN_ID),
            params: input.params,
            blockNumber: indexerBlock(ctx.indexerHealth, resolveDispatchNetwork(resolveDispatchChainId(HUB_CHAIN_ID))),
            deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
            nonce: randomNonce(),
            acceptableRelayFee: 0n,
            initialDepositAmount: 0n,
            userDeploySig: ctx.session.bindSig,
            userSignerProof: ctx.session.signerProof
          },
          ctx
        )
      )
    )
    push(out, record(await runSubscribeStep(input, ctx, await getBalance(puppet, HUB_CHAIN_ID))))
    return out
  }
  if (draft.kind === 'allocate') {
    const bridged = await runFundSteps(draft.inputSteps, ctx, out)
    const input = await buildAllocateInput({ ...draft, masterAmount: bridged ?? draft.masterAmount }, ctx)
    push(out, record(await runAllocateStep(input, ctx)))
    return out
  }
  if (draft.kind === 'createMaster') {
    const bridged = await runFundSteps(draft.inputSteps, ctx, out)
    const input = await buildCreateMasterInput({ ...draft, masterAmount: bridged ?? draft.masterAmount }, ctx)
    push(
      out,
      record(
        await runCreateMasterStep(
          { ...input, userDeploySig: ctx.session.bindSig, userSignerProof: ctx.session.signerProof },
          ctx
        )
      )
    )
    return out
  }
  if (draft.kind === 'sell') {
    const input = await buildSellInput(draft, ctx)
    const puppet = predictPuppetAccount(input.params)
    push(out, record(await runSellStep(input, ctx, await getBalance(puppet, HUB_CHAIN_ID))))
    return out
  }
  if (draft.kind === 'claim') {
    push(out, record(await runClaimStep(await buildClaimInput(draft, ctx), ctx)))
    return out
  }
  if (draft.kind === 'fulfill') {
    const input = await buildFulfillInput(draft, ctx)
    const master = predictMasterAccount(input.params)
    push(out, record(await runFulfillStep(input, ctx, await getBalance(master, HUB_CHAIN_ID))))
    return out
  }

  const rebindParams =
    draft.kind === 'deposit' && draft.lateBindDerivation
      ? { ...draft.lateBindDerivation, signer: ctx.session.signer }
      : undefined
  const withParams = <T extends { params: IAccountLib__AccountInitParams }>(input: T): T =>
    rebindParams ? { ...input, params: rebindParams } : input

  for (const step of draft.inputSteps) {
    switch (step.kind) {
      case 'createPuppetAccount':
        push(
          out,
          record(
            await runCreatePuppetAccountStep(
              {
                ...withParams(step.input),
                userDeploySig: ctx.session.bindSig,
                userSignerProof: ctx.session.signerProof
              },
              ctx
            )
          )
        )
        break
      case 'walletDeposit':
        await runWalletDeposit(withParams(step.input), ctx)
        break
      case 'walletDepositWnt':
        await runWalletDepositWnt(withParams(step.input), ctx)
        break
      case 'bridgeHub': {
        const params = withParams(step.input)
        const puppet = predictPuppetAccount(params.params)
        push(out, record(await runBridgeHubStep(params, ctx, await getBalance(puppet, Number(params.chainId)))))
        break
      }
      case 'bridgeToWallet': {
        const puppet = predictPuppetAccount(step.input.params)
        push(out, record(await runBridgeToWalletStep(step.input, ctx, await getBalance(puppet, HUB_CHAIN_ID))))
        break
      }
      case 'signTransientRouteBalance': {
        const params = withParams(step.input)
        const puppet = predictPuppetAccount(params.params)
        push(
          out,
          record(await runSignTransientRouteBalanceStep(params, ctx, await getBalance(puppet, Number(params.chainId))))
        )
        break
      }
      case 'walletWithdraw': {
        const puppet = predictPuppetAccount(step.input.params)
        push(out, record(await runWithdrawStep(step.input, ctx, await getBalance(puppet, HUB_CHAIN_ID))))
        break
      }
    }
  }
  return out
}
