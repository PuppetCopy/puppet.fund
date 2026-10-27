import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, decodeFunctionData, getAddress, type Hex, isAddressEqual, size, slice, toFunctionSelector, zeroAddress } from 'viem'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'
import { providerGas } from '../../state/fee.js'

const RELAY_QUOTE_PATH = '/quote/v2'
const RELAY_SLIPPAGE_BPS = 50
const RELAY_FEE_MAX_BPS = 100n
const BASIS_POINTS = 10_000n
const RELAY_SOLVER = getAddress('0xf70da97812cb96acdf810712aa562db8dfa3dbef')
const QUOTE_TIMEOUT_MS = 10_000

const RELAY_PROXY_ABI = [
  {
    type: 'function',
    name: 'transferAndMulticall',
    stateMutability: 'payable',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' }
        ]
      },
      { name: 'refundTo', type: 'address' },
      { name: 'nftRecipient', type: 'address' },
      { name: 'metadata', type: 'bytes' }
    ],
    outputs: []
  }
] as const

const RELAY_ROUTER_ABI = [
  {
    type: 'function',
    name: 'cleanupErc20s',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'metadata', type: 'bytes' }
    ],
    outputs: []
  }
] as const

const CLEANUP_ERC20S = toFunctionSelector(RELAY_ROUTER_ABI[0])

const relayCurrency = (token: Address): Address => (isAddressEqual(token, PROTOCOL.nativeToken) ? zeroAddress : getAddress(token))

const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `relay swap route rejected: ${reason}`, 'hard')
}

export function verifyRelaySwap(recipient: Address, callData: Hex, inputToken: Address, inputAmount: bigint, outputToken: Address): void {
  const [tokens, amounts, calls, refundTo, nftRecipient] = (() => {
    try {
      return decodeFunctionData({ abi: RELAY_PROXY_ABI, data: callData }).args
    } catch {
      return fail("calldata is not Relay's transferAndMulticall")
    }
  })()
  const native = isAddressEqual(inputToken, PROTOCOL.nativeToken)
  if (native ? tokens.length !== 0 : tokens.length !== 1 || !isAddressEqual(tokens[0]!, inputToken)) {
    fail(`route pulls ${tokens.join(', ') || 'nothing'} but the intent funds ${inputToken}`)
  }
  const pulled = amounts.reduce((total, amount) => total + amount, 0n)
  if (!native && pulled !== inputAmount) fail(`route pulls ${pulled}, but the intent spends exactly ${inputAmount} on it; re-quote the route and the relay fee together`)
  if (!isAddressEqual(refundTo, recipient)) fail(`route refunds to ${refundTo}, not ${recipient}`)
  if (!isAddressEqual(nftRecipient, recipient) && !isAddressEqual(nftRecipient, zeroAddress)) fail(`route names ${nftRecipient} as its NFT recipient, not ${recipient}`)
  let swept = isAddressEqual(outputToken, PROTOCOL.nativeToken)
  let fee = 0n
  for (const call of calls) {
    if (size(call.callData) < 4 || slice(call.callData, 0, 4) !== CLEANUP_ERC20S) continue
    const [cleaned, recipients, cleanedAmounts] = (() => {
      try {
        return decodeFunctionData({ abi: RELAY_ROUTER_ABI, data: call.callData }).args
      } catch {
        return fail('route carries a sweep the router cannot decode')
      }
    })()
    cleaned.forEach((token, i) => {
      const paid = recipients[i]!
      const amount = cleanedAmounts[i]!
      if (isAddressEqual(paid, recipient)) {
        if (isAddressEqual(token, outputToken) && amount === 0n) swept = true
        return
      }
      if (!isAddressEqual(paid, RELAY_SOLVER)) fail(`route sweeps ${token} to ${paid}, not ${recipient}`)
      if (!isAddressEqual(token, inputToken) || amount === 0n) fail(`route pays Relay's fee as ${amount === 0n ? 'the whole balance' : String(amount)} of ${token}; it is admitted only as an explicit amount of ${inputToken}`)
      fee += amount
    })
  }
  if (!swept) fail(`route never sweeps ${outputToken} to ${recipient}`)
  if (fee * BASIS_POINTS > pulled * RELAY_FEE_MAX_BPS) fail(`route pays Relay ${fee} of ${pulled}, above the ${RELAY_FEE_MAX_BPS} bps cap`)
}

interface IRelayQuoteResponse {
  message?: string
  steps?: { id: string; items?: { data?: { to: Address; data: Hex; value?: string; gas?: string } }[] }[]
  details?: { currencyOut?: { amount: string; minimumAmount: string }; timeEstimate?: number }
}

export async function quoteRelaySwap(
  endpoint: string,
  proxy: Address,
  account: Address,
  recipient: Address,
  bounds: { chainId: ChainId; inputToken: Address; outputToken: Address; inputAmount: bigint },
  signal?: AbortSignal
): Promise<{ route: { kind: 'swap'; provider: Address; providerCallData: Hex; gas: bigint }; outputAmount: bigint; expectedOutputAmount: bigint; tool: string; etaSec: number | undefined }> {
  const res = await fetch(`${endpoint}${RELAY_QUOTE_PATH}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      user: account,
      recipient,
      refundTo: recipient,
      originChainId: bounds.chainId,
      destinationChainId: bounds.chainId,
      originCurrency: relayCurrency(bounds.inputToken),
      destinationCurrency: relayCurrency(bounds.outputToken),
      amount: bounds.inputAmount.toString(),
      tradeType: 'EXACT_INPUT',
      slippageTolerance: String(RELAY_SLIPPAGE_BPS)
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(QUOTE_TIMEOUT_MS)]) : AbortSignal.timeout(QUOTE_TIMEOUT_MS)
  }).catch((err: unknown) => {
    throw new CompactError('ROUTE_UNAVAILABLE', `Relay request failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  const quoted = (await res.json().catch(() => null)) as IRelayQuoteResponse | null
  if (!res.ok || quoted === null) {
    throw new CompactError('ROUTE_UNAVAILABLE', `Relay: ${typeof quoted?.message === 'string' ? quoted.message : `quote unavailable (HTTP ${res.status})`}`)
  }
  const swap = quoted.steps?.find(step => step.id === 'swap')?.items?.[0]?.data
  const out = quoted.details?.currencyOut
  if (swap === undefined || out === undefined) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'Relay returned no same-chain swap step for this pair')
  }
  if (!isAddressEqual(swap.to, proxy)) {
    throw new CompactError('ROUTE_UNAVAILABLE', `Relay routes through ${swap.to}, not the approval proxy ${proxy} pinned for chain ${bounds.chainId}`)
  }
  const attached = isAddressEqual(bounds.inputToken, PROTOCOL.nativeToken) ? bounds.inputAmount : 0n
  const value = BigInt(swap.value ?? '0')
  if (value !== attached) {
    throw new CompactError('ROUTE_UNAVAILABLE', `Relay route asks for ${value} native value but the account attaches ${attached}`)
  }
  verifyRelaySwap(recipient, swap.data, bounds.inputToken, bounds.inputAmount, bounds.outputToken)
  return {
    route: { kind: 'swap', provider: proxy, providerCallData: swap.data, gas: providerGas(swap.gas === undefined ? null : BigInt(swap.gas)) },
    outputAmount: BigInt(out.minimumAmount),
    expectedOutputAmount: BigInt(out.amount),
    tool: 'Relay',
    etaSec: quoted.details?.timeEstimate
  }
}
