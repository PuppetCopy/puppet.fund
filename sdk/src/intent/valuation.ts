import { HUB_CANONICAL_TOKEN } from '@puppet/contracts/const'
import type { IFund__Asset, IFund__Position, IFund__Price, IFund__Valuation } from '@puppet/contracts/types'
import { type Address, isAddressEqual } from 'viem'
import { CompactContractError, CompactError } from '../compact/error.js'
import { PRECISION } from '../const/common.js'
import { driftVerdict } from '../evaluate/gain.js'
import type { IEvaluationConfig, ISignerGain } from '../evaluate/types.js'
import { valuationOf } from '../pool/index.js'

export interface IValuationAudit {
  mark: IFund__Valuation
  gain: ISignerGain | null
  config: IEvaluationConfig
}

export const assetKey = (a: IFund__Asset): string => `${a.chainId}:${a.token.toLowerCase()}:${a.id}`
export const positionKey = (p: IFund__Position): string => `${p.chainId}:${p.venue.toLowerCase()}:${p.id.toLowerCase()}`

function verifyCanonical(kind: string, v: IFund__Valuation): void {
  const refuse = (detail: string): never => {
    throw new CompactError('VALUATION_NOT_CANONICAL', `the ${kind} valuation ${detail}`, 'hard')
  }
  let priorAsset = ''
  for (const a of v.assetList) {
    if (a.amount === 0n || a.value === 0n) refuse(`carries a zero amount or value for ${a.token} on chain ${a.chainId}`)
    const key = assetKey(a)
    if (key <= priorAsset) refuse(`lists assets out of order or repeats ${a.token} on chain ${a.chainId}`)
    priorAsset = key
  }
  let priorPosition = ''
  for (const p of v.positionList) {
    if (p.value === 0n) refuse(`carries a zero value for position ${p.id} on chain ${p.chainId}`)
    const key = positionKey(p)
    if (key <= priorPosition) refuse(`lists positions out of order or repeats ${p.id} on chain ${p.chainId}`)
    priorPosition = key
  }
}

const priceSide = (gain: ISignerGain): ISignerGain => ({ above: gain.below, below: gain.above })

const shade = (value: bigint, gain: ISignerGain, bandBps: bigint): bigint => {
  const lean = (value * bandBps) / (2n * PRECISION.basisPoints)
  return gain.below > gain.above ? value + lean : gain.above > gain.below ? value - lean : value
}

export function shadeQuote<T extends { valuation: IFund__Valuation; price: IFund__Price }>(
  quote: T,
  token: Address,
  gain: { valuation: ISignerGain; price: ISignerGain },
  bandBps: bigint
): T {
  return {
    ...quote,
    valuation: {
      assetList: quote.valuation.assetList.map(a => ({ ...a, value: shade(a.value, gain.valuation, bandBps) })),
      positionList: quote.valuation.positionList.map(p => ({ ...p, value: shade(p.value, gain.valuation, bandBps) }))
    },
    price: isAddressEqual(token, HUB_CANONICAL_TOKEN.WETH) ? quote.price : { ...quote.price, value: shade(quote.price.value, priceSide(gain.price), bandBps) }
  }
}

export function verifyPrice(kind: string, price: IFund__Price, mark: bigint, gain: ISignerGain | null, config: IEvaluationConfig): void {
  if (price.amount === 0n || price.value === 0n) throw new CompactContractError('Balance__ZeroAmount', [])
  const inverted = gain === null ? null : priceSide(gain)
  const { drift, allowed, profits, above } = driftVerdict(price.value, mark, inverted, config.driftToleranceBps)
  if (drift > allowed) {
    throw new CompactError(
      'PRICE_DRIFT',
      profits
        ? `the ${kind} prices ${price.amount} at ${price.value}, ${above ? 'above' : 'below'} the attestor's ${mark} by ${drift}bps, the side the signer profits from, where no drift is allowed`
        : `the ${kind} prices ${price.amount} at ${price.value}, ${drift}bps off the attestor's ${mark}, past the ${allowed}bps band`,
      'hard'
    )
  }
}

export function verifyValuation(kind: string, v: IFund__Valuation, audit: IValuationAudit | null): void {
  if (audit === null) return
  verifyCanonical(kind, v)
  for (const a of v.assetList) {
    const held = audit.mark.assetList.find(h => assetKey(h) === assetKey(a))
    if (held === undefined) {
      throw new CompactError('VALUATION_UNHELD', `the ${kind} valuation claims ${a.token} on chain ${a.chainId}, which the fund does not hold`, 'hard')
    }
    if (a.amount > held.amount) {
      throw new CompactError(
        'VALUATION_OVERSTATED',
        `the ${kind} valuation claims ${a.amount} of ${a.token} on chain ${a.chainId} against ${held.amount} held`,
        'hard'
      )
    }
  }
  const value = valuationOf(v)
  const mark = valuationOf(audit.mark)
  const { drift, allowed, profits, above } = driftVerdict(value, mark, audit.gain, audit.config.driftToleranceBps)
  if (drift > allowed) {
    throw new CompactError(
      'VALUATION_DRIFT',
      profits
        ? `the ${kind} value ${value} sits ${above ? 'above' : 'below'} the attestor's ${mark} by ${drift}bps, the side the signer profits from, where no drift is allowed`
        : `the ${kind} value ${value} diverges from the attestor's ${mark} by ${drift}bps, past the ${allowed}bps band`,
      'hard'
    )
  }
}
