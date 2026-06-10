import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictDepositRoute, predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import {
  attestAllocateIntent,
  attestBridgeIntent,
  attestClaimIntent,
  attestCreateFundAccountIntent,
  attestCreatePuppetAccountIntent,
  attestFulfillIntent,
  attestRecognizeBalanceIntent,
  attestSellIntent,
  attestSubscribeIntent,
  attestWithdrawToBridgeIntent,
  attestWithdrawToWalletIntent,
  type IAllocateInput,
  type IBridgeInput,
  type IClaimInput,
  type ICreateFundAccountInput,
  type ICreatePuppetAccountInput,
  type IDepositRoute,
  type IFulfillInput,
  type IRecognizeBalanceInput,
  type ISellInput,
  type ISubscribeInput,
  type IWithdrawToBridgeInput,
  type IWithdrawToWalletInput,
  resolveDispatchChainId,
  resolveDispatchNetwork
} from '@puppet/sdk/attestation'
import type { IAttestResult, IRelayRequest } from '@puppet/sdk/compact'
import type { ChainId } from '@puppet/sdk/const'
import {
  awaitWalletDeposit,
  computeClaimable,
  fetchDepositRouteBalance,
  getPuppetRedeemPosition,
  indexerBlock,
  pollDepositRouteBalance,
  pollRouteBalance,
  randomNonce,
  selectOne,
  tokenInfoFor
} from '@puppet/sdk/state'
import { getPublicClient } from '@wagmi/core'
import { type Address, erc20Abi, getAddress, type Hex, isAddressEqual, type PublicClient } from 'viem'
import { readContract, sendCalls, writeContract } from 'viem/actions'
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
import { buildAllocateInput } from './allocate.js'
import { buildClaimInput, buildFulfillInput, buildSellInput } from './redeem.js'
import { buildSubscribeInput } from './subscribe.js'

export type IAttestation = {
  request: IRelayRequest
  result: IAttestResult
}

export function computeSignedDelta(request: IRelayRequest, actualRelayFee: bigint): bigint {
  const intent = request.intent as unknown as {
    amount?: bigint
    inputAmount?: bigint
    initialDepositAmount?: bigint
    sweepAmount?: bigint
    masterAmount?: bigint
    amountIn?: bigint
    amountOut?: bigint
  }
  switch (request.kind) {
    case 'allocate': {
      const matchedAmountList = (request.input as { matchedAmountList?: bigint[] }).matchedAmountList ?? []
      const matched = matchedAmountList.reduce((acc, amount) => acc + amount, 0n)
      return (intent.masterAmount ?? 0n) + matched - actualRelayFee
    }
    case 'recognize':
      return (intent.amount ?? 0n) - actualRelayFee
    case 'withdrawToWallet':
      return -(intent.amount ?? 0n)
    case 'withdrawToBridge':
    case 'bridge':
      return -(intent.inputAmount ?? 0n)
    case 'createPuppetAccount':
      return (intent.initialDepositAmount ?? 0n) - actualRelayFee
    case 'createFundAccount':
      return (intent.sweepAmount ?? 0n) - actualRelayFee
    case 'operate':
      return (intent.amountIn ?? 0n) - (intent.amountOut ?? 0n) - actualRelayFee
    default:
      return -actualRelayFee
  }
}

const ACCOUNT_GATE_ABI = PUPPET_CONTRACT_MAP.AccountGate.abi
const ACCOUNT_GATE_ADDRESS = PUPPET_CONTRACT_MAP.AccountGate.address

const BRIDGE_FILL_TIMEOUT_MS = 15 * 60 * 1000

function publicClientForChain(chainIdNum: number): PublicClient {
  const client = chainIdNum === HUB_CHAIN_ID ? homePublicClient : getPublicClient(wagmi, { chainId: chainIdNum })
  if (!client) throw new Error(`no public client for chain ${chainIdNum}`)
  return client as PublicClient
}

function resolveTokenAddress(ctx: ExecContext, chainIdNum: number, tokenId: Hex): Address {
  return tokenInfoFor(ctx.tokenRegistry, chainIdNum as ChainId, tokenId).token
}

function refreshBlock<T extends { blockNumber: bigint }>(input: T, ctx: ExecContext, chainId: number): T {
  const network = resolveDispatchNetwork(resolveDispatchChainId(chainId))
  return { ...input, blockNumber: indexerBlock(ctx.indexerHealth, network) }
}

async function fetchSignedBalance(ctx: ExecContext, account: Address, chainId: number, tokenId: Hex): Promise<bigint> {
  const row = await selectOne(ctx.sql, 'AccountBalance', {
    where: { account: { _eq: getAddress(account) }, chainId: { _eq: BigInt(chainId) }, tokenId: { _eq: tokenId } },
    fields: ['signedBalance']
  })
  return row?.signedBalance ?? 0n
}

async function runDeposit(input: IDepositRoute, ctx: ExecContext): Promise<void> {
  if (input.amount <= 0n) return
  if (input.walletBalance < input.amount) {
    throw new Error(`wallet balance ${input.walletBalance} below required ${input.amount}`)
  }

  const account = predictPuppetAccount(input.params)
  const settle = async (depositHash: Hex): Promise<void> => {
    await awaitWalletDeposit(ctx.sql, depositHash, BRIDGE_FILL_TIMEOUT_MS)
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
    const wallet = ctx.wallet.walletClient
    const chain = wallet.chain
    if (!chain || chain.id !== input.chainId) {
      throw new Error(`wallet not on chain ${input.chainId} (current: ${chain?.id ?? 'none'})`)
    }
    const depositCall = {
      to: ACCOUNT_GATE_ADDRESS,
      abi: ACCOUNT_GATE_ABI,
      functionName: 'deposit',
      args: [input.params, input.tokenId, input.amount]
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
        address: ACCOUNT_GATE_ADDRESS,
        abi: ACCOUNT_GATE_ABI,
        functionName: 'deposit',
        args: [input.params, input.tokenId, input.amount],
        account: ctx.wallet.address,
        chain
      })
    }
    await settle(depositHash)
    return
  }

  if (input.mode === 'native') {
    const wallet = ctx.wallet.walletClient
    const chain = wallet.chain
    if (!chain || chain.id !== input.chainId) {
      throw new Error(`wallet not on chain ${input.chainId} (current: ${chain?.id ?? 'none'})`)
    }
    const depositHash = await writeContract(wallet, {
      address: ACCOUNT_GATE_ADDRESS,
      abi: ACCOUNT_GATE_ABI,
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

async function runFundTransfer(input: IDepositRoute, ctx: ExecContext): Promise<void> {
  if (input.amount <= 0n) return
  if (input.walletBalance < input.amount) {
    throw new Error(`wallet balance ${input.walletBalance} below required ${input.amount}`)
  }
  const route = predictDepositRoute(predictPuppetAccount(input.params))
  const wallet = await walletClientForChain(ctx.wallet.walletClient, input.chainId)
  if (input.mode === 'native') {
    await writeContract(wallet, {
      address: ACCOUNT_GATE_ADDRESS,
      abi: ACCOUNT_GATE_ABI,
      functionName: 'depositWnt',
      args: [input.params],
      value: input.amount,
      account: ctx.wallet.address,
      chain: wallet.chain
    })
  } else {
    await writeContract(wallet, {
      address: input.token,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [route, input.amount],
      account: ctx.wallet.address,
      chain: wallet.chain
    })
  }
  await pollRouteBalance(publicClientForChain(input.chainId), input.token, route, input.amount, BRIDGE_FILL_TIMEOUT_MS)
}

async function runCreateFundAccountStep(
  input: ICreateFundAccountInput,
  ctx: ExecContext
): Promise<IAttestation | null> {
  const fund = predictFundAccount(predictPuppetAccount(input.params))
  const chainIdNum = Number(input.chainId)
  if (await isDeployed(fund, chainIdNum)) return null
  const token = resolveTokenAddress(ctx, chainIdNum, input.tokenId)
  const publicClient = publicClientForChain(chainIdNum)
  const routeBalance =
    input.sweepAmount > 0n
      ? await pollDepositRouteBalance(publicClient, token, fund, input.sweepAmount, BRIDGE_FILL_TIMEOUT_MS)
      : await fetchDepositRouteBalance(publicClient, token, fund)
  const fresh = refreshBlock(input, ctx, chainIdNum)
  const { intent, typedData } = attestCreateFundAccountIntent(
    {
      chainId: resolveDispatchChainId(chainIdNum),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      routeBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'createFundAccount' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runFundBridgeStep(
  input: IBridgeInput,
  ctx: ExecContext
): Promise<{ attestation: IAttestation; expectedOutput: bigint }> {
  const puppet = predictPuppetAccount(input.params)
  const originChainId = Number(input.chainId)
  const originToken = resolveTokenAddress(ctx, originChainId, input.tokenId)
  const originClient = publicClientForChain(originChainId)

  await pollRouteBalance(
    originClient,
    originToken,
    predictDepositRoute(puppet),
    input.inputAmount > 0n ? input.inputAmount : 1n,
    BRIDGE_FILL_TIMEOUT_MS
  )

  const fresh = refreshBlock(input, ctx, originChainId)
  const routeBalance = await fetchDepositRouteBalance(originClient, originToken, puppet)
  const { intent, typedData } = attestBridgeIntent(
    {
      chainId: resolveDispatchChainId(originChainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      routeBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'bridge' as const, input: fresh, intent, signature }
  return { attestation: { request, result: await compact.attest(request) }, expectedOutput: input.outputAmount }
}

async function runFundSteps(steps: IMasterFundStep[], ctx: ExecContext, out: IAttestation[]): Promise<bigint | null> {
  let bridgedAmount: bigint | null = null
  for (const step of steps) {
    switch (step.kind) {
      case 'transferToMaster':
      case 'transferToMasterWnt':
        await runFundTransfer(step.input, ctx)
        break
      case 'createFundAccount':
        push(out, await runCreateFundAccountStep(step.input, ctx))
        break
      case 'bridge': {
        const bridged = await runFundBridgeStep(step.input, ctx)
        push(out, bridged.attestation)
        bridgedAmount = bridged.expectedOutput
        break
      }
    }
  }
  return bridgedAmount
}

async function runRecognizeStep(
  input: IRecognizeBalanceInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const chainIdNum = Number(input.chainId)
  const token = resolveTokenAddress(ctx, chainIdNum, input.tokenId)
  const publicClient = publicClientForChain(chainIdNum)
  const routeBalance = await pollDepositRouteBalance(publicClient, token, account, input.amount, BRIDGE_FILL_TIMEOUT_MS)

  const fresh = refreshBlock({ ...input, amount: routeBalance }, ctx, chainIdNum)
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
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'recognize' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runBridgeHubStep(input: IBridgeInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const spokeChainId = Number(input.chainId)
  const token = resolveTokenAddress(ctx, spokeChainId, input.tokenId)
  const publicClient = publicClientForChain(spokeChainId)

  if (signedBalance > 0n) {
    await awaitStreamMatch(
      ctx.subaccountList,
      accs => {
        const source = accs.find(a => isAddressEqual(a.account, account))?.balances.get(input.tokenId)?.signedBalance
        if (source === undefined) return false
        return input.inputAmount > 0n ? source >= input.inputAmount : source > 0n
      },
      BRIDGE_FILL_TIMEOUT_MS
    ).catch(err => {
      throw new Error(`indexer did not reflect ${account} signedBalance for bridge: ${err.message}`)
    })
  } else {
    const minAmount = input.inputAmount > 0n ? input.inputAmount : 1n
    await pollDepositRouteBalance(publicClient, token, account, minAmount, BRIDGE_FILL_TIMEOUT_MS)
  }

  const fresh = refreshBlock(input, ctx, spokeChainId)
  const routeBalance = await fetchDepositRouteBalance(publicClient, token, account)
  const { intent, typedData } = attestBridgeIntent(
    {
      chainId: resolveDispatchChainId(spokeChainId),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      routeBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'bridge' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runWithdrawToBridgeStep(input: IWithdrawToBridgeInput, ctx: ExecContext): Promise<IAttestation> {
  const account = predictPuppetAccount(input.params)
  const token = resolveTokenAddress(ctx, HUB_CHAIN_ID, input.tokenId)
  const routeBalance = await fetchDepositRouteBalance(homePublicClient, token, account)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestWithdrawToBridgeIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      routeBalance,
      expectedOutputAmount: null
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'withdrawToBridge' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runWithdrawToWalletStep(
  input: IWithdrawToWalletInput,
  ctx: ExecContext,
  signedBalance: bigint
): Promise<IAttestation> {
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const { intent, typedData } = attestWithdrawToWalletIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'withdrawToWallet' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runAllocateStep(input: IAllocateInput, ctx: ExecContext): Promise<IAttestation> {
  const fund = predictFundAccount(input.share.master)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const [positions, fundState] = await Promise.all([fetchMasterSubscribers(fund), fetchMasterPoolState(fund)])
  const { intent, typedData } = attestAllocateIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      totalShareSupply: fundState?.totalShareSupply ?? 0n,
      seeded: fundState?.seeded ?? false,
      poolTotalStake: fundState?.totalStake ?? 0n,
      positions
    },
    fresh
  )
  const signature = await ctx.session.account.signTypedData(typedData)
  const request = { kind: 'allocate' as const, input: fresh, intent, signature }
  return { request, result: await compact.attest(request) }
}

async function runSellStep(input: ISellInput, ctx: ExecContext, signedBalance: bigint): Promise<IAttestation> {
  const fund = predictFundAccount(input.share.master)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const pool = await fetchMasterPoolState(fund)
  const { intent, typedData } = attestSellIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      claimable: computeClaimable(await getPuppetRedeemPosition(ctx.sql, predictPuppetAccount(input.params), fund)),
      shareToken: (pool?.shareToken as Address | undefined) ?? null,
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
  const fund = predictFundAccount(input.share.master)
  const fresh = refreshBlock(input, ctx, HUB_CHAIN_ID)
  const pool = await fetchMasterPoolState(fund)
  const { intent, typedData } = attestFulfillIntent(
    {
      chainId: resolveDispatchChainId(HUB_CHAIN_ID),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      signedBalance,
      shareToken: (pool?.shareToken as Address | undefined) ?? null,
      totalShareSupply: pool?.totalShareSupply ?? 0n,
      queuedShares: pool?.queuedShares ?? 0n,
      poolTotalStake: pool?.totalStake ?? 0n
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
  const token = resolveTokenAddress(ctx, chainIdNum, input.tokenId)
  const publicClient = publicClientForChain(chainIdNum)
  const depositRouteBalance =
    fresh.initialDepositAmount > 0n
      ? await pollDepositRouteBalance(publicClient, token, puppet, fresh.initialDepositAmount, BRIDGE_FILL_TIMEOUT_MS)
      : await fetchDepositRouteBalance(publicClient, token, puppet)
  const { intent, typedData } = attestCreatePuppetAccountIntent(
    {
      chainId: resolveDispatchChainId(chainIdNum),
      tokenRegistry: ctx.tokenRegistry,
      currentBlock: fresh.blockNumber,
      depositRouteBalance
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

const balanceKey = (account: Address, chainId: number, tokenId: Hex): string =>
  `${account.toLowerCase()}:${chainId}:${tokenId.toLowerCase()}`

const FUND_ROUTED: ReadonlySet<string> = new Set(['operate', 'allocate', 'fulfill', 'createFundAccount'])

function accountForRequest(req: IRelayRequest): Address {
  const account = predictPuppetAccount((req.input as { params: IAccountLib__AccountInitParams }).params)
  return FUND_ROUTED.has(req.kind) ? predictFundAccount(account) : account
}

function tokenIdForRequest(req: IRelayRequest): Hex {
  const input = req.input as { tokenId?: Hex; baseTokenId?: Hex }
  return (input.tokenId ?? input.baseTokenId) as Hex
}

export async function runDraft(draft: IDraft, ctx: ExecContext): Promise<IAttestation[]> {
  const out: IAttestation[] = []
  const balances = new Map<string, bigint>()

  const getBalance = async (account: Address, chainId: number, tokenId: Hex): Promise<bigint> => {
    const key = balanceKey(account, chainId, tokenId)
    const cached = balances.get(key)
    if (cached !== undefined) return cached
    const signedBalance = await fetchSignedBalance(ctx, account, chainId, tokenId)
    balances.set(key, signedBalance)
    return signedBalance
  }

  const record = (settled: IAttestation | null): IAttestation | null => {
    if (settled === null) return null
    const acc = accountForRequest(settled.request)
    const chainId = Number((settled.request.intent as { chainId: bigint }).chainId)
    const tokenId = tokenIdForRequest(settled.request)
    const key = balanceKey(acc, chainId, tokenId)
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
            tokenId: input.baseTokenId,
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
    push(out, record(await runSubscribeStep(input, ctx, await getBalance(puppet, HUB_CHAIN_ID, input.baseTokenId))))
    return out
  }
  if (draft.kind === 'allocate') {
    const params = { user: ctx.wallet.address, signer: ctx.session.signer }
    push(
      out,
      record(
        await runCreatePuppetAccountStep(
          {
            chainId: BigInt(HUB_CHAIN_ID),
            params,
            tokenId: draft.baseTokenId,
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
    const fundSteps = draft.inputSteps.map(
      (step): IMasterFundStep =>
        step.kind === 'createFundAccount' ? step : ({ ...step, input: { ...step.input, params } } as IMasterFundStep)
    )
    const puppet = predictPuppetAccount(params)
    const hubBefore = await fetchDepositRouteBalance(homePublicClient, draft.baseToken, puppet)
    const bridged = await runFundSteps(fundSteps, ctx, out)
    if (bridged !== null && bridged > 0n) {
      await pollDepositRouteBalance(
        homePublicClient,
        draft.baseToken,
        puppet,
        hubBefore + bridged,
        BRIDGE_FILL_TIMEOUT_MS
      )
    }
    const masterAmount = await fetchDepositRouteBalance(homePublicClient, draft.baseToken, puppet)
    const input = await buildAllocateInput({ ...draft, masterAmount }, ctx)
    push(out, record(await runAllocateStep(input, ctx)))
    return out
  }
  if (draft.kind === 'sell') {
    const input = await buildSellInput(draft, ctx)
    const puppet = predictPuppetAccount(input.params)
    push(out, record(await runSellStep(input, ctx, await getBalance(puppet, HUB_CHAIN_ID, input.share.baseTokenId))))
    return out
  }
  if (draft.kind === 'claim') {
    push(out, record(await runClaimStep(await buildClaimInput(draft, ctx), ctx)))
    return out
  }
  if (draft.kind === 'fulfill') {
    const input = await buildFulfillInput(draft, ctx)
    const fund = predictFundAccount(input.share.master)
    push(out, record(await runFulfillStep(input, ctx, await getBalance(fund, HUB_CHAIN_ID, input.share.baseTokenId))))
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
      case 'walletDepositWnt':
        await runDeposit(withParams(step.input), ctx)
        break
      case 'bridge': {
        const input = withParams(step.input)
        const puppet = predictPuppetAccount(input.params)
        push(
          out,
          record(await runBridgeHubStep(input, ctx, await getBalance(puppet, Number(input.chainId), input.tokenId)))
        )
        break
      }
      case 'withdrawToBridge':
        push(out, record(await runWithdrawToBridgeStep(step.input, ctx)))
        break
      case 'recognize': {
        const input = withParams(step.input)
        const puppet = predictPuppetAccount(input.params)
        push(
          out,
          record(await runRecognizeStep(input, ctx, await getBalance(puppet, Number(input.chainId), input.tokenId)))
        )
        break
      }
      case 'withdrawToWallet': {
        const puppet = predictPuppetAccount(step.input.params)
        push(
          out,
          record(
            await runWithdrawToWalletStep(step.input, ctx, await getBalance(puppet, HUB_CHAIN_ID, step.input.tokenId))
          )
        )
        break
      }
    }
  }
  return out
}
