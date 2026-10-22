import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, erc20Abi, getAddress, isAddressEqual } from 'viem'
import type { ChainId } from '../const/index.js'
import { tokenMetaOf } from '../state/tokenRegistry.js'
import { readableAddress } from './format.js'
import type { ITokenDescription, IViewRead } from './types.js'

const NATIVE_TOKEN = PROTOCOL.nativeToken

export function isNativeToken(token: Address): boolean {
  return isAddressEqual(token, NATIVE_TOKEN)
}

export function getTokenDescription(chainId: ChainId, token: Address): ITokenDescription {
  const address = getAddress(token)
  const meta = tokenMetaOf(chainId, address)
  return { name: meta.tokenKey, symbol: meta.tokenKey, decimals: meta.decimals, isFiat: meta.isFiat, address }
}

export interface ITokenProfile {
  symbol: string
  decimals: number
}

const profileByToken = new Map<string, ITokenProfile | null>()

const absent = (err: unknown): null => {
  if (err instanceof BaseError && err.walk(cause => cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError) !== null) return null
  throw err
}

export async function readTokenProfiles(viewCall: IViewRead, chainId: ChainId, tokens: readonly Address[]): Promise<Map<Address, ITokenProfile>> {
  const keyOf = (token: Address): string => `${chainId}:${getAddress(token)}`
  const read = await Promise.all(
    [...new Set(tokens.map(token => getAddress(token)))].map(async (token): Promise<readonly [Address, ITokenProfile | null]> => {
      const known = profileByToken.get(keyOf(token))
      if (known !== undefined) return [token, known]
      const [symbol, decimals] = await Promise.all([
        viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'symbol', global: true }).then(
          (value): string | null => value,
          () => null
        ),
        viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'decimals', global: true }).catch(absent)
      ])
      if (decimals === null) {
        profileByToken.set(keyOf(token), null)
        return [token, null]
      }
      if (symbol === null) return [token, { symbol: readableAddress(token), decimals }]
      profileByToken.set(keyOf(token), { symbol, decimals })
      return [token, { symbol, decimals }]
    })
  )
  return new Map(read.flatMap(([token, profile]) => (profile === null ? [] : [[token, profile] as const])))
}
