import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type {
  IAccountLib__AccountInitParams,
  IIAccount__Call,
  IIAccount__SignTransfer,
  IShareLib__ShareInitParams
} from '@puppet/contracts/types'
import { type IPairedSession, predictFundAccount, predictPuppetAccount, symbolForBaseTokenId } from '@puppet/sdk/account'
import { attestOperateIntent, type IOperateInput } from '@puppet/sdk/attestation'
import {
  CompactError,
  createCompact,
  type ICompact,
  type IDispatchedFrame,
  SETTLEMENT_TIMEOUT_MS
} from '@puppet/sdk/compact'
import { DEFAULT_DEADLINE_SEC, HUB_CHAIN, HUB_CHAIN_NETWORK } from '@puppet/sdk/const'
import {
  getAcceptableRelayFee,
  randomNonce,
  relayRouterForKind,
  staticTokenRegistry,
  tokenIdForToken,
  tokenInfoFor,
  tokenRegistryFromRows
} from '@puppet/sdk/state'
import { assertOperateSignable, screenGmxOperate } from '@puppet/sdk/venue'
import {
  type Address,
  createPublicClient,
  erc20Abi,
  getAddress,
  type Hex,
  http,
  isAddressEqual,
  type PublicClient,
  zeroAddress,
  zeroHash
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export interface IOperatorConfig {
  rpcUrl?: string
  dryRun?: boolean
}

export interface IOperatorCore {
  params: IAccountLib__AccountInitParams
  share: IShareLib__ShareInitParams
  user: Address
  signer: Address
  account: Address
  fund: Address
  baseTokenId: Hex
  token: Address
  publicClient: PublicClient
  compact: ICompact
  onStatus: ICompact['onStatus']
  tokenIdFor: (token: Address) => Hex
  readSignedBalance: (tokenId: Hex) => Promise<bigint>
  isOpen: () => boolean
  getFundBalance: () => Promise<bigint>
  getFundSignedBalance: () => Promise<bigint>
  operate: (callList: IIAccount__Call[], transferList?: IIAccount__SignTransfer[]) => Promise<IDispatchedFrame>
  close: () => void
}

export async function createOperatorCore(session: IPairedSession, config: IOperatorConfig = {}): Promise<IOperatorCore> {
  const matchmakerUrl = session.matchmakerUrl
  const rpcUrl = config.rpcUrl ?? HUB_CHAIN.rpcUrls.default.http[0]

  const { params, share } = session
  const baseTokenId = share.baseTokenId

  const sessionSigner = privateKeyToAccount(session.signerKey)
  if (!isAddressEqual(sessionSigner.address, getAddress(params.signer))) {
    throw new Error('paired session is inconsistent: signerKey does not back params.signer')
  }
  const account = predictPuppetAccount(params)
  if (!isAddressEqual(getAddress(share.master), account)) {
    throw new Error('paired session is inconsistent: share.master is not the account these params derive to')
  }
  const fund = predictFundAccount(account)

  const publicClient: PublicClient = createPublicClient({ chain: HUB_CHAIN, transport: http(rpcUrl) })
  const tokenRegistry = session.tokenRegistry ? tokenRegistryFromRows(session.tokenRegistry) : staticTokenRegistry()
  const token = tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token

  const accountCode = await publicClient.getCode({ address: account })
  if (!accountCode || accountCode === '0x') {
    throw new Error(`account ${account} is not deployed — create your account on the site, then restart`)
  }
  const fundCode = await publicClient.getCode({ address: fund })
  if (!fundCode || fundCode === '0x') {
    throw new Error(`fund ${fund} is not created — allocate funds to your account on the site, then restart`)
  }

  const baseBalance = isAddressEqual(getAddress(token), zeroAddress)
    ? await publicClient.getBalance({ address: fund })
    : await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] })
  if (baseBalance === 0n) {
    const others = [...(tokenRegistry.get(HUB_CHAIN_ID)?.values() ?? [])].filter(
      info => info.tokenId !== baseTokenId
    )
    const balances = await Promise.all(
      others.map(info =>
        isAddressEqual(getAddress(info.token), zeroAddress)
          ? publicClient.getBalance({ address: fund })
          : publicClient.readContract({ address: info.token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] })
      )
    )
    const funded = others.find((_, i) => balances[i] > 0n)
    if (funded) {
      const have = symbolForBaseTokenId(funded.tokenId) ?? funded.tokenId
      const want = symbolForBaseTokenId(baseTokenId) ?? baseTokenId
      console.warn(
        `[operator] fund ${fund} holds ${have} but this operator trades ${want} — allocate ${want} to your fund on the site or orders will be skipped`
      )
    }
  }

  const compact = createCompact({ matchmakerUrl })

  function readSignedBalance(tokenId: Hex): Promise<bigint> {
    return publicClient.readContract({
      address: fund,
      abi: PUPPET_CONTRACT_MAP.FundAccount.abi,
      functionName: 'signedBalanceOf',
      args: [tokenId]
    })
  }

  async function operate(
    callList: IIAccount__Call[],
    transferList: IIAccount__SignTransfer[] = [{ tokenId: baseTokenId, token, amountIn: 0n, amountOut: 0n }]
  ): Promise<IDispatchedFrame> {
    const blockNumber = await compact.awaitHead(HUB_CHAIN_NETWORK)
    const signedBalanceByTokenId: Record<Hex, bigint> = {}
    for (const leg of transferList) {
      signedBalanceByTokenId[leg.tokenId] ??= await readSignedBalance(leg.tokenId)
    }
    const gasPrice = await publicClient.getGasPrice()
    const feeToken = transferList[0]?.token ?? token
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
    if (transferList.length === 0) {
      throw new Error('operate needs at least one transfer leg to screen (the default 0/0 base leg satisfies it)')
    }
    const baseTokens = transferList.map(leg => tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, leg.tokenId).token)
    assertOperateSignable(screenGmxOperate({ callList, account: fund, baseTokens }))
    const { intent, typedData } = attestOperateIntent(
      { chainId: HUB_CHAIN_ID, tokenRegistry, currentBlock: blockNumber, signedBalanceByTokenId },
      input
    )
    if (config.dryRun) {
      const leg = transferList[0]
      console.log(
        `[operator] dry-run: operate verified and screened (${callList.length} calls${leg ? `, leg in=${leg.amountIn} out=${leg.amountOut}` : ''}, relayFee<=${acceptableRelayFee}) — not dispatched`
      )
      return {
        chainId: BigInt(HUB_CHAIN_ID),
        account: fund,
        nonce: input.nonce,
        txHash: zeroHash,
        actualRelayFee: 0n
      }
    }
    const signature = await sessionSigner.signTypedData(typedData)
    const ack = await compact.attest({ kind: 'operate', input, intent, signature })
    let mined: Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>
    try {
      mined = await publicClient.waitForTransactionReceipt({ hash: ack.txHash, timeout: SETTLEMENT_TIMEOUT_MS })
    } catch (err) {
      throw new CompactError(
        'SETTLEMENT_TIMEOUT',
        `operate was dispatched (tx ${ack.txHash}) but was not mined in time; verify the transaction before retrying: ${err instanceof Error ? err.message : String(err)}`,
        'server'
      )
    }
    if (mined.status !== 'success') {
      throw new CompactError('DISPATCH_REVERTED', `operate transaction ${ack.txHash} reverted on-chain`, 'server')
    }
    return ack
  }

  return {
    params,
    share,
    user: params.user,
    signer: params.signer,
    account,
    fund,
    baseTokenId,
    token,
    publicClient,
    compact,
    onStatus: compact.onStatus,
    isOpen: () => compact.isOpen(),
    tokenIdFor: (t: Address): Hex => tokenIdForToken(tokenRegistry, HUB_CHAIN_ID, t),
    readSignedBalance,
    getFundBalance: (): Promise<bigint> =>
      isAddressEqual(getAddress(token), zeroAddress)
        ? publicClient.getBalance({ address: fund })
        : publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
    getFundSignedBalance: (): Promise<bigint> => readSignedBalance(baseTokenId),
    operate,
    close: (): void => {
      compact.close()
    }
  }
}
