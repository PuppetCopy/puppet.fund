import { PROTOCOL } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { IIAccount__Call, IIAccount__SignTransfer } from '@puppet/contracts/types'
import { predictRoute } from '@puppet/sdk/account'
import {
  attestFundSwapIntent,
  attestOperateIntent,
  type IFundSwapInput,
  type IOperateInput
} from '@puppet/sdk/attestation'
import { CompactError, type IDispatchedFrame, SETTLEMENT_TIMEOUT_MS } from '@puppet/sdk/compact'
import { CHAIN_MAP, type ChainId, DEFAULT_DEADLINE_SEC } from '@puppet/sdk/const'
import {
  getAcceptableRelayFee,
  NATIVE_PRECISION,
  randomNonce,
  relayDispatch,
  symbolByAddress,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  type Address,
  createPublicClient,
  erc20Abi,
  getAddress,
  type Hex,
  http,
  isAddressEqual,
  type PublicClient
} from 'viem'
import type { IConnector } from './connector.js'

export interface IOperatorConfig {
  chainId: ChainId
  rpcUrl?: string
  getTokenPerNativeToken?: (feeToken: Address) => Promise<bigint>
}

export interface IOperatorSwap {
  inputToken: Address
  outputToken: Address
  fromRoute?: boolean
  inputAmount: bigint
  outputAmount: bigint
  provider: Address
  providerCallData: Hex
  expectedOutputAmount?: bigint
}

export interface IOperator {
  connector: IConnector
  chainId: ChainId
  publicClient: PublicClient
  readSignedBalance: (token: Address) => Promise<bigint>
  readRouteBalance: (token: Address) => Promise<bigint>
  getFundBalance: () => Promise<bigint>
  getFundSignedBalance: () => Promise<bigint>
  operate: (callList: IIAccount__Call[], transferList?: IIAccount__SignTransfer[]) => Promise<IDispatchedFrame | null>
  swap: (input: IOperatorSwap) => Promise<IDispatchedFrame | null>
}

export async function createOperator(connector: IConnector, config: IOperatorConfig): Promise<IOperator> {
  const { compact, tokenRegistry, params, fundParams, account, fund, baseToken, dryRun, sign } = connector
  const { chainId } = config
  const chain = CHAIN_MAP[chainId]
  const rpcUrl = config.rpcUrl ?? chain.rpcUrls.default.http[0]
  const publicClient: PublicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  tokenInfoFor(tokenRegistry, chainId, baseToken)

  const accountCode = await publicClient.getCode({ address: account })
  if (!accountCode || accountCode === '0x') {
    throw new Error(`account ${account} is not deployed: create your account on the site, then restart`)
  }
  const fundCode = await publicClient.getCode({ address: fund })
  if (!fundCode || fundCode === '0x') {
    throw new Error(`fund ${fund} is not created: allocate funds to your account on the site, then restart`)
  }

  const baseBalance = isAddressEqual(baseToken, PROTOCOL.nativeToken)
    ? await publicClient.getBalance({ address: fund })
    : await publicClient.readContract({ address: baseToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] })
  if (baseBalance === 0n) {
    const others = [...(tokenRegistry.get(chainId)?.values() ?? [])].filter(
      info => !isAddressEqual(getAddress(info.token), baseToken)
    )
    const balances = await Promise.all(
      others.map(info =>
        isAddressEqual(getAddress(info.token), PROTOCOL.nativeToken)
          ? publicClient.getBalance({ address: fund })
          : publicClient.readContract({ address: info.token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] })
      )
    )
    const funded = others.find((_, i) => balances[i] > 0n)
    if (funded) {
      const have = symbolByAddress(funded.token)
      const want = symbolByAddress(baseToken)
      console.warn(
        `[operator] fund ${fund} holds ${have} but this operator trades ${want}: allocate ${want} to your fund on the site or orders will be skipped`
      )
    }
  }

  function readSignedBalance(token: Address): Promise<bigint> {
    return publicClient.readContract({
      address: fund,
      abi: DEPLOYMENTS[`FundAccount:${chainId}`].abi,
      functionName: 'signedBalanceOf',
      args: [token]
    })
  }

  async function readRouteBalance(token: Address): Promise<bigint> {
    const route = predictRoute(fund)
    return isAddressEqual(getAddress(token), PROTOCOL.nativeToken)
      ? publicClient.getBalance({ address: route })
      : publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [route] })
  }

  async function feeRate(feeToken: Address): Promise<bigint> {
    if (isAddressEqual(getAddress(feeToken), PROTOCOL.nativeToken)) return NATIVE_PRECISION
    if (config.getTokenPerNativeToken) return config.getTokenPerNativeToken(getAddress(feeToken))
    throw new Error(
      `fee token ${feeToken} needs a price: pass getTokenPerNativeToken in the operator config (the native token is auto-priced)`
    )
  }

  async function settle(kind: string, ack: IDispatchedFrame): Promise<void> {
    let mined: Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>
    try {
      mined = await publicClient.waitForTransactionReceipt({ hash: ack.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
    } catch (err) {
      throw new CompactError(
        'SETTLEMENT_TIMEOUT',
        `${kind} was dispatched (tx ${ack.txHash}) but was not mined in time; verify the transaction before retrying: ${err instanceof Error ? err.message : String(err)}`,
        'server'
      )
    }
    if (mined.status !== 'success') {
      throw new CompactError('DISPATCH_REVERTED', `${kind} transaction ${ack.txHash} reverted on-chain`, 'server')
    }
  }

  async function operate(
    callList: IIAccount__Call[],
    transferList: IIAccount__SignTransfer[] = [{ token: baseToken, amountIn: 0n, amountOut: 0n }]
  ): Promise<IDispatchedFrame | null> {
    if (transferList.length === 0) {
      throw new Error('operate needs at least one transfer leg (the default 0/0 base leg satisfies it)')
    }
    const blockNumber = await publicClient.getBlockNumber()
    const signedBalanceByToken: Record<Address, bigint> = {}
    for (const leg of transferList) {
      signedBalanceByToken[getAddress(leg.token)] ??= await readSignedBalance(getAddress(leg.token))
    }
    const gasPrice = await publicClient.getGasPrice()
    const feeToken = transferList[0]?.token ?? baseToken
    const acceptableRelayFee = getAcceptableRelayFee(
      gasPrice,
      relayDispatch('operate').router,
      'operate',
      await feeRate(feeToken),
      BigInt(callList.length)
    )
    const input: IOperateInput = {
      params,
      blockNumber,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
      acceptableRelayFee,
      nonce: randomNonce(),
      chainId: BigInt(chainId),
      fundParams,
      callList,
      transferList
    }
    const { intent, typedData } = attestOperateIntent(
      { chainId, tokenRegistry, currentBlock: blockNumber, signedBalanceByToken },
      input
    )
    if (dryRun) {
      const leg = transferList[0]
      console.log(
        `[operator] dry-run: operate built (${callList.length} calls${leg ? `, leg in=${leg.amountIn} out=${leg.amountOut}` : ''}, relayFee<=${acceptableRelayFee}), not dispatched`
      )
      return null
    }
    const signature = await sign(typedData)
    const ack = await compact.attest({ kind: 'operate', input, intent, signature })
    await settle('operate', ack)
    return ack
  }

  async function swap(s: IOperatorSwap): Promise<IDispatchedFrame | null> {
    const blockNumber = await publicClient.getBlockNumber()
    const inputToken = tokenInfoFor(tokenRegistry, chainId, s.inputToken).token
    const fromRoute = s.fromRoute ?? false
    const sourceBalance = fromRoute ? await readRouteBalance(inputToken) : await readSignedBalance(s.inputToken)
    const gasPrice = await publicClient.getGasPrice()
    const dispatch = relayDispatch('fundSwap')
    const acceptableRelayFee = getAcceptableRelayFee(gasPrice, dispatch.router, dispatch.method, await feeRate(inputToken), 1n)
    const input: IFundSwapInput = {
      params,
      fundParams,
      inputToken: s.inputToken,
      outputToken: s.outputToken,
      blockNumber,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
      acceptableRelayFee,
      nonce: randomNonce(),
      chainId: BigInt(chainId),
      inputAmount: s.inputAmount,
      outputAmount: s.outputAmount,
      destinationChainId: BigInt(chainId),
      route: { kind: 'swap', provider: s.provider, providerCallData: s.providerCallData },
      fillDeadline: 0,
      fromRoute
    }
    const { intent, typedData } = attestFundSwapIntent(
      { chainId, tokenRegistry, currentBlock: blockNumber, sourceBalance, expectedOutputAmount: s.expectedOutputAmount ?? null },
      input
    )
    if (dryRun) {
      const inSym = symbolByAddress(s.inputToken)
      const outSym = symbolByAddress(s.outputToken)
      console.log(
        `[operator] dry-run: swap ${s.inputAmount} ${inSym} -> >=${s.outputAmount} ${outSym} (relayFee<=${acceptableRelayFee}), not dispatched`
      )
      return null
    }
    const signature = await sign(typedData)
    const ack = await compact.attest({ kind: 'fundSwap', input, intent, signature })
    await settle('fundSwap', ack)
    return ack
  }

  return {
    connector,
    chainId,
    publicClient,
    readSignedBalance,
    readRouteBalance,
    getFundBalance: (): Promise<bigint> =>
      isAddressEqual(baseToken, PROTOCOL.nativeToken)
        ? publicClient.getBalance({ address: fund })
        : publicClient.readContract({ address: baseToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
    getFundSignedBalance: (): Promise<bigint> => readSignedBalance(baseToken),
    operate,
    swap
  }
}
