import { useraccountAbi } from '@puppet/contracts/abi'
import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { type Address, getAddress, type Hex, hashTypedData, isAddressEqual, isHex, type PublicClient, slice, zeroAddress } from 'viem'
import { readContract } from 'viem/actions'
import { publicKeyToAddress } from 'viem/utils'
import {
  fundApproval,
  type IBodySignRequest,
  predictUserAccount,
  SESSION_TTL_MS,
  sessionEnvelope,
  sessionTypedData
} from '../account/index.js'
import { CompactError } from '../compact/index.js'
import { DEFAULT_DEADLINE_SEC } from '../const/index.js'
import { recoverAccountSigner } from '../intent/approval.js'
import {
  createMpcClient,
  fundBindingTypedData,
  fundKeyMaterial,
  fundKeyTypedData,
  type IBindingClaim,
  type IKeygenClaim,
  type IShare
} from '../mpc/index.js'
import type { IConnectedWallet } from './connectedWallet.js'

const DEPOSIT_RECORD_TRIES = 6
const DEPOSIT_RECORD_WAIT_MS = 2_500

export type IKeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export type ISessionKeyAsk = { op: 'mint' } | { op: 'sign'; sealed: Hex; digest: Hex }
export type ISessionKeyRequest = ISessionKeyAsk & { id: number }
export type ISessionKeyReply = { id: number; value: Hex } | { id: number; error: string } | { id: number; lost: string }

export interface IGrant {
  signer: Address
  grant: Hex
  issuedAt: bigint
  expiry: bigint
  epoch: bigint
  fund: Address
}

export interface IFund {
  account: Address
  fund: bigint
  symbol: string
  cells: readonly string[]
}

export interface IFundRecord extends IFund {
  user: Address
  share: IShare
}

export interface ISessionSigner {
  signer: Address
  chainId: number
  expiry: bigint
  approve: (digest: Hex) => Promise<Hex>
}

export interface IFundSigner {
  account: Address
  fund: bigint
  sign: (request: IBodySignRequest) => Promise<Hex>
  submit: (request: IBodySignRequest) => Promise<Hex>
}

export interface IWalletKeys {
  grantedChains: (user: Address) => number[]
  sessionOf: (user: Address, chainId: number) => ISessionSigner | null
  carriedSessionOf: (user: Address, chainId: number) => Promise<ISessionSigner | null>
  forgetSessions: (user: Address, chainId: number) => Promise<void>
  grantSession: (wallet: IConnectedWallet, chainId: number) => Promise<ISessionSigner>
  signerOf: (user: Address) => Promise<Address>
  fundApprovalOf: (user: Address, account: Address) => Hex | null
  approveFund: (wallet: IConnectedWallet, chainId: number, account: Address) => Promise<Hex>
  fundsOf: (user: Address) => IFundRecord[]
  selectFund: (user: Address, account: Address) => void
  fundSignerOf: (user: Address, account: Address) => IFundSigner | null
  fundKeySigned: (user: Address, fund: bigint) => boolean
  openFund: (
    wallet: IConnectedWallet,
    fund: bigint,
    symbol: string,
    cells: readonly string[],
    funded: { chainId: number; token: Address },
    funding: Hex | null
  ) => Promise<IFundSigner>
  restoreFund: (wallet: IConnectedWallet, fund: IFund) => Promise<IFundSigner>
}

export const FUND_SLOT_PREFIX = 'puppet:fund:'
export const APPROVAL_SLOT_PREFIX = 'puppet:approval:'
export const SESSION_SLOT_PREFIX = 'puppet:session:'
const fundSlot = (user: Address, fund: bigint): string => `${FUND_SLOT_PREFIX}${PROTOCOL.version}:${user.toLowerCase()}:${fund}`
const approvalSlot = (user: Address, account: Address): string => `${APPROVAL_SLOT_PREFIX}${PROTOCOL.version}:${user.toLowerCase()}:${account.toLowerCase()}`
const fundPrefix = (user: Address): string => `${FUND_SLOT_PREFIX}${PROTOCOL.version}:${user.toLowerCase()}:`
const selectedSlot = (user: Address): string => `puppet:selected-fund:${PROTOCOL.version}:${user.toLowerCase()}`
const keySlot = (user: Address): string => `${SESSION_SLOT_PREFIX}${PROTOCOL.version}:${user.toLowerCase()}`
const sessionSlot = (user: Address, chainId: number): string => `${keySlot(user)}:${chainId}`

export const selectedFundOf = (storage: IKeyStore, user: Address): Address | null => {
  const held = storage.getItem(selectedSlot(getAddress(user)))
  return held === null ? null : getAddress(held)
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

async function readUserEpoch(clients: Readonly<Record<number, PublicClient>>, chainId: number, user: Address): Promise<bigint> {
  const client = clients[chainId]
  if (client === undefined) throw new Error(`no public client for chain ${chainId}`)
  const account = predictUserAccount(user)
  const code = await client.getCode({ address: account })
  if (code === undefined || code === '0x') return 0n
  return readContract(client, { address: account, abi: useraccountAbi, functionName: 'epoch' })
}

export const fundRecordsOf = (storage: IKeyStore, user: Address): IFundRecord[] => {
  const prefix = fundPrefix(getAddress(user))
  const found: IFundRecord[] = []
  for (let i = storage.length - 1; i >= 0; i--) {
    const slot = storage.key(i)
    if (slot === null || !slot.startsWith(prefix)) continue
    found.push(readFund(storage.getItem(slot)!))
  }
  return found.sort((a, b) => (a.fund < b.fund ? -1 : a.fund > b.fund ? 1 : 0))
}

export function createWalletKeys(
  storage: IKeyStore,
  clients: Readonly<Record<number, PublicClient>>,
  mpcUrl: string,
  keyWorker: Pick<Worker, 'postMessage' | 'addEventListener'>
): IWalletKeys {
  const mpc = createMpcClient(mpcUrl)
  const asked = new Map<number, { resolve: (value: Hex) => void; reject: (error: Error) => void }>()
  let nextAsk = 0

  keyWorker.addEventListener('message', (event: MessageEvent<ISessionKeyReply>) => {
    const reply = event.data
    const waiter = asked.get(reply.id)
    if (waiter === undefined) return
    asked.delete(reply.id)
    if ('value' in reply) waiter.resolve(reply.value)
    else waiter.reject('lost' in reply ? new CompactError('SESSION_KEY_LOST', reply.lost, 'hard') : new Error(reply.error))
  })
  keyWorker.addEventListener('error', (event: ErrorEvent) => {
    for (const waiter of asked.values()) waiter.reject(new Error(`the session key worker failed: ${event.message}`))
    asked.clear()
  })

  const askKey = (ask: ISessionKeyAsk): Promise<Hex> =>
    new Promise((resolve, reject) => {
      const id = nextAsk++
      asked.set(id, { resolve, reject })
      keyWorker.postMessage({ ...ask, id })
    })

  const signAs = (user: Address, sealed: Hex, digest: Hex): Promise<Hex> =>
    askKey({ op: 'sign', sealed, digest }).catch((error: unknown) => {
      if (error instanceof CompactError && error.code === 'SESSION_KEY_LOST' && storage.getItem(keySlot(user)) === sealed) storage.removeItem(keySlot(user))
      throw error
    })

  const signerOf = async (user: Address): Promise<Address> => {
    const held = storage.getItem(keySlot(user)) as Hex | null
    const sealed = held ?? (await askKey({ op: 'mint' }))
    if (held === null) storage.setItem(keySlot(user), sealed)
    return getAddress(slice(sealed, 0, 20))
  }

  const grantOf = (user: Address, chainId: number): IGrant | null => {
    const sealed = storage.getItem(keySlot(user)) as Hex | null
    const held = storage.getItem(sessionSlot(user, chainId))
    if (sealed === null || held === null) return null
    const stored = JSON.parse(held) as { signer: Address; grant: Hex; issuedAt: string; expiry: string; epoch: string; fund: Address }
    const granted = { ...stored, issuedAt: BigInt(stored.issuedAt), expiry: BigInt(stored.expiry), epoch: BigInt(stored.epoch) }
    return granted.expiry <= BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC) || !isAddressEqual(granted.signer, slice(sealed, 0, 20)) ? null : granted
  }

  const grantedChains = (user: Address): number[] => Object.keys(clients).map(Number).filter(chainId => grantOf(user, chainId) !== null)

  const approverOf = (user: Address, chainId: number): ((digest: Hex) => Promise<Hex>) | null => {
    const granted = grantOf(user, chainId)
    const sealed = storage.getItem(keySlot(user)) as Hex | null
    if (granted === null || sealed === null) return null
    return async digest =>
      sessionEnvelope(granted.signer, granted.issuedAt, granted.expiry, granted.epoch, granted.fund, granted.grant, await signAs(user, sealed, digest))
  }

  const carriedApproverOf = async (user: Address, chainId: number): Promise<((digest: Hex) => Promise<Hex>) | null> => {
    const known = approverOf(user, chainId)
    if (known !== null) return known
    const held = grantedChains(user)
    if (held.length === 0) return null
    const epoch = await readUserEpoch(clients, chainId, user)
    for (const from of held) {
      const carried = grantOf(user, from)
      if (carried === null || carried.epoch !== epoch || (await readUserEpoch(clients, from, user)) !== epoch) continue
      storage.setItem(sessionSlot(user, chainId), storage.getItem(sessionSlot(user, from))!)
      return approverOf(user, chainId)
    }
    return null
  }

  const claimOf = async (user: Address, sid: Hex): Promise<IBindingClaim> => {
    const approve = await carriedApproverOf(user, HUB_CHAIN_ID)
    if (approve === null) {
      throw new Error(`${user} has no live session for chain ${HUB_CHAIN_ID} in this browser; sign a session there first`)
    }
    return { chainId: HUB_CHAIN_ID, user, binding: await approve(hashTypedData(fundBindingTypedData(sid))) }
  }

  const sessionSignerOf = (user: Address, chainId: number): ISessionSigner | null => {
    const approve = approverOf(user, chainId)
    const granted = grantOf(user, chainId)
    return approve === null || granted === null ? null : { signer: granted.signer, chainId, expiry: granted.expiry, approve }
  }

  const forgetSessions = async (user: Address, chainId: number): Promise<void> => {
    storage.removeItem(sessionSlot(user, chainId))
    if (grantedChains(user).length === 0) storage.removeItem(keySlot(user))
  }

  const carriedSessionOf = async (user: Address, chainId: number): Promise<ISessionSigner | null> =>
    (await carriedApproverOf(getAddress(user), chainId)) === null ? null : sessionSignerOf(getAddress(user), chainId)

  const fundSignerOfRecord = (record: IFundRecord): IFundSigner => ({
    account: record.account,
    fund: record.fund,
    sign: async request => mpc.sign(record.share, request, await claimOf(record.user, record.share.sid), false),
    submit: async request => mpc.sign(record.share, request, await claimOf(record.user, record.share.sid), true)
  })

  const signGrant = async (wallet: IConnectedWallet, chainId: number, fund: Address): Promise<IGrant> => {
    const user = getAddress(wallet.address)
    if (grantedChains(user).length === 0) storage.removeItem(keySlot(user))
    const signer = await signerOf(user)
    const epoch = await readUserEpoch(clients, chainId, user)
    const issuedAt = BigInt(Math.floor(Date.now() / 1000))
    const expiry = issuedAt + BigInt(Math.floor(SESSION_TTL_MS / 1000))
    const grant = await wallet.walletClient.signTypedData(sessionTypedData({ user, signer, issuedAt, expiry, epoch, fund }))
    storage.setItem(sessionSlot(user, chainId), JSON.stringify({ signer, grant, issuedAt: issuedAt.toString(), expiry: expiry.toString(), epoch: epoch.toString(), fund }))
    return { signer, grant, issuedAt, expiry, epoch, fund }
  }

  const grantSession = async (wallet: IConnectedWallet, chainId: number): Promise<ISessionSigner> => {
    const user = getAddress(wallet.address)
    if ((await carriedApproverOf(user, chainId)) === null) await signGrant(wallet, chainId, zeroAddress)
    return sessionSignerOf(user, chainId)!
  }

  const fundApprovalOf = (user: Address, account: Address): Hex | null => {
    const held = storage.getItem(approvalSlot(user, account))
    return held !== null && isHex(held) ? held : null
  }

  const approveFund = async (wallet: IConnectedWallet, chainId: number, account: Address): Promise<Hex> => {
    const user = getAddress(wallet.address)
    const held = fundApprovalOf(user, account)
    if (held !== null) return held
    const granted = await signGrant(wallet, chainId, account)
    const approval = fundApproval(granted.signer, granted.issuedAt, granted.expiry, granted.epoch, granted.grant)
    storage.setItem(approvalSlot(user, account), approval)
    return approval
  }

  const fundSignerOf = (user: Address, account: Address): IFundSigner | null => {
    const record = fundRecordsOf(storage, user).find(row => row.account === getAddress(account))
    return record === undefined ? null : fundSignerOfRecord(record)
  }

  const fundKeySignatures = new Map<string, Hex>()
  const fundKeySignature = async (wallet: IConnectedWallet, fund: bigint): Promise<Hex> => {
    const slot = `${getAddress(wallet.address)}:${fund}`
    const held = fundKeySignatures.get(slot)
    if (held !== undefined) return held
    const typed = fundKeyTypedData(PROTOCOL.version, fund)
    const signature = await wallet.walletClient.signTypedData(typed)
    const signer = recoverAccountSigner(hashTypedData(typed), signature)
    if (signer === null || !isAddressEqual(signer, wallet.address)) {
      throw new CompactError(
        'WALLET_NOT_OWN_KEY',
        `${getAddress(wallet.address)} signs through contract code, not with its own key. Puppet needs a wallet that signs with its own key, because a fund's trading key is derived from that signature; multisig and passkey wallets are not supported.`,
        'hard'
      )
    }
    fundKeySignatures.set(slot, signature)
    return signature
  }

  const deriveFund = async (
    wallet: IConnectedWallet,
    fund: bigint,
    symbol: string,
    cells: readonly string[],
    chainId: number,
    stake: { token: Address; funding: Hex | null } | { account: Address }
  ): Promise<IFundRecord> => {
    const user = getAddress(wallet.address)
    const { sid, sk } = fundKeyMaterial(await fundKeySignature(wallet, fund))
    const digest = hashTypedData(fundBindingTypedData(sid))
    const session = await carriedApproverOf(user, chainId)
    const bind = async (): Promise<Hex> => (session !== null ? session(digest) : (await grantSession(wallet, chainId)).approve(digest))
    const sealed = storage.getItem(keySlot(user)) as Hex | null
    let share: IShare | null = null
    if (!('account' in stake) && session === null && stake.funding !== null && sealed !== null) {
      const claim: IKeygenClaim = { chainId, user, token: stake.token, account: null, funding: stake.funding, request: await signAs(user, sealed, digest) }
      for (let attempt = 0; share === null && attempt < DEPOSIT_RECORD_TRIES; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, DEPOSIT_RECORD_WAIT_MS))
        try {
          share = await mpc.keygen(sid, sk, claim)
        } catch (err) {
          if (!(err instanceof CompactError && err.code === 'DEPOSIT_UNRECORDED')) throw err
        }
      }
    }
    share ??= await mpc.keygen(
      sid,
      sk,
      'account' in stake ? { chainId, user, account: stake.account, binding: await bind() } : { chainId, user, token: stake.token, account: null, binding: await bind() }
    )
    return { user, fund, symbol, cells: [...cells], account: publicKeyToAddress(share.pk), share }
  }

  const storeFund = (record: IFundRecord): IFundSigner => {
    storage.setItem(fundSlot(record.user, record.fund), JSON.stringify({ ...record, fund: record.fund.toString() }))
    return fundSignerOfRecord(record)
  }

  return {
    grantedChains,
    fundsOf: user => fundRecordsOf(storage, user),
    selectFund: (user, account) => storage.setItem(selectedSlot(getAddress(user)), getAddress(account)),
    sessionOf: sessionSignerOf,
    carriedSessionOf,
    forgetSessions,
    grantSession,
    signerOf,
    fundApprovalOf,
    approveFund,
    fundSignerOf,
    fundKeySigned: (user, fund) => fundKeySignatures.has(`${getAddress(user)}:${fund}`),
    async openFund(wallet, fund, symbol, cells, funded, funding) {
      return storeFund(await deriveFund(wallet, fund, symbol, cells, funded.chainId, { token: funded.token, funding }))
    },
    async restoreFund(wallet, fund) {
      const held = fundSignerOf(wallet.address, fund.account)
      if (held !== null) return held
      const record = await deriveFund(wallet, fund.fund, fund.symbol, fund.cells, HUB_CHAIN_ID, { account: fund.account })
      if (!isAddressEqual(record.account, fund.account)) {
        throw new Error(
          `this wallet derives the fund key ${record.account}, not ${fund.account} recorded on chain; the fund was opened by another wallet, or by one whose signatures are not deterministic`
        )
      }
      return storeFund(record)
    }
  }
}
