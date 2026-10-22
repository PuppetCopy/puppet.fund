import { CHAINLESS_DOMAIN } from '@puppet/contracts/intents'
import type { IFund__Price, IFund__Valuation } from '@puppet/contracts/types'
import { type Address, type Hex, hashTypedData } from 'viem'
import { accountModuleAddress } from '../account/createAccount.js'
import { CompactError } from './error.js'
import { decode, encode } from './frame.js'

export interface IComposedValuation {
  valuation: IFund__Valuation
  price: IFund__Price
}

export interface IValuationOwner {
  user: Address
  approve: (digest: Hex) => Promise<Hex>
}

export const valuationRequestDigest = (master: Address, issuedAt: bigint): Hex =>
  hashTypedData({
    domain: { ...CHAINLESS_DOMAIN, verifyingContract: accountModuleAddress() },
    types: { ValuationRequest: [{ name: 'master', type: 'address' }, { name: 'issuedAt', type: 'uint256' }] },
    primaryType: 'ValuationRequest',
    message: { master, issuedAt }
  })

export const VALUATION_REQUEST_TTL_SEC = 60n
export const VALUATION_REQUEST_CLOCK_MARGIN_SEC = 60n

export async function requestValuation(
  matchmakerUrl: string,
  master: Address,
  shareToken: Address,
  asset: Address,
  owner: IValuationOwner,
  funded: { chainId: number; token: Address } | null
): Promise<IComposedValuation> {
  const issuedAt = BigInt(Math.floor(Date.now() / 1000))
  const approver = await owner.approve(valuationRequestDigest(master, issuedAt))
  const res = await fetch(`${matchmakerUrl}/valuation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: encode({ master, shareToken, asset, user: owner.user, issuedAt, approver, funded })
  })
  if (res.status !== 200) {
    const refusal = res.status === 503 || res.status === 403 ? (decode(await res.text()) as { code: string; detail: string }) : null
    if (refusal !== null) throw new CompactError(refusal.code, refusal.detail, res.status === 403 ? 'hard' : 'soft')
    throw new CompactError('VALUATION_UNAVAILABLE', `the attestor could not value the fund of ${master} (HTTP ${res.status})`, 'soft')
  }
  const x = decode(await res.text()) as Partial<{ valuation: Partial<IFund__Valuation>; price: Partial<IFund__Price> }> | null
  if (
    typeof x !== 'object' ||
    x === null ||
    typeof x.valuation !== 'object' ||
    x.valuation === null ||
    !Array.isArray(x.valuation.assetList) ||
    !Array.isArray(x.valuation.positionList) ||
    typeof x.price !== 'object' ||
    x.price === null ||
    typeof x.price.amount !== 'bigint' ||
    typeof x.price.value !== 'bigint'
  ) {
    throw new CompactError('BAD_COMPOSITION', 'the valuation reply was malformed', 'server')
  }
  return x as IComposedValuation
}
