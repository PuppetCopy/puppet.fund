import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, decodeFunctionData, getAddress, type Hex, isAddressEqual, zeroAddress } from 'viem'
import { CompactError } from '../compact/index.js'
import type { ChainId } from '../const/index.js'
import { providerToken } from '../state/tokenRegistry.js'

const SWAP_DATA_COMPONENTS = [
  { name: 'callTo', type: 'address' },
  { name: 'approveTo', type: 'address' },
  { name: 'sendingAssetId', type: 'address' },
  { name: 'receivingAssetId', type: 'address' },
  { name: 'fromAmount', type: 'uint256' },
  { name: 'callData', type: 'bytes' },
  { name: 'requiresDeposit', type: 'bool' }
] as const

const LIFI_SWAP_ABI = [
  {
    type: 'function',
    name: 'swapTokensGeneric',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmount', type: 'uint256' },
      { name: '_swapData', type: 'tuple[]', components: SWAP_DATA_COMPONENTS }
    ]
  },
  {
    type: 'function',
    name: 'swapTokensSingleV3ERC20ToERC20',
    stateMutability: 'nonpayable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmountOut', type: 'uint256' },
      { name: '_swapData', type: 'tuple', components: SWAP_DATA_COMPONENTS }
    ]
  },
  {
    type: 'function',
    name: 'swapTokensSingleV3ERC20ToNative',
    stateMutability: 'nonpayable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmountOut', type: 'uint256' },
      { name: '_swapData', type: 'tuple', components: SWAP_DATA_COMPONENTS }
    ]
  },
  {
    type: 'function',
    name: 'swapTokensSingleV3NativeToERC20',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmountOut', type: 'uint256' },
      { name: '_swapData', type: 'tuple', components: SWAP_DATA_COMPONENTS }
    ]
  },
  {
    type: 'function',
    name: 'swapTokensMultipleV3ERC20ToERC20',
    stateMutability: 'nonpayable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmountOut', type: 'uint256' },
      { name: '_swapData', type: 'tuple[]', components: SWAP_DATA_COMPONENTS }
    ]
  },
  {
    type: 'function',
    name: 'swapTokensMultipleV3ERC20ToNative',
    stateMutability: 'nonpayable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmountOut', type: 'uint256' },
      { name: '_swapData', type: 'tuple[]', components: SWAP_DATA_COMPONENTS }
    ]
  },
  {
    type: 'function',
    name: 'swapTokensMultipleV3NativeToERC20',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      { name: '_transactionId', type: 'bytes32' },
      { name: '_integrator', type: 'string' },
      { name: '_referrer', type: 'string' },
      { name: '_receiver', type: 'address' },
      { name: '_minAmountOut', type: 'uint256' },
      { name: '_swapData', type: 'tuple[]', components: SWAP_DATA_COMPONENTS }
    ]
  }
] as const

const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `lifi swap route rejected: ${reason}`, 'hard')
}

export function verifyLifiSwap(
  recipient: Address,
  callData: Hex,
  inputToken: Address,
  inputAmount: bigint,
  outputToken: Address,
  outputAmount: bigint
): void {
  let receiver: Address
  let minOut: bigint
  let pulled = 0n
  let delivered: Address | null = null
  const pulledTokens: Address[] = []
  try {
    const { args } = decodeFunctionData({ abi: LIFI_SWAP_ABI, data: callData })
    receiver = args[3]
    minOut = args[4]
    const swapData = Array.isArray(args[5]) ? args[5] : [args[5]]
    for (const leg of swapData) {
      if (leg.requiresDeposit) {
        pulled += leg.fromAmount
        pulledTokens.push(leg.sendingAssetId)
      }
      delivered = isAddressEqual(leg.receivingAssetId, zeroAddress) ? PROTOCOL.nativeToken : leg.receivingAssetId
    }
  } catch {
    fail('calldata does not match a known LI.FI same-chain swap facet')
  }
  for (const token of pulledTokens) {
    if (!isAddressEqual(token, inputToken)) {
      fail(`route pulls ${token} but the intent funds ${inputToken}`)
    }
  }
  if (delivered === null) fail('route carries no swap legs')
  if (!isAddressEqual(delivered, outputToken)) {
    fail(
      `route delivers ${delivered} but the intent signs ${outputToken}; minAmountOut is denominated in the delivered asset and would not bound the signed output`
    )
  }
  if (!isAddressEqual(receiver, recipient)) fail(`swap output recipient ${receiver} is not ${recipient}`)
  if (minOut < outputAmount) {
    fail(`route minAmountOut ${minOut} is below the signed outputAmount ${outputAmount}; the intent floor must be enforceable`)
  }
  if (pulled > inputAmount) {
    fail(
      `route pulls ${pulled} but only ${inputAmount} is approved to it; re-quote the route and the relay fee together`
    )
  }
}

const LIFI_QUOTE_PATH = '/api/swap/lifi/v1/quote'
const LIFI_SLIPPAGE = 0.005
const QUOTE_TIMEOUT_MS = 10_000

interface ILifiQuoteResponse {
  toolDetails?: { name?: string }
  estimate: { toAmount: string; toAmountMin: string; approvalAddress?: Address; executionDuration?: number }
  transactionRequest: { to: Address; data: Hex; value?: string }
}

export async function quoteLifiSwap(
  endpoint: string,
  account: Address,
  recipient: Address,
  bounds: { chainId: ChainId; inputToken: Address; outputToken: Address; inputAmount: bigint },
  signal?: AbortSignal
): Promise<{ route: { kind: 'swap'; provider: Address; providerCallData: Hex }; outputAmount: bigint; expectedOutputAmount: bigint; tool: string; etaSec: number | undefined }> {
  const query = new URLSearchParams({
    fromChain: String(bounds.chainId),
    toChain: String(bounds.chainId),
    fromToken: providerToken(bounds.inputToken, bounds.chainId),
    toToken: getAddress(bounds.outputToken),
    fromAmount: bounds.inputAmount.toString(),
    fromAddress: account,
    toAddress: recipient,
    slippage: String(LIFI_SLIPPAGE)
  })
  const res = await fetch(`${endpoint}${LIFI_QUOTE_PATH}?${query.toString()}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(QUOTE_TIMEOUT_MS)]) : AbortSignal.timeout(QUOTE_TIMEOUT_MS)
  }).catch((err: unknown) => {
    throw new CompactError('ROUTE_UNAVAILABLE', `LI.FI quote request failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new CompactError('ROUTE_UNAVAILABLE', `LI.FI: ${typeof body?.message === 'string' ? body.message : `quote unavailable (HTTP ${res.status})`}`)
  }
  const quote = (await res.json()) as ILifiQuoteResponse
  if (quote.transactionRequest.value !== undefined && BigInt(quote.transactionRequest.value) !== 0n) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'LI.FI route requires native value; not executable from an account')
  }
  const provider = getAddress(quote.transactionRequest.to)
  if (quote.estimate.approvalAddress && !isAddressEqual(quote.estimate.approvalAddress, provider)) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'LI.FI approval target differs from the swap router')
  }
  const outputAmount = BigInt(quote.estimate.toAmountMin)
  verifyLifiSwap(
    recipient,
    quote.transactionRequest.data,
    providerToken(bounds.inputToken, bounds.chainId),
    bounds.inputAmount,
    bounds.outputToken,
    outputAmount
  )
  return {
    route: { kind: 'swap', provider, providerCallData: quote.transactionRequest.data },
    outputAmount,
    expectedOutputAmount: BigInt(quote.estimate.toAmount),
    tool: quote.toolDetails?.name ?? 'LI.FI',
    etaSec: quote.estimate.executionDuration
  }
}
