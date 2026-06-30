import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
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
  type IAllocateInput,
  type IClaimInput,
  type IDepositRoute,
  type IFundRecognizeInput,
  type IFundSwapInput,
  type ILiquidateInput,
  type IMandateInput,
  type IOperateInput,
  type IRecognizeBalanceInput,
  type IRedeemInput,
  type ISellInput,
  type ISwapInput,
  type IWithdrawInput,
  resolveDispatchChainId
} from '@puppet/sdk/attestation'
import { type IDispatchedFrame, type IRelayRequest, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import { fundPositionTable } from '@puppet/sdk/schema'
import {
  symbolByAddress,
  awaitAccountCall,
  awaitWalletDeposit,
  chainHeadBlock,
  computeClaimable,
  fetchDepositRouteBalance,
  fetchRouteBalance,
  pollDepositRouteBalance,
  pollRouteBalance,
  randomNonce,
  tokenInfoFor
} from '@puppet/sdk/state'
import { getPublicClient } from '@wagmi/core'
import { type Address, erc20Abi, getAddress, type Hex, type PublicClient, type TypedDataDefinition } from 'viem'
import { getBalance, getGasPrice, readContract, sendCalls, writeContract } from 'viem/actions'
import { fetchLifiSwapQuote } from '../../../io/bridge/lifiSwap.js'
import { fetchSwapQuote } from '../../../io/bridge/swapQuote.js'
import { fetchMasterPoolState, fetchMasterSubscribers } from '../../../io/datastore/query.js'
import { compact } from '../../../io/matchmaker/index.js'
import { client } from '../../../io/matchmaker/reads.js'
import { readAccountDeployed, readSignedBalance } from '../../../io/onchain/account.js'
import { homePublicClient, wagmi } from '../../../wallet/index.js'
import type { IDepositDraft, IDraft, IFundSwapDraft, ISubscribeDraft } from '../draft.js'
import {
  DEFAULT_DEADLINE_SEC,
  type ExecContext,
  pollCallsStatus,
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
}

async function signAndSettle(
  request: Omit<IRelayRequest, 'signature'>,
  typedData: TypedDataDefinition,
  token: Address,
  ctx: ExecContext
): Promise<IAttestation> {
  const signature = await ctx.session.account.signTypedData(typedData)
  const signed = { ...request, signature } as IRelayRequest
  const ack = await compact.attest(signed)
  try {
    await awaitAccountCall(publicClientForChain(Number(ack.chainId)), ack.account, ack.nonce, SETTLEMENT_TIMEOUT_MS)
  } catch (err) {
    throw new Error(
      `${signed.kind} was dispatched (tx ${ack.txHash}) but its settlement was not confirmed in time, verify the transaction before retrying: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  return { request: signed, token, result: ack }
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
  const acceptableRelayFee = await resolveRelayFee(ctx, 'FundGate', 'operate', feeToken, 0n)
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

function publicClientForChain(chainIdNum: number): PublicClient {
  const client = chainIdNum === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: chainIdNum })
  if (!client) throw new Error(`no public client for chain ${chainIdNum}`)
  return client as PublicClient
}

function resolveTokenAddress(ctx: ExecContext, chainIdNum: number, token: Address): Address {
  return tokenInfoFor(ctx.tokenRegistry, chainIdNum as ChainId, token).token
}

function refreshBlock<T extends { blockNumber: bigint }>(input: T, ctx: ExecContext, chainId: number): T {
  return { ...input, blockNumber: chainHeadBlock(ctx.chainLiveness, resolveDispatchChainId(chainId)) }
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
  if (input.walletBalance < input.amount) {
    throw new Error(`wallet balance ${input.walletBalance} below required ${input.amount}`)
  }

  const account = predictPuppetAccount(input.params)
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
  await writeContract(wallet, {
    address: input.token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [predictDepositRoute(account), input.amount],
    account: ctx.wallet.address,
    chain: wallet.chain
  })
  await pollRouteBalance(
    publicClientForChain(input.chainId),
    input.token,
    predictDepositRoute(account),
    input.amount,
    BRIDGE_FILL_TIMEOUT_MS
  )
}

// Multi-key CREATE2: a fund address no longer reverse-derives to its {master, baseToken,
// name}. The operate/swap flows act on a user's already-deployed fund, so resolve its
// identity from the indexed Fund entity at the fund address.
async function resolveFundParams(ctx: ExecContext, fund: Address): Promise<IFundAccountLib__FundAccountInitParams> {
  const row = await fetchMasterPoolState(fund)
  if (!row) throw new Error(`fund ${fund} not in datastore; cannot derive its identity`)
  return { master: row.master as Address, baseToken: row.baseToken as Hex, name: row.name as Hex }
}

async function runFundSwapStep(
  input: ISwapInput,
  ctx: ExecContext
): Promise<{ attestation: IAttestation; expectedOutput: bigint }> {
  const puppet = predictPuppetAccount(input.params)
  const originChainId = Number(input.chainId)
  const originToken = resolveTokenAddress(ctx, originChainId, input.inputToken)
  const originClient = publicClientForChain(originChainId)

  await pollRouteBalance(
    originClient,
    originToken,
    predictDepositRoute(puppet),
    input.inputAmount > 0n ? input.inputAmount : 1n,
    BRIDGE_FILL_TIMEOUT_MS
  )

  const fresh = refreshBlock(
    { ...input, userDeploySig: ctx.session.bindSig, userSignerProof: ctx.session.signerProof },
    ctx,
    originChainId
  )
  const routeBalance = await fetchDepositRouteBalance(originClient, originToken, puppet)
  const { intent, typedData } = attestSwapIntent(
    {
      chainId: resolveDispatchChainId(originChainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      sourceBalance: routeBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  return {
    attestation: await signAndSettle({ kind: 'swap', input: fresh, intent }, typedData, fresh.inputToken, ctx),
    expectedOutput: input.outputAmount
  }
}

async function runRecognizeStep(
  input: IRecognizeBalanceInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const chainIdNum = Number(input.chainId)
  const token = resolveTokenAddress(ctx, chainIdNum, input.token)
  const publicClient = publicClientForChain(chainIdNum)
  const routeBalance = await pollDepositRouteBalance(publicClient, token, account, input.amount, BRIDGE_FILL_TIMEOUT_MS)
  const acceptableRelayFee = await resolveRelayFee(ctx, 'PuppetGate', 'recognize', input.token)

  const fresh = refreshBlock(
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

async function runSwapHubStep(input: ISwapInput, ctx: ExecContext): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const spokeChainId = Number(input.chainId)
  const token = resolveTokenAddress(ctx, spokeChainId, input.inputToken)
  const publicClient = publicClientForChain(spokeChainId)

  const minAmount = input.inputAmount > 0n ? input.inputAmount : 1n
  await pollDepositRouteBalance(publicClient, token, account, minAmount, BRIDGE_FILL_TIMEOUT_MS)

  const fresh = refreshBlock(
    { ...input, userDeploySig: ctx.session.bindSig, userSignerProof: ctx.session.signerProof },
    ctx,
    spokeChainId
  )
  const routeBalance = await fetchDepositRouteBalance(publicClient, token, account)
  const { intent, typedData } = attestSwapIntent(
    {
      chainId: resolveDispatchChainId(spokeChainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      sourceBalance: routeBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  return signAndSettle({ kind: 'swap', input: fresh, intent }, typedData, fresh.inputToken, ctx)
}

async function runWithdrawStep(input: IWithdrawInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
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

async function runAllocateStep(input: IAllocateInput, ctx: ExecContext): Promise<IAttestation> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const [positions, fundState] = await Promise.all([
    fetchMasterSubscribers(ctx.tokenRegistry, fund, fresh.fundParams.baseToken),
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

async function runSellStep(input: ISellInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
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
  return signAndSettle({ kind: 'claim', input: fresh, intent }, typedData, fresh.fundParams.baseToken, ctx)
}

async function runRedeemStep(input: IRedeemInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
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

async function runLiquidateStep(input: ILiquidateInput, ctx: ExecContext): Promise<IAttestation> {
  const fund = predictFundAccount(input.fundParams)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
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
): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
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
  out.push(await runMandateStep(input, ctx, signedBalance, routeBalance))
  return out
}

// The DEX quote refreshes at execution; abort if it falls materially below the minimum output the user
// reviewed (a generous band absorbs normal preview-to-execution drift, both already slippage-floored).
const SWAP_REQUOTE_TOLERANCE_BPS = 500n
const belowReviewedFloor = (reviewedMinOut: bigint, requotedOutput: bigint): boolean =>
  reviewedMinOut > 0n && requotedOutput < (reviewedMinOut * (10000n - SWAP_REQUOTE_TOLERANCE_BPS)) / 10000n

// FA internal rebalance: one guarded FundGate.swap (fromRoute=false) debiting the fund's signed
// inputToken, running the DEX on the fund account, crediting signed outputToken. A LOCAL swap delivers the
// output to the fund and credits it in the same intent. A CROSS-CHAIN swap (destinationChainId !== chainId) debits
// the input, bridges the output to the fund's route on the destination, and credits it via a second FundGate
// recognize there (mirrors the cross-chain deposit's source -> destination-recognize, but for the fund account).
async function runFundSwapDraft(draft: IFundSwapDraft, ctx: ExecContext): Promise<IAttestation[]> {
  const fundParams = await resolveFundParams(ctx, draft.account)
  const fund = predictFundAccount(fundParams)
  const destChainId = draft.destinationChainId ?? draft.chainId
  const isLocal = destChainId === draft.chainId
  const inputToken = resolveTokenAddress(ctx, draft.chainId, draft.tokenIn)
  const outputToken = resolveTokenAddress(ctx, destChainId, draft.tokenOut)
  const route = predictDepositRoute(fund)

  // FundGate.swap skims the relay fee off the input token BEFORE running the DEX: it approves the provider only
  // inputAmount - actualRelayFee. So the provider calldata must be quoted for that NET amount, not the full input, or the
  // DEX's transferFrom exceeds the on-chain approval and reverts TRANSFER_FROM_FAILED. acceptableRelayFee is the fee
  // ceiling (the matchmaker's actual fee is <= it), so netting by it stays at or under the on-chain approval.
  const gasPrice = draft.chainId === HUB_CHAIN_ID ? ctx.gasPrice : await getGasPrice(publicClientForChain(draft.chainId))
  const acceptableRelayFee = await resolveRelayFee(ctx, 'FundGate', 'swap', draft.tokenIn, undefined, gasPrice)
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
        crossToken: symbolByAddress(draft.tokenIn) !== symbolByAddress(draft.tokenOut)
      })
  if (quote.outputAmount === 0n) throw new Error('swap route quoted zero output, adjust the amount and retry')
  if (belowReviewedFloor(draft.minOut, quote.outputAmount)) {
    throw new Error('Swap re-quoted materially below your reviewed minimum output; refresh and retry')
  }

  const destRouteBefore = isLocal ? 0n : await fetchRouteBalance(publicClientForChain(destChainId), outputToken, route)
  const signedBalance = await fetchSignedBalance(ctx, fund, draft.chainId, draft.tokenIn)

  const input: IFundSwapInput = {
    params: { user: ctx.wallet.address, signer: ctx.session.signer },
    fundParams,
    inputToken: draft.tokenIn,
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
  const fresh = refreshBlock(input, ctx, draft.chainId)
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
  if (isLocal) return [swapped]

  const recognized = await runFundRecognizeStep(
    fundParams,
    destChainId,
    draft.tokenOut,
    destRouteBefore + quote.outputAmount,
    ctx
  )
  return [swapped, recognized]
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
): Promise<IAttestation> {
  const fund = predictFundAccount(fundParams)
  const route = predictDepositRoute(fund)
  const token = resolveTokenAddress(ctx, destChainId, outputToken)
  const destClient = publicClientForChain(destChainId)
  const routeBalance = await pollRouteBalance(destClient, token, route, minRouteBalance, BRIDGE_FILL_TIMEOUT_MS)
  const signedBalance = await fetchSignedBalance(ctx, fund, destChainId, outputToken)
  const acceptableRelayFee = await resolveRelayFee(ctx, 'FundGate', 'recognize', outputToken)

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
  const fresh = refreshBlock(input, ctx, destChainId)
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
    const prior = balances.get(key) ?? 0n
    balances.set(key, prior + computeSignedDelta(settled.request, settled.result.actualRelayFee))
    return settled
  }

  if (draft.kind === 'mandate') return runMandateBatch([draft], ctx)
  if (draft.kind === 'allocate') {
    const params = { user: ctx.wallet.address, signer: ctx.session.signer }
    const puppet = predictPuppetAccount(params)
    const hubBefore = await fetchDepositRouteBalance(homePublicClient, draft.baseToken, puppet)
    if (draft.wallet) await runDeposit({ ...draft.wallet, params }, ctx)
    let bridged: bigint | null = null
    if (draft.swap) {
      const r = await runFundSwapStep({ ...draft.swap, params }, ctx)
      push(out, r.attestation)
      bridged = r.expectedOutput
    }
    // Cross-chain only: the swapped funds reach the hub route asynchronously (the bridge fill), so wait for them. A
    // same-chain swap already settled synchronously in runFundSwapStep (its output is on the route), so polling for the
    // exact expected output would only stall on normal swap slippage — read the actual route balance below instead.
    if (bridged !== null && bridged > 0n && draft.swap && draft.swap.chainId !== draft.swap.destinationChainId) {
      await pollDepositRouteBalance(
        homePublicClient,
        draft.baseToken,
        puppet,
        hubBefore + bridged,
        BRIDGE_FILL_TIMEOUT_MS
      )
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
    if (draft.wallet) await runDeposit(withParams(draft.wallet), ctx)
    if (draft.swap) push(out, record(await runSwapHubStep(withParams(draft.swap), ctx)))
    if (recognize) {
      const input = withParams(depositRecognizeInput(draft))
      const puppet = predictPuppetAccount(input.params)
      push(
        out,
        record(await runRecognizeStep(input, ctx, await getBalance(puppet, Number(input.chainId), input.token)))
      )
    } else if (draft.swap && draft.swap.chainId !== draft.swap.destinationChainId) {
      // Recognize was folded into a following ALLOCATE/MANDATE, which sweeps the deposit route itself. For a CROSS-CHAIN
      // deposit the swapped funds reach the hub route asynchronously (the bridge fill), so hold here until they land — the
      // sweeper must not run before the fill. A SAME-CHAIN swap is NOT polled here: runSwapHubStep already settled it
      // synchronously (awaitAccountCall confirmed the swap tx mined the output onto the route), so polling again for the
      // exact expected output would only stall on normal LI.FI slippage. A home deposit (no swap) needs no wait either.
      const input = withParams(depositRecognizeInput(draft))
      const token = resolveTokenAddress(ctx, Number(input.chainId), input.token)
      await pollDepositRouteBalance(
        publicClientForChain(Number(input.chainId)),
        token,
        predictPuppetAccount(input.params),
        draft.output.amount,
        BRIDGE_FILL_TIMEOUT_MS
      )
    }
    return out
  }

  const puppet = predictPuppetAccount(draft.input.params)
  push(out, record(await runWithdrawStep(draft.input, ctx, await getBalance(puppet, HUB_CHAIN_ID, draft.input.inputToken))))
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
