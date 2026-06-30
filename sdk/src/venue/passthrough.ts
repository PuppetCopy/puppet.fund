import { CHAIN_TOKEN_MAP, HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type {
  IFundAccountLib__FundAccountInitParams,
  IIAccount__Call,
  IIAccount__SignTransfer
} from '@puppet/contracts/types'
import { type Address, erc20Abi, getAddress, type Hex, isAddressEqual, type PublicClient } from 'viem'
import { predictFundAccount, predictPuppetAccount } from '../account/index.js'
import { attestOperateIntent, type IOperateInput } from '../attestation/index.js'
import type { ICompact } from '../compact/compact.js'
import { DEFAULT_DEADLINE_SEC } from '../const/index.js'
import { getAcceptableRelayFee, relayDispatch } from '../state/fee.js'
import { randomNonce } from '../state/nonce.js'
import { type ITokenRegistryMap, registeredTokenAddresses, tokenInfoFor } from '../state/tokenRegistry.js'
import { assertOperateSignable, deriveGmxOutflow, screenGmxOperate } from './operate.js'

const FUND_ACCOUNT = DEPLOYMENTS[`FundAccount:${HUB_CHAIN_ID}`]

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
  // The specific fund the passthrough operates. Multi-key CREATE2 derives a fund address
  // from {master, baseToken, name}; the master is this session's puppet account, so the
  // caller threads only the fund's base and name.
  baseToken: Hex
  name: Hex
  compact: ICompact
  publicClient: PublicClient
  tokenRegistry: ITokenRegistryMap
  getTokenPerNativeToken: (token: Address) => Promise<bigint>
}

const DEFAULT_CALL_GAS_LIMIT = 2_000_000n

// The smart-wallet passthrough: a dApp's raw transaction becomes the callList of an
// operate intent, screened locally with the matchmaker's own venue screen, leg-accounted
// (declared outflow + surplus recognition), anchored to the relay's indexed head, signed
// by the session key, and relayed. Shared by every client that impersonates the fund
// toward dApps (wallet extension, the website /bridge endpoint).
export async function sendOperatePassthrough(deps: IPassthroughDeps, tx: IPassthroughTransaction): Promise<Hex> {
  const { user, signer, baseToken, name, compact, publicClient, tokenRegistry, getTokenPerNativeToken } = deps
  if (!tx.to) throw new Error('eth_sendTransaction requires a target')
  const params = { user, signer: signer.address } as const
  const fundParams: IFundAccountLib__FundAccountInitParams = {
    master: predictPuppetAccount(params),
    baseToken,
    name
  }
  const fund = predictFundAccount(fundParams)

  // Native value is the GMX execution fee, paid from the fund's own ETH (a registered
  // token under the native marker). The screen pins it to a sendWnt -> OrderVault.
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
    const token = getAddress(o.token)
    tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, token)
    return { token, amountOut: o.amountOut }
  })

  assertOperateSignable(
    screenGmxOperate({
      callList,
      account: fund,
      baseTokens: legs.map(l => l.token),
      registeredTokens: registeredTokenAddresses(tokenRegistry, HUB_CHAIN_ID)
    })
  )

  // Recognize the fund's surplus on each leg's token: native legs read the account ETH
  // balance, ERC-20 legs read balanceOf. amountIn = balance - signed turns the on-chain
  // post-balance check into a minimum-custody guard for that token.
  const enriched = await Promise.all(
    legs.map(async leg => {
      const isNative = isAddressEqual(getAddress(leg.token), PROTOCOL.nativeToken)
      const [balance, signed] = await Promise.all([
        isNative
          ? publicClient.getBalance({ address: fund })
          : publicClient.readContract({ address: leg.token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
        publicClient.readContract({
          address: fund,
          abi: FUND_ACCOUNT.abi,
          functionName: 'signedBalanceOf',
          args: [getAddress(leg.token)]
        })
      ])
      return { ...leg, signed, amountIn: balance > signed ? balance - signed : 0n }
    })
  )
  const transferList: IIAccount__SignTransfer[] = enriched.map(l => ({
    token: l.token,
    amountIn: l.amountIn,
    amountOut: l.amountOut
  }))
  const signedBalanceByToken: Record<Address, bigint> = Object.fromEntries(enriched.map(l => [getAddress(l.token), l.signed]))
  // The relay quotes its fee against transferList[0].token (handlers.ts signAndQuote), so
  // the signed acceptableRelayFee MUST be denominated in that same token or the off-chain
  // RELAY_FEE_EXCEEDED check compares mismatched units. getTokenPerNativeToken prices native as 1e18.
  const feeToken = enriched[0]?.token ?? getAddress(CHAIN_TOKEN_MAP[HUB_CHAIN_ID].WETH)

  // The intent block anchor is the live RPC head, read from our own client: the relay validates the intent's blockNumber
  // against its own live head (verifyTimeBounds ± maxBlockDelay), so both sides see live heads within tolerance.
  const blockNumber = await publicClient.getBlockNumber()
  const gasPrice = await publicClient.getGasPrice()
  const tokenPerNativeToken = await getTokenPerNativeToken(feeToken)
  const acceptableRelayFee = getAcceptableRelayFee(
    gasPrice,
    relayDispatch('operate').router,
    'operate',
    tokenPerNativeToken,
    BigInt(callList.length)
  )

  const input: IOperateInput = {
    params,
    blockNumber,
    deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
    acceptableRelayFee,
    nonce: randomNonce(),
    chainId: BigInt(HUB_CHAIN_ID),
    fundParams,
    callList,
    transferList
  }
  const { intent, typedData } = attestOperateIntent(
    { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalanceByToken },
    input
  )
  const signature = await signer.signTypedData(typedData)
  const ack = await compact.attest({ kind: 'operate', input, intent, signature })
  return ack.txHash
}
