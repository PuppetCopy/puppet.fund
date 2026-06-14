import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import type { IIAccount__Call, IIAccount__SignTransfer } from '@puppet/contracts/types'
import { type Address, erc20Abi, getAddress, type Hex, isAddressEqual, type PublicClient } from 'viem'
import { predictFundAccount, predictPuppetAccount } from '../account/index.js'
import { attestOperateIntent, type IOperateInput } from '../attestation/index.js'
import type { ICompact } from '../compact/compact.js'
import { ADDRESS_ZERO } from '../const/common.js'
import { DEFAULT_DEADLINE_SEC, HUB_CHAIN_NETWORK } from '../const/index.js'
import { getAcceptableRelayFee, relayRouterForKind } from '../state/fee.js'
import { randomNonce } from '../state/nonce.js'
import { type ITokenRegistryMap, tokenIdForToken, tokenInfoFor } from '../state/tokenRegistry.js'
import { assertOperateSignable, deriveGmxOutflow, screenGmxOperate } from './operate.js'

export interface IPassthroughTransaction {
  to?: string
  data?: string
  value?: string
  gas?: string
}

export interface IPassthroughSigner {
  address: Address
  signTypedData(typedData: ReturnType<typeof attestOperateIntent>['typedData']): Promise<Hex>
}

export interface IPassthroughDeps {
  user: Address
  signer: IPassthroughSigner
  compact: ICompact
  publicClient: PublicClient
  tokenRegistry: ITokenRegistryMap
}

const DEFAULT_CALL_GAS_LIMIT = 2_000_000n

// The smart-wallet passthrough: a dApp's raw transaction becomes the callList of an
// operate intent, screened locally with the matchmaker's own venue screen, leg-accounted
// (declared outflow + surplus recognition), anchored to the relay's indexed head, signed
// by the session key, and relayed. Shared by every client that impersonates the fund
// toward dApps (wallet extension, the website /bridge endpoint).
export async function sendOperatePassthrough(deps: IPassthroughDeps, tx: IPassthroughTransaction): Promise<Hex> {
  const { user, signer, compact, publicClient, tokenRegistry } = deps
  if (!tx.to) throw new Error('eth_sendTransaction requires a target')
  const params = { user, signer: signer.address } as const
  const fund = predictFundAccount(predictPuppetAccount(params))

  // Native value is the GMX execution fee, paid from the fund's own ETH (a registered
  // token, tokenId 0/ADDRESS_ZERO). The screen pins it to a sendWnt -> OrderVault.
  const value = tx.value ? BigInt(tx.value) : 0n
  const callList: IIAccount__Call[] = [
    {
      target: getAddress(tx.to),
      value,
      gasLimit: tx.gas ? BigInt(tx.gas) : DEFAULT_CALL_GAS_LIMIT,
      callData: (tx.data ?? '0x') as Hex
    }
  ]

  // One outflow leg per token the batch moves (collateral via sendTokens, native fee via
  // sendWnt). A standalone approval yields a single zero-amount leg on the approved token.
  const outflows = deriveGmxOutflow(callList)
  const legs = outflows.map(o => {
    const tokenId = tokenIdForToken(tokenRegistry, HUB_CHAIN_ID, o.token)
    return { tokenId, token: tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, tokenId).token, amountOut: o.amountOut }
  })

  assertOperateSignable(screenGmxOperate({ callList, account: fund, baseTokens: legs.map(l => l.token) }))

  // Recognize the fund's surplus on each leg's token: native legs read the account ETH
  // balance, ERC-20 legs read balanceOf. amountIn = balance - signed turns the on-chain
  // post-balance check into a minimum-custody guard for that token.
  const enriched = await Promise.all(
    legs.map(async leg => {
      const isNative = isAddressEqual(getAddress(leg.token), ADDRESS_ZERO)
      const [balance, signed] = await Promise.all([
        isNative
          ? publicClient.getBalance({ address: fund })
          : publicClient.readContract({ address: leg.token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
        publicClient.readContract({
          address: fund,
          abi: PUPPET_CONTRACT_MAP.FundAccount.abi,
          functionName: 'signedBalanceOf',
          args: [leg.tokenId]
        })
      ])
      return { ...leg, signed, amountIn: balance > signed ? balance - signed : 0n }
    })
  )
  const transferList: IIAccount__SignTransfer[] = enriched.map(l => ({
    tokenId: l.tokenId,
    token: l.token,
    amountIn: l.amountIn,
    amountOut: l.amountOut
  }))
  const signedBalanceByTokenId: Record<Hex, bigint> = Object.fromEntries(enriched.map(l => [l.tokenId, l.signed]))
  // The relay quotes its fee against transferList[0].tokenId (handlers.ts signAndQuote), so
  // the signed acceptableRelayFee MUST be denominated in that same token or the off-chain
  // RELAY_FEE_EXCEEDED check compares mismatched units. getTokenPerEth prices native as 1e18.
  const feeToken = enriched[0]?.token ?? tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, TOKEN_ID.WETH).token

  // The intent block anchor MUST be the relay's own indexed head (broadcast on the
  // socket): the live RPC head is ahead of the relay's view and would be rejected.
  const blockNumber = await compact.awaitHead(HUB_CHAIN_NETWORK)
  const gasPrice = await publicClient.getGasPrice()
  const acceptableRelayFee = await getAcceptableRelayFee(
    gasPrice,
    relayRouterForKind('operate'),
    'operate',
    feeToken,
    publicClient,
    BigInt(callList.length)
  )

  const input: IOperateInput = {
    params,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    chainId: BigInt(HUB_CHAIN_ID),
    callList,
    transferList
  }
  const { intent, typedData } = attestOperateIntent(
    { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalanceByTokenId },
    input
  )
  const signature = await signer.signTypedData(typedData)
  const ack = await compact.attest({ kind: 'operate', input, intent, signature })
  return ack.txHash
}
