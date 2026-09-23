import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import { CHAINLESS_DOMAIN, SESSION_STATEMENT, SESSION_TYPES, TYPEHASH } from '@puppet/contracts/intents'
import type { Address, Hex, SignedAuthorization, TypedDataDefinition } from 'viem'
import { concatHex, encodeAbiParameters, encodePacked, getCreate2Address, hashDomain, hashMessage, hashTypedData, hexToBytes, hexToString, keccak256, pad, parseSignature, toHex, zeroHash } from 'viem'
import { hashAuthorization } from 'viem/utils'
import type { ChainId } from '../const/chains.js'
import { deploymentAddress } from '../const/deployments.js'

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

export const GRID = 11
const PIXEL_COUNT = GRID * GRID
const PALETTE_SIZE = 11
const PALETTE_BYTES = PALETTE_SIZE * 3
const CELL_BYTES = PIXEL_COUNT
const PROFILE_BYTES = PALETTE_BYTES + CELL_BYTES
const FEE_BYTES = 2

type IFundPalette = readonly string[]
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

function paletteBytes(palette: IFundPalette): Hex {
  if (palette.length !== PALETTE_SIZE) throw new Error(`a fund palette is ${PALETTE_SIZE} colours, got ${palette.length}`)
  const bytes = new Uint8Array(PALETTE_BYTES)
  palette.forEach((colour, i) => {
    if (!HEX_COLOUR.test(colour)) throw new Error(`palette entry ${i} is "${colour}", not a six digit hex colour`)
    const hex = normalise(colour)
    bytes[i * 3] = Number.parseInt(hex.slice(0, 2), 16)
    bytes[i * 3 + 1] = Number.parseInt(hex.slice(2, 4), 16)
    bytes[i * 3 + 2] = Number.parseInt(hex.slice(4, 6), 16)
  })
  return toHex(bytes)
}

function gridBytes(palette: IFundPalette, grid: IFundGrid): Hex {
  if (palette.length !== PALETTE_SIZE) throw new Error(`a fund palette is ${PALETTE_SIZE} colours, got ${palette.length}`)
  if (grid.length !== PIXEL_COUNT) throw new Error(`a fund avatar is ${PIXEL_COUNT} cells, got ${grid.length}`)
  const at = new Map(palette.map((colour, i) => [normalise(colour), i]))
  const bytes = new Uint8Array(CELL_BYTES)
  grid.forEach((colour, i) => {
    const index = at.get(normalise(colour))
    if (index === undefined) throw new Error(`cell ${i} is "${colour}", which the fund palette does not carry`)
    bytes[i] = index
  })
  return toHex(bytes)
}

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

export const fundProfile = (symbol: string, palette: IFundPalette, grid: IFundGrid): IFundProfile => ({
  symbol: fundSymbolBytes(symbol),
  pixels: concatHex([paletteBytes(palette), gridBytes(palette, grid)])
})

export function predictShare(gate: Address, shareImpl: Address, profile: IFundProfile, body: Address): Address {
  return getCreate2Address({
    from: gate,
    salt: pad(body, { size: 32 }),
    bytecodeHash: cloneInitCodeHashWithArgs(
      shareImpl,
      concatHex([profile.symbol, profile.pixels, pad(toHex(PROTOCOL.performanceFee), { size: FEE_BYTES })])
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

const CHAINLESS_DOMAIN_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'verifyingContract', type: 'address' }
  ]
} as const

export function chainlessDigest(structHash: Hex): Hex {
  return keccak256(
    concatHex([
      '0x1901',
      hashDomain({ domain: { ...CHAINLESS_DOMAIN, verifyingContract: accountModuleAddress() }, types: CHAINLESS_DOMAIN_TYPES }),
      structHash
    ])
  )
}

export interface IGenesis {
  account: Address
  parent: Address
}

export function genesisDigest(genesis: IGenesis): Hex {
  return chainlessDigest(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }],
        [TYPEHASH.Genesis, genesis.account, genesis.parent]
      )
    )
  )
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface ISession {
  user: Address
  signer: Address
  issuedAt: bigint
  expiry: bigint
  epoch: bigint
}

export const sessionEnvelope = (signer: Address, issuedAt: bigint, expiry: bigint, grant: Hex, inner: Hex): Hex =>
  encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }],
    [signer, issuedAt, expiry, grant, inner]
  )

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
  approve: (digest: Hex) => Promise<Hex>,
  delegation: IDelegation | null
): Promise<IBodyGenesis> {
  const key = await signer.sign({ kind: 'genesis', genesis })
  const approval = await approve(genesisDigest(genesis))
  const born = { parent: genesis.parent, key, approval }
  if (delegation === null) return { ...born, authorization: null }
  const authorization = bodyAuthorization(delegation)
  const { r, s, yParity } = parseSignature(await signer.sign({ kind: 'delegation', ...delegation }))
  if (yParity === undefined) throw new Error(`the body key returned a signature without a parity bit for ${signer.account}`)
  return { ...born, authorization: { ...authorization, r, s, yParity } }
}
