import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { CHAINLESS_DOMAIN, GENESIS_TYPES, SESSION_STATEMENT, SESSION_TYPES, TYPEHASH } from '@puppet/contracts/intents'
import type { Address, Hex, SignedAuthorization, TypedDataDefinition } from 'viem'
import { concatHex, encodeAbiParameters, encodePacked, getCreate2Address, hashDomain, hashMessage, hashTypedData, keccak256, parseSignature, zeroHash } from 'viem'
import { hashAuthorization } from 'viem/utils'
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

export function predictDepositRoute(user: Address): Address {
  const module = accountModuleAddress()
  const args = encodePacked(['address', 'address'], [user, module])
  return getCreate2Address({
    from: module,
    salt: zeroHash,
    bytecodeHash: cloneInitCodeHashWithArgs(deploymentAddress('DepositRoute', HUB_CHAIN_ID), args)
  })
}

export function bodyAuthorization() {
  return { chainId: 0, address: deploymentAddress('Account', HUB_CHAIN_ID), nonce: 0 } as const
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
  user: Address
  signer: Address
}

export function genesisDigest(genesis: IGenesis): Hex {
  return chainlessDigest(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' }],
        [TYPEHASH.Genesis, genesis.account, genesis.user, genesis.signer]
      )
    )
  )
}

export function genesisTypedData(genesis: IGenesis) {
  return {
    domain: { ...CHAINLESS_DOMAIN, verifyingContract: accountModuleAddress() },
    types: GENESIS_TYPES,
    primaryType: 'Genesis',
    message: { ...genesis }
  } as const
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface ISession {
  user: Address
  signer: Address
  expiry: bigint
}

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
  | { kind: 'delegation' }
  | { kind: 'message'; message: Hex }
  | { kind: 'typedData'; typedData: TypedDataDefinition }

export interface IBodySigner {
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
      return hashAuthorization(bodyAuthorization())
    case 'message':
      return hashMessage({ raw: request.message })
    case 'typedData':
      return hashTypedData(request.typedData)
  }
}

export interface IBodyGenesis {
  signer: Address
  expiry: bigint
  key: Hex
  user: Hex
  authorization: SignedAuthorization | null
}

export async function signBodyGenesis(
  signer: IBodySigner,
  genesis: IGenesis,
  session: { signature: Hex; expiry: bigint },
  delegated: boolean
): Promise<IBodyGenesis> {
  const key = await signer.sign({ kind: 'genesis', genesis })
  const user = session.signature
  const expiry = session.expiry
  if (delegated) return { signer: genesis.signer, expiry, key, user, authorization: null }
  const authorization = bodyAuthorization()
  const { r, s, yParity } = parseSignature(await signer.sign({ kind: 'delegation' }))
  if (yParity === undefined) throw new Error(`the body key returned a signature without a parity bit for ${signer.account}`)
  return { signer: genesis.signer, expiry, key, user, authorization: { ...authorization, r, s, yParity } }
}
