import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, decodeAbiParameters, decodeFunctionData, getAddress, type Hex, isAddressEqual, parseAbi, parseAbiParameters } from 'viem'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'

const KYBER_CHAIN: Partial<Record<ChainId, string>> = {
  10: 'optimism',
  137: 'polygon',
  42161: 'arbitrum'
}

const KYBER_SLIPPAGE_BPS = 50
const QUOTE_TIMEOUT_MS = 10_000

const KYBER_ROUTER_ABI = parseAbi([
  'struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }',
  'function swap(SwapExecutionParams execution) payable returns (uint256, uint256)'
])

const SIMPLE_SWAP_DATA = parseAbiParameters('(address[] firstPools, uint256[] firstSwapAmounts, bytes[] swapDatas, uint256 deadline, bytes destTokenFeeData)')

const PARTIAL_FILL = 0x01n
const REQUIRES_EXTRA_ETH = 0x02n
const SHOULD_CLAIM = 0x04n
const SIMPLE_SWAP = 0x20n

const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `KyberSwap route rejected: ${reason}`, 'hard')
}

export function verifyKyberSwap(recipient: Address, callData: Hex, inputToken: Address, inputAmount: bigint, outputToken: Address, outputAmount: bigint): bigint {
  const { targetData, desc } = (() => {
    try {
      return decodeFunctionData({ abi: KYBER_ROUTER_ABI, data: callData }).args[0]
    } catch {
      return fail("calldata is not KyberSwap's swap")
    }
  })()
  if (!isAddressEqual(desc.srcToken, inputToken)) fail(`route pulls ${desc.srcToken} but the intent funds ${inputToken}`)
  const simple = (desc.flags & SIMPLE_SWAP) !== 0n
  if (isAddressEqual(inputToken, PROTOCOL.nativeToken)) {
    if (simple) fail("route swaps native input in simple mode, which the router refuses")
    if ((desc.flags & PARTIAL_FILL) !== 0n) fail('route may fill partly and refund native input, but the intent spends exactly what it signs')
    if ((desc.flags & REQUIRES_EXTRA_ETH) !== 0n ? desc.amount >= inputAmount : desc.amount !== inputAmount) {
      fail(`route swaps ${desc.amount} of the ${inputAmount} native value the account attaches, which the router refuses`)
    }
  } else {
    if ((desc.flags & REQUIRES_EXTRA_ETH) !== 0n) fail('route asks for native value the account does not attach')
    if ((desc.flags & PARTIAL_FILL) !== 0n && (desc.flags & SHOULD_CLAIM) !== 0n) fail('route may fill partly and refund input, but the intent spends exactly what it signs')
    const pulled = (() => {
      if (!simple) return desc.srcAmounts.reduce((total, amount) => total + amount, 0n)
      try {
        return decodeAbiParameters(SIMPLE_SWAP_DATA, targetData)[0].firstSwapAmounts.reduce((total, amount) => total + amount, 0n)
      } catch {
        return fail('simple-mode route data does not decode')
      }
    })()
    if (desc.amount !== inputAmount || pulled !== inputAmount) {
      fail(`route pulls ${pulled} of a ${desc.amount} budget, but the intent spends exactly ${inputAmount} on it; re-quote the route and the relay fee together`)
    }
  }
  if (!isAddressEqual(desc.dstToken, outputToken)) fail(`route delivers ${desc.dstToken}, not ${outputToken}`)
  if (!isAddressEqual(desc.dstReceiver, recipient)) fail(`route delivers to ${desc.dstReceiver}, not ${recipient}`)
  if (desc.minReturnAmount < outputAmount) fail(`route guarantees ${desc.minReturnAmount}, below the signed ${outputAmount}`)
  if (desc.feeReceivers.length > 0) fail(`route pays fees to ${desc.feeReceivers.join(', ')}`)
  if (desc.permit !== '0x') fail('route carries a permit; the account approves the router directly')
  return desc.minReturnAmount
}

interface IKyberRouteResponse {
  code: number
  message?: string
  data?: { routerAddress: Address; routeSummary: Record<string, unknown> }
}

interface IKyberBuildResponse {
  code: number
  message?: string
  data?: { routerAddress: Address; amountIn: string; amountOut: string; gas: string; transactionValue: string; data: Hex }
}

const kyberPath = (chainId: ChainId): string => {
  const slug = KYBER_CHAIN[chainId]
  if (slug === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap declares no aggregator path for chain ${chainId}`)
  }
  return slug
}

async function kyberJson<T>(url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(QUOTE_TIMEOUT_MS)]) : AbortSignal.timeout(QUOTE_TIMEOUT_MS)
  }).catch((err: unknown) => {
    throw new CompactError(
      'ROUTE_UNAVAILABLE',
      `KyberSwap request failed: ${err instanceof Error ? err.message : String(err)}`
    )
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new CompactError(
      'ROUTE_UNAVAILABLE',
      `KyberSwap: ${typeof body?.message === 'string' ? body.message : `quote unavailable (HTTP ${res.status})`}`
    )
  }
  return (await res.json()) as T
}

export async function quoteKyberSwap(
  endpoint: string,
  router: Address,
  account: Address,
  recipient: Address,
  bounds: { chainId: ChainId; inputToken: Address; outputToken: Address; inputAmount: bigint },
  signal?: AbortSignal
): Promise<{
  route: { kind: 'swap'; provider: Address; providerCallData: Hex }
  outputAmount: bigint
  expectedOutputAmount: bigint
  tool: string
  etaSec: number | undefined
}> {
  const path = kyberPath(bounds.chainId)
  const query = new URLSearchParams({
    tokenIn: getAddress(bounds.inputToken),
    tokenOut: getAddress(bounds.outputToken),
    amountIn: bounds.inputAmount.toString()
  })
  const quoted = await kyberJson<IKyberRouteResponse>(
    `${endpoint}/${path}/api/v1/routes?${query.toString()}`,
    { headers: { accept: 'application/json' } },
    signal
  )
  if (quoted.data === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap returned no route: ${quoted.message ?? `code ${quoted.code}`}`)
  }
  const built = await kyberJson<IKyberBuildResponse>(
    `${endpoint}/${path}/api/v1/route/build`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        routeSummary: quoted.data.routeSummary,
        sender: account,
        recipient,
        slippageTolerance: KYBER_SLIPPAGE_BPS
      })
    },
    signal
  )
  if (built.data === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap could not build the route: ${built.message ?? `code ${built.code}`}`)
  }
  if (!isAddressEqual(built.data.routerAddress, router) || !isAddressEqual(quoted.data.routerAddress, router)) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap routes through ${built.data.routerAddress}, not the router ${router} pinned for chain ${bounds.chainId}`)
  }
  const attached = isAddressEqual(bounds.inputToken, PROTOCOL.nativeToken) ? bounds.inputAmount : 0n
  const value = BigInt(built.data.transactionValue)
  if (value !== attached) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap route asks for ${value} native value but the account attaches ${attached}`)
  }
  return {
    route: { kind: 'swap', provider: router, providerCallData: built.data.data },
    outputAmount: verifyKyberSwap(recipient, built.data.data, bounds.inputToken, bounds.inputAmount, bounds.outputToken, 0n),
    expectedOutputAmount: BigInt(built.data.amountOut),
    tool: 'KyberSwap',
    etaSec: undefined
  }
}
