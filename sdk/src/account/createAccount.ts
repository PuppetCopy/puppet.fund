import { PUPPET_CONTRACT_MAP } from '@puppet/contracts'
import { PROTOCOL_CONFIG, TOKEN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import type { Address, Hex } from 'viem'
import {
  encodeAbiParameters,
  encodePacked,
  getCreate2Address,
  hashMessage,
  keccak256,
  pad,
  stringToHex,
  toBytes
} from 'viem'
export const EMPTY_NAME = stringToHex('', { size: 32 })

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

function packAccountArgs(params: IAccountLib__AccountInitParams): Hex {
  return encodePacked(
    ['address', 'address', 'address', 'bytes32', 'bytes32'],
    [PUPPET_CONTRACT_MAP.Attest.address, params.signer, params.user, params.name, params.baseTokenId]
  )
}

export function predictPuppetAccount(params: IAccountLib__AccountInitParams): Address {
  const args = packAccountArgs(params)
  return getCreate2Address({
    from: PUPPET_CONTRACT_MAP.AccountModule.address,
    salt: keccak256(args),
    bytecodeHash: cloneInitCodeHashWithArgs(PUPPET_CONTRACT_MAP.PuppetAccount.address, args)
  })
}

export function predictTransientRoute(account: Address): Address {
  const args = encodePacked(['address'], [account])
  return getCreate2Address({
    from: PUPPET_CONTRACT_MAP.AccountModule.address,
    salt: pad(account, { size: 32 }),
    bytecodeHash: cloneInitCodeHashWithArgs(PUPPET_CONTRACT_MAP.TransientRoute.address, args)
  })
}

export function predictDepositRoute(account: Address): Address {
  const args = encodePacked(['address'], [account])
  return getCreate2Address({
    from: PUPPET_CONTRACT_MAP.AccountModule.address,
    salt: keccak256(encodePacked(['string', 'address'], ['DEPOSIT_ROUTE', account])),
    bytecodeHash: cloneInitCodeHashWithArgs(PUPPET_CONTRACT_MAP.TransientRoute.address, args)
  })
}

export function predictMasterAccount(params: IAccountLib__AccountInitParams): Address {
  const args = packAccountArgs(params)
  return getCreate2Address({
    from: PUPPET_CONTRACT_MAP.AccountModule.address,
    salt: keccak256(args),
    bytecodeHash: cloneInitCodeHashWithArgs(PUPPET_CONTRACT_MAP.MasterAccount.address, args)
  })
}

export const SIGNER_DERIVATION_MESSAGE = PROTOCOL_CONFIG.signerDerivationMessage

export const DEPLOY_AUTH_DIGEST: Hex = hashMessage(SIGNER_DERIVATION_MESSAGE)

export function deriveSessionKey(signature: Hex): Hex {
  return keccak256(toBytes(signature))
}

// Digest the session key signs to prove ECDSA-derivation from the bind sig.
// Mirrors `AccountLib.signerProofDigest(_user)` in Solidity:
//   keccak256(abi.encode(_user))
// Bound to user (so a proof can't be reused across users); no chainId so a
// single proof is universal across deployments. Contract recovers the signer
// from `signerProof` against this digest and checks `recovered == params.signer`.
export function signerProofDigest(user: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }], [user]))
}

const SYMBOL_BY_TOKEN_ID: Record<string, keyof typeof TOKEN_ID> = Object.fromEntries(
  (Object.keys(TOKEN_ID) as (keyof typeof TOKEN_ID)[]).map(sym => [TOKEN_ID[sym].toLowerCase(), sym])
)

export function symbolForBaseTokenId(baseTokenId: Hex): keyof typeof TOKEN_ID | null {
  return SYMBOL_BY_TOKEN_ID[baseTokenId.toLowerCase()] ?? null
}
