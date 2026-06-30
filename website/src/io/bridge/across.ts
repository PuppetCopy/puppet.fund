import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { PROTOCOL } from '@puppet/contracts/const'
import { type ChainId } from '@puppet/sdk/const'
import { wrappedNativeAddressOf } from '@puppet/sdk/state'

// Across resolves tokens by ERC20 address; the EIP-7528 native sentinel has no tokenDetails (the API 404s on it), so a
// native leg is quoted as its wrapped-native ERC20. The route is WETH-funded and the gate forwards value:0, so the
// wrapped form is also what runs on-chain.
const providerToken = (token: Address, chainId: number): Address =>
  isAddressEqual(token, PROTOCOL.nativeToken) ? wrappedNativeAddressOf(chainId as ChainId) : token

const SUGGESTED_FEES_PATH = '/api/swap/across/suggested-fees'
const SWAP_APPROVAL_PATH = '/api/swap/across/swap/approval'
const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
const FILL_WINDOW_SEC = 30 * 60
const EXPIRE_WINDOW_SEC = 60 * 60

interface IAcrossBridgeQuoteParams {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  recipient: Address
}

interface IAcrossSuggestedFees {
  timestamp: string
  exclusiveRelayer: Address
  exclusivityDeadline: number
  isAmountTooLow: boolean
  outputAmount: string
  limits: { minDeposit: string; maxDeposit: string }
}

async function fetchAcrossJson<T>(path: string, params: Record<string, string>, errorLabel: string): Promise<T> {
  const res = await fetch(`${window.location.origin}${path}?${new URLSearchParams(params).toString()}`, {
    signal: AbortSignal.timeout(10_000)
  }).catch(() => {
    throw new Error(errorLabel)
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(typeof body?.message === 'string' ? body.message : errorLabel)
  }
  return (await res.json().catch(() => {
    throw new Error(errorLabel)
  })) as T
}

export async function fetchAcrossBridgeQuote(params: IAcrossBridgeQuoteParams) {
  const nowSec = Math.floor(Date.now() / 1000)
  const data = await fetchAcrossJson<IAcrossSuggestedFees>(
    SUGGESTED_FEES_PATH,
    {
      amount: params.inputAmount.toString(),
      inputToken: providerToken(params.inputToken, params.originChainId),
      outputToken: providerToken(params.outputToken, params.destinationChainId),
      originChainId: String(params.originChainId),
      destinationChainId: String(params.destinationChainId),
      recipient: params.recipient
    },
    'Across quote unavailable for this route'
  )
  const outputAmount = BigInt(data.outputAmount)
  return {
    provider: 'Across' as const,
    route: {
      kind: 'across' as const,
      exclusiveRelayer: data.exclusiveRelayer,
      quoteTimestamp: Number(data.timestamp),
      exclusivityParameter: data.exclusivityDeadline
    },
    outputAmount,
    fillDeadline: nowSec + FILL_WINDOW_SEC,
    expires: nowSec + EXPIRE_WINDOW_SEC,
    isAmountTooLow: data.isAmountTooLow || outputAmount === 0n,
    limits: { minDeposit: BigInt(data.limits.minDeposit), maxDeposit: BigInt(data.limits.maxDeposit) }
  }
}

export type AcrossBridgeQuote = Awaited<ReturnType<typeof fetchAcrossBridgeQuote>>
export type AcrossSwapQuote = Awaited<ReturnType<typeof fetchAcrossSwapQuote>>

// Across's CROSS-CHAIN SWAP endpoint (/api/swap/approval), as opposed to /suggested-fees which only bridges the SAME
// asset. It returns a finished origin-chain tx, so the quote slots into the generic { kind: 'swap', provider,
// providerCallData } route exactly like LI.FI — the fund executes approve(provider, amount) + call(provider, data), and
// the swap+bridge delivers the destination asset to `recipient` on the hub. depositor/recipient are the SAME route
// address LI.FI is quoted against, so on-chain execution is identical to the proven LI.FI cross-token path.
// NOTE: the response field names below follow Across's documented swap-API shape; verify against a live call. Any shape
// mismatch throws, which is fail-safe (fetchSwapQuote drops it via allSettled and LI.FI wins, today's behavior).
interface IAcrossSwapApproval {
  minOutputAmount?: string
  expectedOutputAmount?: string
  approvalTxns?: Array<{ to: Address; data: Hex }>
  swapTx?: { to: Address; data: Hex; value?: string }
}

const decodeApproveSpender = (data: Hex): Address | null => {
  if (data.slice(0, 10).toLowerCase() !== ERC20_APPROVE_SELECTOR || data.length < 74) return null
  try {
    return getAddress(`0x${data.slice(34, 74)}`)
  } catch {
    return null
  }
}

export async function fetchAcrossSwapQuote(params: {
  originChainId: number
  destinationChainId: number
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  depositor: Address
  recipient: Address
  slippage?: number | 'auto'
}) {
  const nowSec = Math.floor(Date.now() / 1000)
  const data = await fetchAcrossJson<IAcrossSwapApproval>(
    SWAP_APPROVAL_PATH,
    {
      tradeType: 'exactInput',
      amount: params.inputAmount.toString(),
      inputToken: providerToken(params.inputToken, params.originChainId),
      outputToken: providerToken(params.outputToken, params.destinationChainId),
      originChainId: String(params.originChainId),
      destinationChainId: String(params.destinationChainId),
      depositor: params.depositor,
      recipient: params.recipient,
      slippage: String(params.slippage ?? 'auto')
    },
    'Across swap quote unavailable for this route'
  )
  const swapTx = data.swapTx
  if (!swapTx?.to || !swapTx.data || swapTx.data === '0x') {
    throw new Error('Across swap quote returned no executable transaction')
  }
  const provider = getAddress(swapTx.to)
  // The fund approves the call target then calls it; a swap whose ERC20 approval spender differs from that target would
  // not be funded, so fail closed at quote time (mirrors the LI.FI approvalAddress === router guard).
  const approval = data.approvalTxns?.find(t => decodeApproveSpender(t.data) !== null)
  if (approval && decodeApproveSpender(approval.data) !== provider) {
    throw new Error('Across swap approval target differs from the swap router')
  }
  // The fund/route is funded in WETH and the gate calls the swap provider with value:0 (it never forwards native ETH),
  // so a quote whose tx needs native msg.value is structurally un-executable — it would sign a doomed intent that
  // reverts on-chain with `balance=0, required=<value>`. Fail closed at quote time; fetchSwapQuote then drops this via
  // allSettled and an executable route (the Across bridge, or a value:0 quote) wins.
  const txValue = BigInt(swapTx.value ?? '0')
  if (txValue !== 0n) {
    throw new Error('Across swap route requires native ETH value; not executable from a WETH-funded route')
  }
  const outputAmount = BigInt(data.minOutputAmount ?? '0')
  return {
    provider: 'Across' as const,
    route: { kind: 'swap' as const, provider, providerCallData: swapTx.data },
    txValue,
    tool: 'Across',
    outputAmount,
    fillDeadline: nowSec + FILL_WINDOW_SEC,
    expires: nowSec + EXPIRE_WINDOW_SEC,
    isAmountTooLow: outputAmount === 0n,
    limits: { minDeposit: 0n, maxDeposit: 2n ** 256n - 1n }
  }
}
