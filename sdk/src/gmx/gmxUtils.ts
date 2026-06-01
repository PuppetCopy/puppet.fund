import type { Address } from 'viem/accounts'
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem/utils'

export function getPositionKey(account: Address, market: Address, collateralToken: Address, isLong: boolean) {
  return hashData(['address', 'address', 'address', 'bool'], [account, market, collateralToken, isLong])
}

export function hashData(types: string[], values: (string | number | bigint | boolean)[]) {
  return keccak256(encodeAbiParameters(parseAbiParameters(types) as any, values))
}

export function hashString(string: string) {
  return hashData(['string'], [string])
}
