import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, decodeFunctionData, getAddress, type Hex, isAddressEqual, parseAbi, toFunctionSelector, zeroAddress } from 'viem'
import { CompactError } from '../../compact/index.js'
import type { ChainId } from '../../const/index.js'

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

const LIFI_FEE_ABI = parseAbi([
  'function forwardERC20Fees(address token, (address recipient, uint256 amount)[] fees)',
  'function forwardNativeFees((address recipient, uint256 amount)[] fees) payable',
  'function collectTokenFees(address tokenAddress, uint256 integratorFee, uint256 lifiFee, address integratorAddress)',
  'function collectNativeFees(uint256 integratorFee, uint256 lifiFee, address integratorAddress) payable'
])

const FEE_SELECTORS = LIFI_FEE_ABI.map(item => toFunctionSelector(item))

const LIFI_FEE_FORWARDER: Partial<Record<ChainId, Address>> = {
  10: '0xCE40449B773a3E6E5e769ADb4e567179d4828cbd',
  137: '0xCE40449B773a3E6E5e769ADb4e567179d4828cbd',
  4663: '0xF4BFFE4dfC693f37715A47c15BdA8af9ed8f7Cf1',
  42161: '0xCE40449B773a3E6E5e769ADb4e567179d4828cbd'
}

const LIFI_FEE_RECIPIENT = getAddress('0xC06ebbefD94032B85424D51906e2A335EFAe264B')
const LIFI_FEE_MAX_BPS = 100n
const BASIS_POINTS = 10_000n

const fail: (reason: string) => never = reason => {
  throw new CompactError('BAD_REQUEST', `lifi swap route rejected: ${reason}`, 'hard')
}

const feePaidBy = (chainId: ChainId, leg: { callTo: Address; callData: Hex }): bigint => {
  const decoded = (() => {
    try {
      return decodeFunctionData({ abi: LIFI_FEE_ABI, data: leg.callData })
    } catch {
      return fail(`route calls a fee function on ${leg.callTo} that does not decode`)
    }
  })()
  if (decoded.functionName === 'collectTokenFees' || decoded.functionName === 'collectNativeFees') {
    return fail(`route pays an integrator fee to ${decoded.args.at(-1)} through LI.FI's fee collector`)
  }
  const forwarder = LIFI_FEE_FORWARDER[chainId]
  if (forwarder === undefined || !isAddressEqual(leg.callTo, forwarder)) {
    return fail(`route forwards fees through ${leg.callTo}, not LI.FI's fee forwarder ${forwarder ?? 'on this chain'}`)
  }
  const fees = decoded.functionName === 'forwardERC20Fees' ? decoded.args[1] : decoded.args[0]
  return fees.reduce((total, fee) => {
    if (!isAddressEqual(fee.recipient, LIFI_FEE_RECIPIENT)) fail(`route pays a fee to ${fee.recipient}, not LI.FI's ${LIFI_FEE_RECIPIENT}`)
    return total + fee.amount
  }, 0n)
}

export function verifyLifiSwap(
  chainId: ChainId,
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
  let fee = 0n
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
        pulledTokens.push(isAddressEqual(leg.sendingAssetId, zeroAddress) ? PROTOCOL.nativeToken : leg.sendingAssetId)
      }
      if (FEE_SELECTORS.some(selector => leg.callData.startsWith(selector))) fee += feePaidBy(chainId, leg)
      delivered = isAddressEqual(leg.receivingAssetId, zeroAddress) ? PROTOCOL.nativeToken : leg.receivingAssetId
    }
  } catch (err) {
    if (err instanceof CompactError) throw err
    fail('calldata does not match a known LI.FI same-chain swap facet')
  }
  if (fee * BASIS_POINTS > pulled * LIFI_FEE_MAX_BPS) fail(`route pays LI.FI ${fee} of ${pulled}, above the ${LIFI_FEE_MAX_BPS} bps cap`)
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
  if (pulled !== inputAmount) {
    fail(`route pulls ${pulled}, but the intent spends exactly ${inputAmount} on it; re-quote the route and the relay fee together`)
  }
}

const LIFI_QUOTE_PATH = '/v1/quote'
const LIFI_SLIPPAGE = 0.005
const QUOTE_TIMEOUT_MS = 10_000

interface ILifiQuoteResponse {
  toolDetails?: { name?: string }
  estimate: { toAmount: string; toAmountMin: string; approvalAddress?: Address; executionDuration?: number }
  transactionRequest: { to: Address; data: Hex; value?: string }
}

export async function quoteLifiSwap(
  endpoint: string,
  diamond: Address,
  account: Address,
  recipient: Address,
  bounds: { chainId: ChainId; inputToken: Address; outputToken: Address; inputAmount: bigint },
  signal?: AbortSignal
): Promise<{ route: { kind: 'swap'; provider: Address; providerCallData: Hex }; outputAmount: bigint; expectedOutputAmount: bigint; tool: string; etaSec: number | undefined }> {
  const query = new URLSearchParams({
    fromChain: String(bounds.chainId),
    toChain: String(bounds.chainId),
    fromToken: getAddress(bounds.inputToken),
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
  const value = BigInt(quote.transactionRequest.value ?? 0)
  const attached = isAddressEqual(bounds.inputToken, PROTOCOL.nativeToken) ? bounds.inputAmount : 0n
  if (value !== attached) {
    throw new CompactError('ROUTE_UNAVAILABLE', `LI.FI route asks for ${value} native value but the account attaches ${attached}`)
  }
  if (!isAddressEqual(quote.transactionRequest.to, diamond)) {
    throw new CompactError('ROUTE_UNAVAILABLE', `LI.FI routes through ${quote.transactionRequest.to}, not the diamond ${diamond} pinned for chain ${bounds.chainId}`)
  }
  if (quote.estimate.approvalAddress && !isAddressEqual(quote.estimate.approvalAddress, diamond)) {
    throw new CompactError('ROUTE_UNAVAILABLE', 'LI.FI approval target differs from the swap router')
  }
  const outputAmount = BigInt(quote.estimate.toAmountMin)
  verifyLifiSwap(
    bounds.chainId,
    recipient,
    quote.transactionRequest.data,
    getAddress(bounds.inputToken),
    bounds.inputAmount,
    bounds.outputToken,
    outputAmount
  )
  return {
    route: { kind: 'swap', provider: diamond, providerCallData: quote.transactionRequest.data },
    outputAmount,
    expectedOutputAmount: BigInt(quote.estimate.toAmount),
    tool: quote.toolDetails?.name ?? 'LI.FI',
    etaSec: quote.estimate.executionDuration
  }
}
