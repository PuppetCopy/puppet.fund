import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { EMPTY_NAME, predictMasterAccount } from '@puppet/sdk/account'
import {
  attestOperateIntent,
  attestRecognizeBalanceIntent,
  fetchAccountOrThrow,
  type IOperateInput,
  type IRecognizeBalanceInput
} from '@puppet/sdk/attestation'
import { createCompact, type IAttestResult, type ICompact } from '@puppet/sdk/compact'
import { DEFAULT_DEADLINE_SEC, HUB_CHAIN, HUB_CHAIN_NETWORK } from '@puppet/sdk/const'
import {
  createIndexerClient,
  fetchAccountSurplus,
  getAcceptableRelayFee,
  getIndexerBlock,
  type IAccountStateRow,
  type IIndexerClient,
  loadTokenRegistry,
  randomNonce,
  relayRouterForKind,
  tokenInfoFor
} from '@puppet/sdk/state'
import { type Address, createPublicClient, type Hex, http, type PublicClient, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type IPairedSession, pairOverBrowser } from './pair.js'

export interface IOperatorConfig {
  baseTokenId: Hex
  matchmakerUrl?: string
  indexerUrl?: string
  rpcUrl?: string
  user?: Address
  signerKey?: Hex
  name?: string
  siteUrl?: string
  pairPort?: number
}

export interface IOperateAmounts {
  amountIn: bigint
  amountOut: bigint
}

export interface IOperatorCore {
  master: Address
  signer: Address
  params: { readonly user: Address; readonly signer: Address; readonly name: Hex; readonly baseTokenId: Hex }
  token: Address
  publicClient: PublicClient
  sql: IIndexerClient
  compact: ICompact
  status: ICompact['status']
  isOpen: () => boolean
  getAccountState: () => Promise<IAccountStateRow>
  operate: (callList: IIAccount__Call[], amounts: IOperateAmounts) => Promise<IAttestResult>
  recordReturnedBalance: (amount?: bigint) => Promise<IAttestResult | null>
  getUnrecognizedBalance: () => Promise<bigint>
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
  const rpcUrl = config.rpcUrl ?? session.endpoints.rpcUrl
  if (!matchmakerUrl || !indexerUrl || !rpcUrl) {
    throw new Error('missing endpoint(s) — set matchmakerUrl/indexerUrl/rpcUrl, or pair with a site that supplies them')
  }

  const account = privateKeyToAccount(session.signerKey)
  const sql = createIndexerClient(indexerUrl)
  const publicClient: PublicClient = createPublicClient({ chain: HUB_CHAIN, transport: http(rpcUrl) })
  const tokenRegistry = await loadTokenRegistry(sql)
  const token = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, config.baseTokenId).token
  const name = config.name ? toHex(config.name, { size: 32 }) : EMPTY_NAME
  const params = { user: session.user, signer: account.address, name, baseTokenId: config.baseTokenId } as const
  const master = predictMasterAccount(params)

  const code = await publicClient.getCode({ address: master })
  if (!code || code === '0x') {
    throw new Error(`master ${master} is not deployed — create and fund the account on the site, then restart`)
  }

  const compact = createCompact({ matchmakerUrl, sql })

  async function operate(callList: IIAccount__Call[], amounts: IOperateAmounts): Promise<IAttestResult> {
    const blockNumber = await getIndexerBlock(sql, HUB_CHAIN_NETWORK)
    const row = await fetchAccountOrThrow(sql, master, HUB_CHAIN_ID)
    const gasPrice = await publicClient.getGasPrice()
    const acceptableRelayFee = await getAcceptableRelayFee(
      gasPrice,
      relayRouterForKind('operate'),
      'operate',
      token,
      publicClient
    )
    const input: IOperateInput = {
      params,
      blockNumber,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
      acceptableRelayFee,
      nonce: randomNonce(),
      chainId: BigInt(HUB_CHAIN_ID),
      callList,
      amountIn: amounts.amountIn,
      amountOut: amounts.amountOut
    }
    const { intent, typedData } = attestOperateIntent(
      { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalance: row.signedBalance },
      input
    )
    const signature = await account.signTypedData(typedData)
    return compact.attest({ kind: 'operate', input, intent, signature })
  }

  async function recordReturnedBalance(amount?: bigint): Promise<IAttestResult | null> {
    const surplus = amount ?? (await fetchAccountSurplus(sql, BigInt(HUB_CHAIN_ID), master))
    if (surplus <= 0n) return null
    const blockNumber = await getIndexerBlock(sql, HUB_CHAIN_NETWORK)
    const row = await fetchAccountOrThrow(sql, master, HUB_CHAIN_ID)
    const gasPrice = await publicClient.getGasPrice()
    const acceptableRelayFee = await getAcceptableRelayFee(
      gasPrice,
      relayRouterForKind('recognize'),
      'recognize',
      token,
      publicClient
    )
    const input: IRecognizeBalanceInput = {
      params,
      blockNumber,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC),
      acceptableRelayFee,
      nonce: randomNonce(),
      chainId: BigInt(HUB_CHAIN_ID),
      isMaster: true,
      fromTransientRoute: false,
      amount: surplus
    }
    const { intent, typedData } = attestRecognizeBalanceIntent(
      { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalance: row.signedBalance },
      input
    )
    const signature = await account.signTypedData(typedData)
    return compact.attest({ kind: 'recognize', input, intent, signature })
  }

  return {
    master,
    signer: account.address,
    params,
    token,
    publicClient,
    sql,
    compact,
    status: compact.status,
    isOpen: () => compact.isOpen(),
    getAccountState: () => fetchAccountOrThrow(sql, master, HUB_CHAIN_ID),
    operate,
    recordReturnedBalance,
    getUnrecognizedBalance: (): Promise<bigint> => fetchAccountSurplus(sql, BigInt(HUB_CHAIN_ID), master),
    close: (): void => {
      compact.close()
    }
  }
}
