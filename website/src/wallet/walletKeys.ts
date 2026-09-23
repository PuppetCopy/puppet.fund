import { useraccountAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import {
  type IBodySignRequest,
  type IPairedGrant,
  predictUserAccount,
  SESSION_TTL_MS,
  sessionEnvelope,
  sessionTypedData
} from '@puppet/sdk/account'
import {
  createMpcClient,
  fundBindingTypedData,
  fundKeyMaterial,
  fundKeyTypedData,
  type IFundedClaim,
  type IShare
} from '@puppet/sdk/mpc'
import { type Address, getAddress, type Hex, hashTypedData, isAddressEqual } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { readContract } from 'viem/actions'
import { publicKeyToAddress } from 'viem/utils'
import type { IConnectedWallet } from './connectedWallet.js'
import { publicClientMap } from './wallet.js'

export interface IGrant {
  signer: Address
  grant: Hex
  issuedAt: bigint
  expiry: bigint
  epoch: bigint
}

export interface IFund {
  account: Address
  symbol: string
  cells: readonly string[]
}

export interface IFundRecord extends IFund {
  user: Address
  fund: bigint
  share: IShare
}

export interface ISessionSigner {
  signer: Address
  chainId: number
  approve: (digest: Hex) => Promise<Hex>
}

export interface IFundSigner {
  account: Address
  fund: bigint
  sign: (request: IBodySignRequest) => Promise<Hex>
}

export interface IWalletKeys {
  grantedChains: (user: Address) => number[]
  sessionOf: (user: Address, chainId: number) => ISessionSigner | null
  grantSession: (wallet: IConnectedWallet, chainId: number) => Promise<ISessionSigner>
  fundsOf: (user: Address) => IFundRecord[]
  fundSignerOf: (user: Address, account: Address) => IFundSigner | null
  pairingOf: (user: Address, account: Address) => { share: IShare; signerKey: Hex; grants: IPairedGrant[] } | null
  openFund: (wallet: IConnectedWallet, fund: bigint, symbol: string, cells: readonly string[]) => Promise<IFundSigner>
  restoreFund: (wallet: IConnectedWallet, fund: IFund) => Promise<IFundSigner>
}

const signerSlot = (user: Address): string => `puppet:signer:${PROTOCOL.version}:${user.toLowerCase()}`
const grantSlot = (user: Address, chainId: number): string => `puppet:grant:${PROTOCOL.version}:${chainId}:${user.toLowerCase()}`
const GRANT_PREFIX = `puppet:grant:${PROTOCOL.version}:`
const fundSlot = (user: Address, fund: bigint): string => `puppet:fund:${PROTOCOL.version}:${user.toLowerCase()}:${fund}`
const fundPrefix = (user: Address): string => `puppet:fund:${PROTOCOL.version}:${user.toLowerCase()}:`

const readSignerKey = (user: Address): Hex | null => (localStorage.getItem(signerSlot(getAddress(user))) as Hex | null)

const readGrant = (user: Address, chainId: number): IGrant | null => {
  const slot = grantSlot(getAddress(user), chainId)
  const raw = localStorage.getItem(slot)
  if (raw === null) return null
  const cached = JSON.parse(raw) as { signer: Address; grant: Hex; issuedAt: string; expiry: string; epoch: string }
  const expiry = BigInt(cached.expiry)
  if (expiry <= BigInt(Math.floor(Date.now() / 1000))) {
    localStorage.removeItem(slot)
    return null
  }
  return {
    signer: getAddress(cached.signer),
    grant: cached.grant,
    issuedAt: BigInt(cached.issuedAt),
    expiry,
    epoch: BigInt(cached.epoch)
  }
}

const readFund = (raw: string): IFundRecord => {
  const cached = JSON.parse(raw) as {
    user: Address
    fund: string
    symbol: string
    cells: string[]
    account: Address
    share: IShare
  }
  return {
    user: getAddress(cached.user),
    fund: BigInt(cached.fund),
    symbol: cached.symbol,
    cells: cached.cells,
    account: getAddress(cached.account),
    share: cached.share
  }
}

const writeGrant = (user: Address, chainId: number, granted: IGrant): void =>
  localStorage.setItem(
    grantSlot(getAddress(user), chainId),
    JSON.stringify({
      ...granted,
      issuedAt: granted.issuedAt.toString(),
      expiry: granted.expiry.toString(),
      epoch: granted.epoch.toString()
    })
  )

async function readUserEpoch(chainId: number, user: Address): Promise<bigint> {
  const client = publicClientMap[chainId]
  if (client === undefined) throw new Error(`no public client for chain ${chainId}`)
  const account = predictUserAccount(user)
  const code = await client.getCode({ address: account })
  if (code === undefined || code === '0x') return 0n
  return readContract(client, { address: account, abi: useraccountAbi, functionName: 'epoch' })
}

const grantedChainsOf = (user: Address): number[] => {
  const suffix = `:${getAddress(user).toLowerCase()}`
  const chains: number[] = []
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const slot = localStorage.key(i)
    if (slot === null || !slot.startsWith(GRANT_PREFIX) || !slot.endsWith(suffix)) continue
    const chainId = Number(slot.slice(GRANT_PREFIX.length, slot.length - suffix.length))
    if (Number.isInteger(chainId) && readGrant(user, chainId) !== null) chains.push(chainId)
  }
  return chains.sort((a, b) => a - b)
}

export const fundRecordsOf = (user: Address): IFundRecord[] => {
  const prefix = fundPrefix(getAddress(user))
  const found: IFundRecord[] = []
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const slot = localStorage.key(i)
    if (slot === null || !slot.startsWith(prefix)) continue
    found.push(readFund(localStorage.getItem(slot)!))
  }
  return found.sort((a, b) => (a.fund < b.fund ? -1 : a.fund > b.fund ? 1 : 0))
}

export function createWalletKeys(
  mpcUrl: string,
  fundedOf: (user: Address, fundList: readonly Address[]) => Promise<{ chainId: number; token: Address }>
): IWalletKeys {
  const mpc = createMpcClient(mpcUrl)

  const approverOf = (user: Address, chainId: number): ((digest: Hex) => Promise<Hex>) | null => {
    const key = readSignerKey(user)
    const granted = readGrant(user, chainId)
    if (key === null || granted === null) return null
    const account = privateKeyToAccount(key)
    return async digest =>
      sessionEnvelope(granted.signer, granted.issuedAt, granted.expiry, granted.grant, await account.sign({ hash: digest }))
  }

  const carriedApproverOf = async (user: Address, chainId: number): Promise<((digest: Hex) => Promise<Hex>) | null> => {
    const known = approverOf(user, chainId)
    if (known !== null) return known
    const key = readSignerKey(user)
    if (key === null) return null
    const signer = privateKeyToAccount(key).address
    const epoch = await readUserEpoch(chainId, user)
    for (const held of grantedChainsOf(user)) {
      const carried = readGrant(user, held)!
      if (carried.epoch !== epoch || carried.signer !== signer) continue
      if ((await readUserEpoch(held, user)) !== epoch) continue
      writeGrant(user, chainId, carried)
      return approverOf(user, chainId)
    }
    return null
  }

  const claimOf = async (user: Address, sid: Hex): Promise<IFundedClaim> => {
    const funded = await fundedOf(user, fundRecordsOf(user).map(record => record.account))
    const approve = await carriedApproverOf(user, funded.chainId)
    if (approve === null) {
      throw new Error(`${user} has no live session for chain ${funded.chainId} in this browser; sign a session there first`)
    }
    return { ...funded, user, binding: await approve(hashTypedData(fundBindingTypedData(sid))) }
  }

  const sessionSignerOf = (user: Address, chainId: number): ISessionSigner | null => {
    const approve = approverOf(user, chainId)
    const granted = readGrant(user, chainId)
    return approve === null || granted === null ? null : { signer: granted.signer, chainId, approve }
  }

  const fundSignerOfRecord = (record: IFundRecord): IFundSigner => ({
    account: record.account,
    fund: record.fund,
    sign: async request => mpc.sign(record.share, request, await claimOf(record.user, record.share.sid))
  })

  const grantSession = async (wallet: IConnectedWallet, chainId: number): Promise<ISessionSigner> => {
    const user = getAddress(wallet.address)
    if (readSignerKey(user) === null) localStorage.setItem(signerSlot(user), generatePrivateKey())
    const signer = privateKeyToAccount(readSignerKey(user)!).address
    if ((await carriedApproverOf(user, chainId)) === null) {
      const epoch = await readUserEpoch(chainId, user)
      const issuedAt = BigInt(Math.floor(Date.now() / 1000))
      const expiry = issuedAt + BigInt(Math.floor(SESSION_TTL_MS / 1000))
      const grant = await wallet.walletClient.signTypedData({
        account: wallet.address,
        ...sessionTypedData({ user, signer, issuedAt, expiry, epoch })
      })
      writeGrant(user, chainId, { signer, grant, issuedAt, expiry, epoch })
    }
    return sessionSignerOf(user, chainId)!
  }

  const fundSignerOf = (user: Address, account: Address): IFundSigner | null => {
    const record = fundRecordsOf(user).find(row => row.account === getAddress(account))
    return record === undefined ? null : fundSignerOfRecord(record)
  }

  const deriveFund = async (wallet: IConnectedWallet, fund: bigint, symbol: string, cells: readonly string[]): Promise<IFundRecord> => {
    const user = getAddress(wallet.address)
    const session = await grantSession(wallet, HUB_CHAIN_ID)
    const signature = await wallet.walletClient.signTypedData({ account: wallet.address, ...fundKeyTypedData(PROTOCOL.version, fund) })
    const { sid, sk } = fundKeyMaterial(signature)
    const share = await mpc.keygen(sid, sk, { chainId: HUB_CHAIN_ID, user, binding: await session.approve(hashTypedData(fundBindingTypedData(sid))) })
    return { user, fund, symbol, cells: [...cells], account: publicKeyToAddress(share.pk), share }
  }

  const storeFund = (record: IFundRecord): IFundSigner => {
    localStorage.setItem(fundSlot(record.user, record.fund), JSON.stringify({ ...record, fund: record.fund.toString() }))
    return fundSignerOfRecord(record)
  }

  return {
    grantedChains: grantedChainsOf,
    fundsOf: fundRecordsOf,
    sessionOf: sessionSignerOf,
    grantSession,
    pairingOf(user, account) {
      const record = fundRecordsOf(user).find(row => row.account === getAddress(account))
      const key = readSignerKey(user)
      if (record === undefined || key === null) return null
      const grants = grantedChainsOf(user).map(chainId => ({ chainId, ...readGrant(user, chainId)! }))
      return { share: record.share, signerKey: key, grants }
    },
    fundSignerOf,
    async openFund(wallet, fund, symbol, cells) {
      return storeFund(await deriveFund(wallet, fund, symbol, cells))
    },
    async restoreFund(wallet, fund) {
      const held = fundSignerOf(wallet.address, fund.account)
      if (held !== null) return held
      const record = await deriveFund(wallet, 0n, fund.symbol, fund.cells)
      if (!isAddressEqual(record.account, fund.account)) {
        throw new Error(
          `this wallet derives the fund key ${record.account}, not ${fund.account} recorded on chain; the fund was opened by another wallet, or by one whose signatures are not deterministic`
        )
      }
      return storeFund(record)
    }
  }
}
