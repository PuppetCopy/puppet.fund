import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type Address, concat, type Hex, hexToBytes, keccak256, parseSignature, serializeSignature, slice, stringToHex } from 'viem'
import { hashScalar } from './core.js'

const KEY_DOMAIN = { name: 'Puppet', version: '1' } as const

const FUND_KEY_TYPES = {
  FundKey: [
    { name: 'universe', type: 'uint256' },
    { name: 'fund', type: 'uint256' },
    { name: 'statement', type: 'string' }
  ]
} as const
const FUND_KEY_STATEMENT = 'Derive the trading key of my Puppet fund.\n\nNever sign this on a website: whoever holds this signature controls your fund.'

export const fundKeyTypedData = (universe: bigint, fund: bigint) =>
  ({
    domain: KEY_DOMAIN,
    types: FUND_KEY_TYPES,
    primaryType: 'FundKey',
    message: { universe, fund, statement: FUND_KEY_STATEMENT }
  }) as const

export function fundKeyMaterial(signature: Hex): { sid: Hex; sk: bigint } {
  const canonical = hexToBytes(serializeSignature(parseSignature(signature)))
  return {
    sid: keccak256(concatBytes(utf8ToBytes('puppet-fund-sid'), canonical)),
    sk: hashScalar('fund-share-alice', canonical)
  }
}

export const bobScalar = (seed: Uint8Array, accountModule: Address, sid: Hex): bigint =>
  hashScalar('body-share', seed, hexToBytes(accountModule), hexToBytes(sid))

const FUND_BINDING_TYPES = { FundBinding: [{ name: 'sid', type: 'bytes32' }] } as const

export const fundBindingTypedData = (sid: Hex) =>
  ({ domain: KEY_DOMAIN, types: FUND_BINDING_TYPES, primaryType: 'FundBinding', message: { sid } }) as const

const SIGNER_COMMITMENT_TAG = slice(keccak256(stringToHex('puppet:signer')), 0, 4)

export const signerCommitment = (signer: Address): Hex => concat([SIGNER_COMMITMENT_TAG, signer])
