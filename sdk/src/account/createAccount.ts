import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { CHAINLESS_DOMAIN, FUND_APPROVAL, GENESIS_TYPES, SESSION_ENVELOPE, SESSION_STATEMENT, SESSION_TYPES } from '@puppet/contracts/intents'
import type { Address, Hex, SignedAuthorization, TypedDataDefinition } from 'viem'
import { concatHex, encodeAbiParameters, encodePacked, getCreate2Address, hashMessage, hashTypedData, hexToBytes, hexToString, keccak256, pad, parseSignature, toHex, zeroHash } from 'viem'
import { hashAuthorization } from 'viem/utils'
import type { ChainId } from '../const/chains.js'
import { deploymentAddress } from '../const/deployments.js'
import { hyperliquidActionTypedData } from '../venue/hyperliquid/contracts.js'

function cloneInitCodeHashWithArgs(impl: Address, args: Hex): Hex {
  const argBytes = (args.length - 2) / 2
  const runSize = 0x2d + argBytes
  if (runSize > 0xffff) throw new Error(`args too long: ${argBytes}`)
  const runSizeHex = runSize.toString(16).padStart(4, '0')
  const creation = `0x61${runSizeHex}3d81600a3d39f3` as Hex
  const runtimeHead = '0x363d3d373d3d3d363d73' as Hex
  const runtimeTail = '0x5af43d82803e903d91602b57fd5bf3' as Hex
  return keccak256(
    encodePacked(['bytes', 'bytes', 'address', 'bytes', 'bytes'], [creation, runtimeHead, impl, runtimeTail, args])
  )
}

export function accountModuleAddress(): Address {
  return deploymentAddress('AccountModule', HUB_CHAIN_ID)
}

export function predictUserAccount(wallet: Address): Address {
  const module = accountModuleAddress()
  const args = encodePacked(['address', 'address'], [module, wallet])
  return getCreate2Address({
    from: module,
    salt: zeroHash,
    bytecodeHash: cloneInitCodeHashWithArgs(deploymentAddress('UserAccount', HUB_CHAIN_ID), args)
  })
}

export const GRID = 13
const PIXEL_COUNT = GRID * GRID
export const PALETTE_SIZE = 13
export const PALETTE_BYTES = PALETTE_SIZE * 3
const CELL_BYTES = PIXEL_COUNT
export const PROFILE_BYTES = PALETTE_BYTES + CELL_BYTES
const FEE_BYTES = 2

type IFundGrid = readonly string[]

export interface IFundProfile {
  symbol: Hex
  pixels: Hex
}

export const SYMBOL_MIN_LENGTH = 1
export const SYMBOL_MAX_LENGTH = 8
export const SYMBOL_PATTERN = new RegExp(`^[A-Z0-9]{${SYMBOL_MIN_LENGTH},${SYMBOL_MAX_LENGTH}}$`)
const HEX_COLOUR = /^#?[0-9a-fA-F]{6}$/

export function fundSymbolBytes(symbol: string): Hex {
  if (!SYMBOL_PATTERN.test(symbol)) throw new Error(`"${symbol}" is not ${SYMBOL_MIN_LENGTH} to ${SYMBOL_MAX_LENGTH} characters of A-Z and 0-9`)
  return pad(toHex(symbol), { size: 32, dir: 'right' })
}

export const fundSymbolOf = (profile: IFundProfile): string => hexToString(profile.symbol, { size: 32 })

const normalise = (colour: string): string => (colour.startsWith('#') ? colour.slice(1) : colour).toLowerCase()

const profileBytes = (profile: IFundProfile): Uint8Array => {
  const bytes = hexToBytes(profile.pixels)
  if (bytes.length !== PROFILE_BYTES) throw new Error(`a fund profile is ${PROFILE_BYTES} bytes of palette and cells, got ${bytes.length}`)
  return bytes
}

function paletteOf(profile: IFundProfile): string[] {
  const bytes = profileBytes(profile)
  return Array.from({ length: PALETTE_SIZE }, (_, i) => `#${toHex(bytes.subarray(i * 3, i * 3 + 3)).slice(2)}`)
}

export function gridOf(profile: IFundProfile): string[] {
  const colours = paletteOf(profile)
  const bytes = profileBytes(profile)
  return Array.from({ length: PIXEL_COUNT }, (_, i) => {
    const index = bytes[PALETTE_BYTES + i]!
    const colour = colours[index]
    if (colour === undefined) throw new Error(`cell ${i} indexes palette entry ${index}, past the ${PALETTE_SIZE} the fund carries`)
    return colour
  })
}

export function fundProfile(symbol: string, grid: IFundGrid): IFundProfile {
  if (grid.length !== PIXEL_COUNT) throw new Error(`a fund avatar is ${PIXEL_COUNT} cells, got ${grid.length}`)
  const colours: string[] = []
  const cells = new Uint8Array(CELL_BYTES)
  grid.forEach((colour, i) => {
    if (!HEX_COLOUR.test(colour)) throw new Error(`cell ${i} is "${colour}", not a six digit hex colour`)
    const hex = normalise(colour)
    const at = colours.indexOf(hex)
    cells[i] = at === -1 ? colours.push(hex) - 1 : at
  })
  if (colours.length > PALETTE_SIZE) throw new Error(`a fund avatar carries at most ${PALETTE_SIZE} colours, this one has ${colours.length}`)
  const palette = new Uint8Array(PALETTE_BYTES)
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const hex = colours[Math.min(i, colours.length - 1)]!
    palette.set([0, 2, 4].map(at => Number.parseInt(hex.slice(at, at + 2), 16)), i * 3)
  }
  return { symbol: fundSymbolBytes(symbol), pixels: concatHex([toHex(palette), toHex(cells)]) }
}

export function predictShare(gate: Address, shareImpl: Address, profile: IFundProfile, body: Address): Address {
  return getCreate2Address({
    from: gate,
    salt: pad(body, { size: 32 }),
    bytecodeHash: cloneInitCodeHashWithArgs(
      shareImpl,
      concatHex([body, profile.symbol, profile.pixels, pad(toHex(PROTOCOL.performanceFee), { size: FEE_BYTES })])
    )
  })
}

interface IDelegation {
  chainId: ChainId
  nonce: number
}

function bodyAuthorization(delegation: IDelegation) {
  return {
    chainId: delegation.nonce === 0 ? 0 : delegation.chainId,
    address: deploymentAddress('FundAccount', delegation.chainId),
    nonce: delegation.nonce
  } as const
}

export interface IGenesis {
  account: Address
  parent: Address
}

export function genesisTypedData(genesis: IGenesis) {
  return {
    domain: { ...CHAINLESS_DOMAIN, verifyingContract: accountModuleAddress() },
    types: GENESIS_TYPES,
    primaryType: 'Genesis',
    message: genesis
  } as const
}

export const genesisDigest = (genesis: IGenesis): Hex => hashTypedData(genesisTypedData(genesis))

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface ISession {
  user: Address
  signer: Address
  issuedAt: bigint
  expiry: bigint
  epoch: bigint
  fund: Address
}

export const sessionEnvelope = (signer: Address, issuedAt: bigint, expiry: bigint, epoch: bigint, fund: Address, grant: Hex, inner: Hex): Hex =>
  encodeAbiParameters(SESSION_ENVELOPE, [signer, issuedAt, expiry, epoch, fund, grant, inner])

export const fundApproval = (signer: Address, issuedAt: bigint, expiry: bigint, epoch: bigint, grant: Hex): Hex =>
  encodeAbiParameters(FUND_APPROVAL, [signer, issuedAt, expiry, epoch, grant])

export function sessionTypedData(session: ISession) {
  return {
    domain: { ...CHAINLESS_DOMAIN, verifyingContract: accountModuleAddress() },
    types: SESSION_TYPES,
    primaryType: 'Session',
    message: { statement: SESSION_STATEMENT, ...session }
  } as const
}

export type IBodySignRequest =
  | { kind: 'genesis'; genesis: IGenesis }
  | ({ kind: 'delegation' } & IDelegation)
  | { kind: 'message'; message: Hex }
  | { kind: 'typedData'; typedData: TypedDataDefinition }
  | { kind: 'hyperliquidAction'; action: { type: 'setReferrer'; code: string }; nonce: number }

interface IBodySigner {
  account: Address
  signer: Address
  signIntent(digest: Hex): Promise<Hex>
  sign(request: IBodySignRequest): Promise<Hex>
}

export function requestDigest(request: IBodySignRequest): Hex {
  switch (request.kind) {
    case 'genesis':
      return genesisDigest(request.genesis)
    case 'delegation':
      return hashAuthorization(bodyAuthorization(request))
    case 'message':
      return hashMessage({ raw: request.message })
    case 'typedData':
      return hashTypedData(request.typedData)
    case 'hyperliquidAction':
      return hashTypedData(hyperliquidActionTypedData(request.action, request.nonce))
  }
}

export interface IBodyGenesis {
  parent: Address
  key: Hex
  approval: Hex
  authorization: SignedAuthorization | null
}

export async function signBodyGenesis(
  signer: Pick<IBodySigner, 'account' | 'sign'>,
  genesis: IGenesis,
  approval: Hex,
  delegation: IDelegation | null
): Promise<IBodyGenesis> {
  const [key, delegated] = await Promise.all([
    signer.sign({ kind: 'genesis', genesis }),
    delegation === null ? null : signer.sign({ kind: 'delegation', ...delegation })
  ])
  const born = { parent: genesis.parent, key, approval }
  if (delegation === null || delegated === null) return { ...born, authorization: null }
  const authorization = bodyAuthorization(delegation)
  const { r, s, yParity } = parseSignature(delegated)
  if (yParity === undefined) throw new Error(`the body key returned a signature without a parity bit for ${signer.account}`)
  return { ...born, authorization: { ...authorization, r, s, yParity } }
}
