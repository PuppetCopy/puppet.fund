import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'

const KYBER_CHAIN: Partial<Record<ChainId, string>> = {
  10: 'optimism',
  42161: 'arbitrum'
}

const KYBER_SLIPPAGE_BPS = 50n
const BASIS_POINTS = 10_000n
const QUOTE_TIMEOUT_MS = 10_000

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
    `${endpoint}/api/swap/kyber/${path}/api/v1/routes?${query.toString()}`,
    { headers: { accept: 'application/json' } },
    signal
  )
  if (quoted.data === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap returned no route: ${quoted.message ?? `code ${quoted.code}`}`)
  }
  const built = await kyberJson<IKyberBuildResponse>(
    `${endpoint}/api/swap/kyber/${path}/api/v1/route/build`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        routeSummary: quoted.data.routeSummary,
        sender: account,
        recipient,
        slippageTolerance: Number(KYBER_SLIPPAGE_BPS)
      })
    },
    signal
  )
  if (built.data === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap could not build the route: ${built.message ?? `code ${built.code}`}`)
  }
  const provider = getAddress(built.data.routerAddress)
  if (!isAddressEqual(provider, getAddress(quoted.data.routerAddress))) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'KyberSwap build targets a different router than it quoted')
  }
  const attached = isAddressEqual(bounds.inputToken, PROTOCOL.nativeToken) ? bounds.inputAmount : 0n
  const value = BigInt(built.data.transactionValue)
  if (value !== attached) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap route asks for ${value} native value but the account attaches ${attached}`)
  }
  const pulled = BigInt(built.data.amountIn)
  if (pulled > bounds.inputAmount) {
    throw new CompactError('ROUTE_UNAVAILABLE', `KyberSwap route pulls ${pulled} but only ${bounds.inputAmount} is approved to it`)
  }
  const expectedOutputAmount = BigInt(built.data.amountOut)
  return {
    route: { kind: 'swap', provider, providerCallData: built.data.data },
    outputAmount: (expectedOutputAmount * (BASIS_POINTS - KYBER_SLIPPAGE_BPS)) / BASIS_POINTS,
    expectedOutputAmount,
    tool: 'KyberSwap',
    etaSec: undefined
  }
}
