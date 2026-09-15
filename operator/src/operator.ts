import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { ICoreGate__CreditIntent, ICoreGate__OperateIntent, ICoreGate__SettleIntent, IHubGate__DrawIntent, IIAccount__Call } from '@puppet/contracts/types'
import { accountNonce, intentNonceOf, predictDepositRoute } from '@puppet/sdk/account'
import { CompactError, type IDispatchedFrame, type IDispatchRequest, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import { CHAIN_MAP, type ChainId, DEFAULT_DEADLINE_SEC } from '@puppet/sdk/const'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import {
  attestDepositIntent,
  bestRoutePlan,
  type IAcrossTiming,
  type IDepositInput,
  intentTypedData,
  quoteSwapRoutes,
  readAcrossBuffers,
  routeCalldataBytes
} from '@puppet/sdk/intent'
import {
  chainTokenOfKey,
  computeRelayFee,
  declaredCallGas,
  dynamicCalldataBytes,
  fetchTokenBalance,
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
  type TypedDataDefinition
} from 'viem'
import type { IConnector } from './connector.js'

export interface IOperatorConfig {
  chainId: ChainId
  rpcUrl: string
  hubRpcUrl?: string
  routeEndpoint?: string
  token: Address
  skin: bigint
}

export interface IOperator {
  publicClient: PublicClient
  account: Address
  readBalance: (token: Address) => Promise<bigint>
  credit: (token: Address) => Promise<IDispatchedFrame | null>
  convert: (inputToken: Address, outputToken: Address, inputAmount: bigint) => Promise<IDispatchedFrame | null>
  operate: (callList: IIAccount__Call[], open: boolean) => Promise<IDispatchedFrame | null>
  settle: () => Promise<{ settle: IDispatchedFrame | null; draw: IDispatchedFrame | null }>
}

const deadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC)

async function nonceOf(client: PublicClient, target: Address): Promise<bigint> {
  const code = await client.getCode({ address: target })
  return intentNonceOf(code === undefined || code === '0x' ? null : await accountNonce(client, target))
}

export async function createOperator(connector: IConnector, config: IOperatorConfig): Promise<IOperator> {
  const { compact, tokenRegistry, getRate, user, account, dryRun, signIntent } = connector
  const { chainId, skin } = config
  const token = getAddress(config.token)
  const publicClient: PublicClient = createPublicClient({ chain: CHAIN_MAP[chainId], transport: http(config.rpcUrl) })
  const feeToken = chainTokenOfKey(chainId, VALUE_KEY)
  tokenInfoFor(tokenRegistry, chainId, feeToken)
  tokenInfoFor(tokenRegistry, chainId, token)

  function readBalance(token: Address): Promise<bigint> {
    return isAddressEqual(token, PROTOCOL.nativeToken)
      ? publicClient.getBalance({ address: account })
      : publicClient.readContract({ address: getAddress(token), abi: erc20Abi, functionName: 'balanceOf', args: [account] })
  }

  async function dispatch(
    client: PublicClient,
    typedData: TypedDataDefinition,
    seal: (signature: Hex) => IDispatchRequest
  ): Promise<IDispatchedFrame | null> {
    if (dryRun) {
      console.log(`[operator] dry-run: ${typedData.primaryType} built, not dispatched`)
      return null
    }
    const request = seal(await signIntent(hashTypedData(typedData)))
    const ack = await compact.dispatch(request)
    const mined = await client.waitForTransactionReceipt({ hash: ack.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
    if (mined.status !== 'success') {
      throw new CompactError('DISPATCH_REVERTED', `${request.kind} transaction ${ack.txHash} reverted on-chain`, 'server')
    }
    return ack
  }

  async function credit(token: Address): Promise<IDispatchedFrame | null> {
    const swept = getAddress(token)
    const [gasPrice, tokenPerNativeTokenRate, nonce] = await Promise.all([
      publicClient.getGasPrice(),
      tokenPerNativeToken(getRate, chainId, swept, RELAY_RATE_MAX_STALE_MS),
      nonceOf(publicClient, account)
    ])
    const input: ICoreGate__CreditIntent = {
      header: {
        account,
        user,
        nonce,
        deadline: deadline(),
        feeToken: swept,
        fee: computeRelayFee(chainId, 'credit', false, gasPrice, tokenPerNativeTokenRate, 1n, 0n, 0n)
      },
      creditList: [swept]
    }
    return dispatch(publicClient, intentTypedData('credit', chainId, input), signature => ({
      kind: 'credit',
      chainId,
      input,
      signature
    }))
  }

  async function convert(inputToken: Address, outputToken: Address, inputAmount: bigint): Promise<IDispatchedFrame | null> {
    const routeEndpoint = config.routeEndpoint
    if (!routeEndpoint) {
      throw new Error('convert needs routeEndpoint in the operator config: the origin that proxies the route aggregators (for example https://puppet.fund)')
    }
    const inToken = getAddress(inputToken)
    const outToken = getAddress(outputToken)
    const delivered = inToken
    const timing: IAcrossTiming = { ...(await readAcrossBuffers(publicClient, chainId)), fillMargin: Number(PROTOCOL.maxIntentTtlSec) }
    const quote = async (amount: bigint) => {
      const plan = await bestRoutePlan(
        quoteSwapRoutes(
          { lifi: routeEndpoint, across: routeEndpoint },
          account,
          account,
          { chainId, destinationChainId: BigInt(chainId), inputToken: inToken, outputToken: outToken, inputAmount: amount },
          () => Promise.resolve(timing),
          1
        )
      )
      return plan[0]
    }
    const depositRoute = predictDepositRoute(user)
    const routeTokens = [...new Set([delivered, PROTOCOL.nativeToken, wrappedNativeAddressOf(chainId)].map(token => getAddress(token)))]
    const [gasPrice, tokenPerNativeTokenRate, routeBalanceList, nonce, shape] = await Promise.all([
      publicClient.getGasPrice(),
      tokenPerNativeToken(getRate, chainId, delivered, RELAY_RATE_MAX_STALE_MS),
      Promise.all(routeTokens.map(token => fetchTokenBalance(publicClient, token, depositRoute))),
      nonceOf(publicClient, account),
      quote(inputAmount)
    ])
    const routeBalances = new Map(routeTokens.map((token, i) => [token, routeBalanceList[i]!] as const))
    const fee = computeRelayFee(chainId, 'deposit', false, gasPrice, tokenPerNativeTokenRate, 0n, 0n, routeCalldataBytes(shape.route))
    if (fee >= inputAmount) throw new Error(`relay fee ${fee} consumes the whole input ${inputAmount}`)
    const leg = await quote(inputAmount - fee)
    const input: IDepositInput = {
      header: { account, user, nonce, deadline: deadline(), feeToken: delivered, fee },
      chainId,
      inputToken: inToken,
      outputToken: leg.outputToken,
      inputAmount,
      outputAmount: leg.outputAmount,
      destinationChainId: BigInt(chainId),
      walletPull: 0n,
      route: leg.route,
      fillDeadline: leg.fillDeadline
    }
    const { typedData } = attestDepositIntent(
      { chainId, tokenRegistry, attachedValue: 0n, routeBalances, timing },
      input
    )
    return dispatch(publicClient, typedData, signature => ({ kind: 'deposit', chainId, input, signature, attachedValue: 0n }))
  }

  async function operate(callList: IIAccount__Call[], open: boolean): Promise<IDispatchedFrame | null> {
    const [terms, gasPrice, tokenPerNativeTokenRate, nonce] = await Promise.all([
      compact.operateTerms({ chainId, account, user, token, skin, open }),
      publicClient.getGasPrice(),
      tokenPerNativeToken(getRate, chainId, feeToken, RELAY_RATE_MAX_STALE_MS),
      nonceOf(publicClient, account)
    ])
    const input: ICoreGate__OperateIntent = {
      header: {
        account,
        user,
        nonce,
        deadline: deadline(),
        feeToken,
        fee: computeRelayFee(
          chainId,
          'operate',
          false,
          gasPrice,
          tokenPerNativeTokenRate,
          BigInt(terms.backingList.length),
          declaredCallGas(callList),
          dynamicCalldataBytes(callList.map(call => call.callData))
        )
      },
      creditList: [],
      cycle: terms.cycle,
      token: terms.token,
      value: terms.value,
      collateral: terms.collateral,
      skin: terms.skin,
      backed: terms.backed,
      backingList: terms.backingList,
      callList
    }
    return dispatch(publicClient, intentTypedData('operate', chainId, input), signature => ({ kind: 'operate', chainId, input, signature }))
  }

  async function settle(): Promise<{ settle: IDispatchedFrame | null; draw: IDispatchedFrame | null }> {
    const [terms, gasPrice, tokenPerNativeTokenRate, nonce] = await Promise.all([
      compact.settleTerms({ spokeChainId: chainId, account, user, token }),
      publicClient.getGasPrice(),
      tokenPerNativeToken(getRate, chainId, feeToken, RELAY_RATE_MAX_STALE_MS),
      nonceOf(publicClient, account)
    ])
    const settleInput: ICoreGate__SettleIntent = {
      header: {
        account,
        user,
        nonce,
        deadline: deadline(),
        feeToken,
        fee: computeRelayFee(chainId, 'settle', false, gasPrice, tokenPerNativeTokenRate, BigInt(terms.gainList.length), 0n, 0n)
      },
      cycle: terms.cycle,
      token: terms.token,
      value: terms.value,
      gainList: terms.gainList
    }
    const settled = await dispatch(publicClient, intentTypedData('settle', chainId, settleInput), signature => ({
      kind: 'settle',
      chainId,
      input: settleInput,
      signature
    }))
    if (terms.lossList.length === 0) return { settle: settled, draw: null }
    if (!config.hubRpcUrl) throw new Error('draw needs hubRpcUrl in the operator config: losses draw on the hub chain')
    const hubClient: PublicClient = createPublicClient({ chain: CHAIN_MAP[HUB_CHAIN_ID], transport: http(config.hubRpcUrl) })
    const hubFeeToken = chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY)
    const [hubGasPrice, hubRate, hubNonce] = await Promise.all([
      hubClient.getGasPrice(),
      tokenPerNativeToken(getRate, HUB_CHAIN_ID, hubFeeToken, RELAY_RATE_MAX_STALE_MS),
      nonceOf(hubClient, account)
    ])
    const drawInput: IHubGate__DrawIntent = {
      header: {
        account,
        user,
        nonce: hubNonce,
        deadline: deadline(),
        feeToken: hubFeeToken,
        fee: computeRelayFee(HUB_CHAIN_ID, 'draw', false, hubGasPrice, hubRate, BigInt(terms.lossList.length), 0n, 0n)
      },
      spokeChainId: terms.spokeChainId,
      cycle: terms.cycle,
      lossList: terms.lossList
    }
    const drawn = await dispatch(hubClient, intentTypedData('draw', HUB_CHAIN_ID, drawInput), signature => ({
      kind: 'draw',
      chainId: HUB_CHAIN_ID,
      input: drawInput,
      signature
    }))
    return { settle: settled, draw: drawn }
  }

  return { publicClient, account, readBalance, credit, convert, operate, settle }
}
