import { ACROSS_PERIPHERY, decodeAcrossSwapAndBridge } from '@puppet/sdk/attestation'
import { type Address, getAddress, type Hex, isAddressEqual } from 'viem'
import { fetchAcrossBridgeQuote, fetchAcrossJson } from './across.js'
import { fetchLifiSwapQuote } from './lifiSwap.js'
import { providerToken } from './swapCommon.js'
import type { ISwapAttempt, ISwapRequest } from './swapQuote.js'

const SWAP_APPROVAL_PATH = '/api/swap/across/swap/approval'
const EXPIRE_WINDOW_SEC = 60 * 60
const UINT256_MAX = 2n ** 256n - 1n

interface IAcrossSwapApproval {
  minOutputAmount?: string
  expectedFillTime?: number
  swapTx?: { to: Address; data: Hex; value?: string }
}

// Across's fused swap-and-bridge (/swap/approval), WITHDRAW-ONLY: it delivers to the user's WALLET (depositor and
// recipient both pinned to the user), which is exactly what fund-side flows must never do. The co-signer accepts it
// as the 'acrossSwap' route kind after field-pinning the decoded calldata; the same decode runs here so a quote that
// could never attest fails at quote time instead of at Save.
export async function fetchAcrossWithdrawSwapQuote(
  params: {
    originChainId: number
    destinationChainId: number
    inputToken: Address
    outputToken: Address
    inputAmount: bigint
    user: Address
  },
  signal?: AbortSignal
) {
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
      depositor: params.user,
      recipient: params.user,
      slippage: 'auto'
    },
    'Across swap quote unavailable for this route',
    signal
  )
  const swapTx = data.swapTx
  if (!swapTx?.to || !swapTx.data || swapTx.data === '0x') {
    throw new Error('Across swap quote returned no executable transaction')
  }
  if (!isAddressEqual(getAddress(swapTx.to), ACROSS_PERIPHERY)) {
    throw new Error('Across swap transaction does not target the canonical periphery')
  }
  if (BigInt(swapTx.value ?? '0') !== 0n) {
    throw new Error('Across swap route requires native value; not executable from the account')
  }
  const decoded = decodeAcrossSwapAndBridge(swapTx.data)
  if (decoded === null) throw new Error('Across swap calldata does not match the screened shape')
  if (decoded.swapTokenAmount !== params.inputAmount) {
    throw new Error('Across swap calldata amount differs from the quoted input')
  }
  if (decoded.destinationChainId !== BigInt(params.destinationChainId)) {
    throw new Error('Across swap calldata destination differs from the request')
  }
  const outputAmount = BigInt(data.minOutputAmount ?? '0')
  return {
    provider: 'AcrossSwap' as const,
    tool: 'Across',
    route: { kind: 'acrossSwap' as const, providerCallData: swapTx.data },
    txValue: 0n,
    outputAmount,
    etaSec: data.expectedFillTime,
    // The intent must sign the EMBEDDED deposit's fill deadline (the co-signer pins equality); expires is the
    // intent-freshness window, mirroring the plain bridge quote.
    fillDeadline: decoded.fillDeadline,
    expires: nowSec + EXPIRE_WINDOW_SEC,
    isAmountTooLow: outputAmount === 0n,
    limits: { minDeposit: 0n, maxDeposit: UINT256_MAX }
  }
}

export type AcrossWithdrawSwapQuote = Awaited<ReturnType<typeof fetchAcrossWithdrawSwapQuote>>

// Route sources for a WITHDRAW request (`route` carries the user's wallet): local receives quote as a LI.FI swap
// delivered straight to the wallet, cross-chain same-asset as the rebuilt Across bridge, and cross-chain CROSS-asset
// as the field-pinned fused swap above.
export function withdrawSwapQuoteAttempts(p: ISwapRequest, signal?: AbortSignal): ISwapAttempt[] {
  if (p.originChainId === p.destinationChainId) {
    return [
      {
        provider: 'LI.FI',
        quote: fetchLifiSwapQuote({
          chainId: p.originChainId,
          toChainId: p.destinationChainId,
          inputToken: p.inputToken,
          outputToken: p.outputToken,
          inputAmount: p.inputAmount,
          fromAddress: p.route,
          toAddress: p.route,
          signal
        })
      }
    ]
  }
  const fused: ISwapAttempt = {
    provider: 'AcrossSwap',
    quote: fetchAcrossWithdrawSwapQuote(
      {
        originChainId: p.originChainId,
        destinationChainId: p.destinationChainId,
        inputToken: p.inputToken,
        outputToken: p.outputToken,
        inputAmount: p.inputAmount,
        user: p.route
      },
      signal
    )
  }
  if (p.crossToken) return [fused]
  // Same-asset pairs race the plain bridge AND the fused route: the direct lane wins on fees when it exists, but
  // some assets have no lane out of the hub at all (WETH bridges only via a stable intermediate), where only the
  // fused route fills.
  return [
    {
      provider: 'Across',
      quote: fetchAcrossBridgeQuote(
        {
          originChainId: p.originChainId,
          destinationChainId: p.destinationChainId,
          inputToken: p.inputToken,
          outputToken: p.outputToken,
          inputAmount: p.inputAmount,
          recipient: p.route
        },
        signal
      )
    },
    fused
  ]
}
