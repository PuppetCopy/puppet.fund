import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type Hex, hexToBytes, keccak256, parseSignature, serializeSignature } from 'viem'
import { hashScalar } from './core.js'

export const BODY_KEY_DOMAIN = { name: 'Puppet', version: '1' } as const
export const BODY_KEY_TYPES = { BodyKey: [{ name: 'statement', type: 'string' }] } as const
export const BODY_KEY_STATEMENT =
  'Derive and store my https://puppet.fund account key in this browser.\n\nVerify the website address.'

export const bodyKeyTypedData = () =>
  ({ domain: BODY_KEY_DOMAIN, types: BODY_KEY_TYPES, primaryType: 'BodyKey', message: { statement: BODY_KEY_STATEMENT } }) as const

export function bodyKeyMaterial(signature: Hex): { sid: Hex; sk: bigint; signer: bigint } {
  const canonical = hexToBytes(serializeSignature(parseSignature(signature)))
  return {
    sid: keccak256(concatBytes(utf8ToBytes('puppet-body-sid'), canonical)),
    sk: hashScalar('body-share-alice', canonical),
    signer: hashScalar('body-signer', canonical)
  }
}

export const BODY_BINDING_TYPES = { BodyBinding: [{ name: 'sid', type: 'bytes32' }] } as const

export const bodyBindingTypedData = (sid: Hex) =>
  ({ domain: BODY_KEY_DOMAIN, types: BODY_BINDING_TYPES, primaryType: 'BodyBinding', message: { sid } }) as const
