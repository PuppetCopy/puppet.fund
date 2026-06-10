import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount } from '@puppet/sdk/account'
import { attestOperateIntent, type IOperateInput } from '@puppet/sdk/attestation'
import { createCompact, type IAttestResult, type ICompact } from '@puppet/sdk/compact'
import { DEFAULT_DEADLINE_SEC, HUB_CHAIN, HUB_CHAIN_NETWORK } from '@puppet/sdk/const'
import {
  createIndexerClient,
  getAcceptableRelayFee,
  getIndexerBlock,
  type IIndexerClient,
  loadTokenRegistry,
  randomNonce,
  relayRouterForKind,
  tokenInfoFor
} from '@puppet/sdk/state'
import { type Address, createPublicClient, erc20Abi, type Hex, http, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type IPairedSession, pairOverBrowser } from './pair.js'

export interface IOperatorConfig {
  baseTokenId: Hex
  matchmakerUrl?: string
  indexerUrl?: string
  rpcUrl?: string
  user?: Address
  signerKey?: Hex
  siteUrl?: string
  pairPort?: number
}

export interface IOperatorCore {
  user: Address
  signer: Address
  account: Address
  fund: Address
  baseTokenId: Hex
  token: Address
  publicClient: PublicClient
  sql: IIndexerClient
  compact: ICompact
  status: ICompact['status']
  isOpen: () => boolean
  getFundBalance: () => Promise<bigint>
  operate: (callList: IIAccount__Call[]) => Promise<IAttestResult>
  close: () => void
}

export async function createOperatorCore(config: IOperatorConfig): Promise<IOperatorCore> {
  if ((config.signerKey == null) !== (config.user == null)) {
    throw new Error('headless mode needs both signerKey and user — set both, or neither to pair over the browser')
  }
  const session: IPairedSession =
    config.signerKey && config.user
      ? { signerKey: config.signerKey, user: config.user, endpoints: {} }
      : await pairOverBrowser(config.siteUrl, config.pairPort)

  const matchmakerUrl = config.matchmakerUrl ?? session.endpoints.matchmakerUrl
  const indexerUrl = config.indexerUrl ?? session.endpoints.indexerUrl
  if (!matchmakerUrl || !indexerUrl) {
    throw new Error('missing endpoint(s) — set matchmakerUrl/indexerUrl, or pair with a site that supplies them')
  }
  const rpcUrl = config.rpcUrl ?? HUB_CHAIN.rpcUrls.default.http[0]

  const sessionSigner = privateKeyToAccount(session.signerKey)
  const sql = createIndexerClient(indexerUrl)
  const publicClient: PublicClient = createPublicClient({ chain: HUB_CHAIN, transport: http(rpcUrl) })
  const tokenRegistry = await loadTokenRegistry(sql)
  const token = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, config.baseTokenId).token
  const params = { user: session.user, signer: sessionSigner.address } as const
  const account = predictPuppetAccount(params)
  const fund = predictFundAccount(account)

  const accountCode = await publicClient.getCode({ address: account })
  if (!accountCode || accountCode === '0x') {
    throw new Error(`account ${account} is not deployed — create your account on the site, then restart`)
  }
  const fundCode = await publicClient.getCode({ address: fund })
  if (!fundCode || fundCode === '0x') {
    throw new Error(`fund ${fund} is not created — allocate funds to your account on the site, then restart`)
  }

  const compact = createCompact({ matchmakerUrl, sql })

  async function operate(callList: IIAccount__Call[]): Promise<IAttestResult> {
    const blockNumber = await getIndexerBlock(sql, HUB_CHAIN_NETWORK)
    const gasPrice = await publicClient.getGasPrice()
    const acceptableRelayFee = await getAcceptableRelayFee(
      gasPrice,
      relayRouterForKind('operate'),
      'operate',
      token,
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
      transferList: [{ tokenId: config.baseTokenId, token, amountIn: 0n, amountOut: 0n }]
    }
    const { intent, typedData } = attestOperateIntent(
      { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalanceByTokenId: {} },
      input
    )
    const signature = await sessionSigner.signTypedData(typedData)
    return compact.attest({ kind: 'operate', input, intent, signature })
  }

  return {
    user: session.user,
    signer: sessionSigner.address,
    account,
    fund,
    baseTokenId: config.baseTokenId,
    token,
    publicClient,
    sql,
    compact,
    status: compact.status,
    isOpen: () => compact.isOpen(),
    getFundBalance: (): Promise<bigint> =>
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
    operate,
    close: (): void => {
      compact.close()
    }
  }
}
