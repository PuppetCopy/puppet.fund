import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IFund__AllocateIntent, IFund__RedeemIntent, IIAccount__Call, ISpokeGate__OperateIntent } from '@puppet/contracts/types'
import { accountNonce, predictUserAccount } from '@puppet/sdk/account'
import { CompactError, type IDispatchedFrame, type IDispatchRequest, requestAllocation, requestValuation, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import { CHAIN_MAP, type ChainId, DEFAULT_DEADLINE_SEC } from '@puppet/sdk/const'
import { DEFAULT_EVALUATION_CONFIG, screenSwapValue, USD_PER_BASE, VALUE_KEY } from '@puppet/sdk/evaluate'
import {
  allowanceTokensOf,
  attestAllocateIntent,
  attestFundSwapIntent,
  attestOperateIntent,
  attestRedeemIntent,
  GENESIS_NONCE,
  bestRoutePlan,
  creditableOf,
  type IAcrossTiming,
  type IDepositSwapInput,
  type ITermsDeps,
  pinBlocks,
  quoteSwapRoutes,
  readAcrossBuffers,
  readAllocationBlock,
  readAllocationCandidates,
  readEscrowCredit,
  readFundState,
  readShutdown,
  readTransits,
  routeCalldataBytes
} from '@puppet/sdk/intent'
import { fundTable } from '@puppet/sdk/schema'
import {
  chainTokenOfKey,
  computeRelayFee,
  declaredCallGas,
  dynamicCalldataBytes,
  fetchTokenBalance,
  followUpOf,
  RELAY_RATE_MAX_STALE_MS,
  tokenInfoFor,
  tokenPerNativeToken,
  wrappedNativeAddressOf
} from '@puppet/sdk/state'
import {
  type Address,
  createPublicClient,
  erc20Abi,
  getAddress,
  type Hex,
  hashTypedData,
  http,
  isAddressEqual,
  type PublicClient,
  type TypedDataDefinition,
  zeroAddress
} from 'viem'
import type { IConnector } from './connector.js'

export interface IOperatorConfig {
  chainId: ChainId
  rpcUrl: string
  hubRpcUrl: string
  routeEndpoint?: string
}

export interface IOperator {
  publicClient: PublicClient
  account: Address
  readBalance: (token: Address) => Promise<bigint>
  allocate: (contribution: bigint) => Promise<IDispatchedFrame | null>
  convert: (inputToken: Address, outputToken: Address, inputAmount: bigint, destinationChainId?: ChainId) => Promise<IDispatchedFrame | null>
  operate: (callList: IIAccount__Call[]) => Promise<IDispatchedFrame | null>
  redeem: (retire: bigint, drain: bigint) => Promise<IDispatchedFrame | null>
}

const deadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)

async function nonceOf(client: PublicClient, target: Address): Promise<bigint> {
  const code = await client.getCode({ address: target })
  if (code === undefined || code === '0x') return GENESIS_NONCE
  return accountNonce(client, target)
}

export async function createOperator(connector: IConnector, config: IOperatorConfig): Promise<IOperator> {
  const { matchmakerUrl, compact, chronicle, tokenRegistry, getRate, user, account, dryRun, approve } = connector
  const { chainId } = config
  const publicClient: PublicClient = createPublicClient({ chain: CHAIN_MAP[chainId], transport: http(config.rpcUrl) })
  const hubClient: PublicClient = createPublicClient({ chain: CHAIN_MAP[HUB_CHAIN_ID], transport: http(config.hubRpcUrl) })
  const terms: ITermsDeps = {
    chronicle,
    clients: { [chainId]: publicClient, [HUB_CHAIN_ID]: hubClient },
    getRate,
    getTokenRegistry: async () => tokenRegistry
  }
  const feeToken = chainTokenOfKey(chainId, VALUE_KEY)
  const hubFeeToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
  tokenInfoFor(tokenRegistry, chainId, feeToken)

  let share: Address | null = null
  async function fundShare(): Promise<Address> {
    if (share !== null) return share
    const row = (await chronicle.select(fundTable, { where: { master: account } }))[0]
    if (row === undefined) throw new Error(`the chronicle holds no fund for ${account}, so its share token is unknown`)
    share = getAddress(row.share)
    return share
  }

  function readBalance(token: Address): Promise<bigint> {
    return isAddressEqual(token, PROTOCOL.nativeToken)
      ? publicClient.getBalance({ address: account })
      : publicClient.readContract({ address: getAddress(token), abi: erc20Abi, functionName: 'balanceOf', args: [account] })
  }

  const parent = predictUserAccount(user)
  const bodyGenesis = { parent, key: '0x' as Hex, approval: '0x' as Hex, authorization: null }

  async function dispatch(
    client: PublicClient,
    approvalChainId: ChainId,
    typedData: TypedDataDefinition,
    seal: (signature: Hex) => IDispatchRequest
  ): Promise<IDispatchedFrame | null> {
    if (dryRun) {
      console.log(`[operator] dry-run: ${typedData.primaryType} built, not dispatched`)
      return null
    }
    const request = seal(await approve(approvalChainId, hashTypedData(typedData)))
    const ack = await compact.dispatch(request)
    const mined = await client.waitForTransactionReceipt({ hash: ack.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
    if (mined.status !== 'success') {
      throw new CompactError('DISPATCH_REVERTED', `${request.kind} transaction ${ack.txHash} reverted on-chain`, 'server')
    }
    return ack
  }

  async function allocate(contribution: bigint): Promise<IDispatchedFrame | null> {
    const roundToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
    const creditToken = chainTokenOfKey(chainId, VALUE_KEY)
    const share = await fundShare()
    const roundDeadline = deadline()
    const block = await hubClient.getBlockNumber()
    const [quote, fund, credit, candidates, blocked, shutdown, gasPrice, valuePerNativeToken, nonce] = await Promise.all([
      requestAllocation(matchmakerUrl, account, share, roundToken, contribution, roundDeadline, contribution > 0n ? { user, chainId, token: creditToken } : null),
      readFundState(terms, account, block),
      readEscrowCredit(terms, predictUserAccount(user), account, chainId, creditToken),
      readAllocationCandidates(terms, account, roundToken, block),
      readAllocationBlock(terms, account),
      readShutdown(terms, HUB_CHAIN_ID, block),
      hubClient.getGasPrice(),
      tokenPerNativeToken(getRate, HUB_CHAIN_ID, roundToken, RELAY_RATE_MAX_STALE_MS),
      nonceOf(hubClient, account)
    ])
    const followUp = followUpOf('allocate', creditableOf(credit) > 0n ? chainId : null)
    const followUpFee =
      followUp === null
        ? 0n
        : computeRelayFee(
            followUp.chainId,
            followUp.kind,
            false,
            await publicClient.getGasPrice(),
            await tokenPerNativeToken(getRate, followUp.chainId, chainTokenOfKey(followUp.chainId, VALUE_KEY), RELAY_RATE_MAX_STALE_MS),
            0n,
            0n,
            0n
          )
    const intent: IFund__AllocateIntent = {
      header: {
        account,
        user,
        nonce,
        deadline: roundDeadline,
        feeToken: zeroAddress,
        fee:
          (computeRelayFee(HUB_CHAIN_ID, 'allocate', false, gasPrice, valuePerNativeToken, BigInt(quote.allocationList.length), 0n, 0n) + followUpFee) *
          USD_PER_BASE
      },
      share,
      valuation: quote.valuation,
      price: quote.price,
      credit:
        creditableOf(credit) > 0n
          ? { chainId: BigInt(chainId), token: creditToken, amount: creditableOf(credit) }
          : { chainId: 0n, token: zeroAddress, amount: 0n },
      allocationList: quote.allocationList
    }
    const { typedData } = await attestAllocateIntent(
      {
        chainId: HUB_CHAIN_ID,
        tokenRegistry,
        account: { user, nonce },
        genesis: bodyGenesis,
        profile: null,
        fund,
        shutdown,
        credit: creditableOf(credit) > 0n ? credit : null,
        puppets: new Map(
          candidates.map(c => [
            c.puppet,
            { mandate: c.registered, withdrawRequestedAt: c.withdrawRequestedAt, available: c.available, allowance: c.allowance, basis: c.basis, allocatedAt: c.allocatedAt }
          ] as const)
        ),
        blocked,
        audit: null,
        priceMark: quote.price.value,
        priceGain: { above: 0n, below: 0n },
        config: DEFAULT_EVALUATION_CONFIG
      },
      intent
    )
    return dispatch(hubClient, HUB_CHAIN_ID, typedData, signature => ({
      kind: 'allocate',
      chainId: HUB_CHAIN_ID,
      input: intent,
      signature
    }))
  }

  async function convert(
    inputToken: Address,
    outputToken: Address,
    inputAmount: bigint,
    destinationChainId: ChainId = chainId
  ): Promise<IDispatchedFrame | null> {
    const routeEndpoint = config.routeEndpoint
    if (!routeEndpoint) {
      throw new Error('convert needs routeEndpoint in the operator config: the origin that proxies the route aggregators (for example https://puppet.fund)')
    }
    const inToken = getAddress(inputToken)
    const outToken = getAddress(outputToken)
    const timing: IAcrossTiming = { ...(await readAcrossBuffers(publicClient, chainId)), fillMargin: Number(PROTOCOL.maxIntentTtlSec) }
    const quote = async (amount: bigint) => {
      const plan = await bestRoutePlan(
        quoteSwapRoutes(
          { lifi: routeEndpoint, kyber: routeEndpoint, across: routeEndpoint },
          account,
          account,
          { chainId, destinationChainId: BigInt(destinationChainId), inputToken: inToken, outputToken: outToken, inputAmount: amount },
          () => Promise.resolve(timing),
          1
        )
      )
      return plan[0]
    }
    const routeTokens = [...new Set([inToken, PROTOCOL.nativeToken, wrappedNativeAddressOf(chainId)].map(token => getAddress(token)))]
    const [gasPrice, inputPerNativeToken, routeBalanceList, nonce, shape] = await Promise.all([
      publicClient.getGasPrice(),
      tokenPerNativeToken(getRate, chainId, inToken, RELAY_RATE_MAX_STALE_MS),
      Promise.all(routeTokens.map(token => fetchTokenBalance(publicClient, token, account))),
      nonceOf(publicClient, account),
      quote(inputAmount)
    ])
    const balances = new Map(routeTokens.map((token, i) => [token, routeBalanceList[i]!] as const))
    if (destinationChainId !== chainId) {
      const open = (await readTransits(terms, account, await pinBlocks(terms))).filter(
        transit => transit.kind === 'fillable' || (transit.kind === 'expired' && transit.owed > 0n)
      )
      if (open.length > 0) {
        throw new CompactError(
          'TRANSIT_OPEN',
          `${account} has a bridge still settling (${open.map(transit => `${transit.kind} ${transit.row.relayHash}`).join(', ')}); a new cross-chain move waits until it fills or is refunded`,
          'soft'
        )
      }
    }
    const fee = computeRelayFee(chainId, 'fundSwap', false, gasPrice, inputPerNativeToken, 0n, 0n, routeCalldataBytes(shape.route))
    if (fee >= inputAmount) throw new Error(`relay fee ${fee} consumes the whole input ${inputAmount}`)
    const leg = await quote(inputAmount - fee)
    const input: IDepositSwapInput = {
      header: { account, user, nonce, deadline: deadline(), feeToken: inToken, fee },
      chainId,
      inputToken: inToken,
      outputToken: leg.outputToken,
      inputAmount,
      outputAmount: leg.outputAmount,
      destinationChainId: BigInt(destinationChainId),
      route: leg.route,
      fillDeadline: leg.fillDeadline
    }
    await screenSwapValue(
      {
        routeKind: input.route.kind,
        chainId,
        inputToken: inToken,
        outputToken: input.outputToken,
        destinationChainId,
        inputAmount,
        outputAmount: input.outputAmount,
        relayFee: fee
      },
      getRate
    )
    const balance = balances.get(inToken)
    if (balance === undefined) throw new Error(`the ${inToken} balance of ${account} was not read`)
    const { intent, typedData } = await attestFundSwapIntent(
      { chainId, tokenRegistry, account: { user, nonce }, genesis: bodyGenesis, balance, timing },
      input
    )
    return dispatch(publicClient, chainId, typedData, signature => ({ kind: 'fundSwap', chainId, input, intent, signature, genesis: bodyGenesis }))
  }

  async function operate(callList: IIAccount__Call[]): Promise<IDispatchedFrame | null> {
    const funded = [...new Set([...allowanceTokensOf(callList), feeToken])]
    const [balanceList, gasPrice, tokenPerNativeTokenRate, nonce] = await Promise.all([
      Promise.all(funded.map(token => readBalance(token))),
      publicClient.getGasPrice(),
      tokenPerNativeToken(getRate, chainId, feeToken, RELAY_RATE_MAX_STALE_MS),
      nonceOf(publicClient, account)
    ])
    const balances = new Map(funded.map((token, i) => [getAddress(token), balanceList[i]!] as const))
    const fee = computeRelayFee(
      chainId,
      'operate',
      false,
      gasPrice,
      tokenPerNativeTokenRate,
      BigInt(callList.length),
      declaredCallGas(callList),
      dynamicCalldataBytes(callList.map(call => call.callData))
    )
    const input: ISpokeGate__OperateIntent = {
      header: { account, user, nonce, deadline: deadline(), feeToken, fee },
      callList,
      tokenList: funded.filter(token => !isAddressEqual(token, feeToken))
    }
    const typedData = await attestOperateIntent(
      { chainId, tokenRegistry, account: { user, nonce }, genesis: bodyGenesis, balances },
      input
    )
    return dispatch(publicClient, chainId, typedData, signature => ({ kind: 'operate', chainId, input, signature, genesis: bodyGenesis }))
  }

  async function redeem(retire: bigint, drain: bigint): Promise<IDispatchedFrame | null> {
    const share = await fundShare()
    const block = await hubClient.getBlockNumber()
    const [quote, fund, funded, gasPrice, tokenPerNativeTokenRate, nonce] = await Promise.all([
      requestValuation(matchmakerUrl, account, share, hubFeeToken),
      readFundState(terms, account, block),
      fetchTokenBalance(hubClient, hubFeeToken, account),
      hubClient.getGasPrice(),
      tokenPerNativeToken(getRate, HUB_CHAIN_ID, hubFeeToken, RELAY_RATE_MAX_STALE_MS),
      nonceOf(hubClient, account)
    ])
    const intent: IFund__RedeemIntent = {
      header: {
        account,
        user,
        nonce,
        deadline: deadline(),
        feeToken: zeroAddress,
        fee: computeRelayFee(HUB_CHAIN_ID, 'redeem', false, gasPrice, tokenPerNativeTokenRate, 0n, 0n, 0n) * USD_PER_BASE
      },
      share,
      valuation: quote.valuation,
      retire,
      drain,
      price: quote.price
    }
    const { typedData } = await attestRedeemIntent(
      {
        chainId: HUB_CHAIN_ID,
        tokenRegistry,
        account: { user, nonce },
        genesis: bodyGenesis,
        fund,
        funded,
        audit: null,
        priceMark: quote.price.value,
        priceGain: { above: 0n, below: 0n },
        config: DEFAULT_EVALUATION_CONFIG
      },
      intent
    )
    return dispatch(hubClient, HUB_CHAIN_ID, typedData, signature => ({
      kind: 'redeem',
      chainId: HUB_CHAIN_ID,
      input: intent,
      signature
    }))
  }

  return { publicClient, account, readBalance, allocate, convert, operate, redeem }
}
