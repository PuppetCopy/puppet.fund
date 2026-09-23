import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { type Hex, hexToBytes, keccak256, parseSignature, serializeSignature } from 'viem'
import { hashScalar } from './core.js'

const KEY_DOMAIN = { name: 'Puppet', version: '1' } as const

const FUND_KEY_TYPES = {
  FundKey: [
    { name: 'universe', type: 'uint256' },
    { name: 'fund', type: 'uint256' },
    { name: 'statement', type: 'string' }
  ]
} as const
const FUND_KEY_STATEMENT =
  'Derive and store the trading key of my https://puppet.fund fund in this browser.\n\nVerify the website address.'

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

const FUND_BINDING_TYPES = { FundBinding: [{ name: 'sid', type: 'bytes32' }] } as const

export const fundBindingTypedData = (sid: Hex) =>
  ({ domain: KEY_DOMAIN, types: FUND_BINDING_TYPES, primaryType: 'FundBinding', message: { sid } }) as const
