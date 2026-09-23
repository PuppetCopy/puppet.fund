import type { IFund__Valuation } from '@puppet/contracts/types'
import { getAddress, isAddressEqual } from 'viem'
import { CompactError } from '../compact/error.js'
import { driftVerdict } from '../evaluate/gain.js'
import type { IEvaluationConfig, ISignerGain } from '../evaluate/types.js'

export interface IValuationAudit {
  mark: IFund__Valuation
  gain: ISignerGain | null
  config: IEvaluationConfig
}

const assetKey = (a: IFund__Valuation['assetList'][number]): string => `${a.chainId}:${getAddress(a.token).toLowerCase()}`
const positionKey = (p: IFund__Valuation['positionList'][number]): string => `${p.chainId}:${getAddress(p.venue).toLowerCase()}:${p.id.toLowerCase()}`

function verifyCanonical(kind: string, v: IFund__Valuation): void {
  const refuse = (detail: string): never => {
    throw new CompactError('VALUATION_NOT_CANONICAL', `the ${kind} valuation ${detail}`, 'hard')
  }
  let priorAsset = ''
  for (const a of v.assetList) {
    if (a.amount === 0n) refuse(`carries a zero amount for ${a.token} on chain ${a.chainId}`)
    const key = assetKey(a)
    if (key <= priorAsset) refuse(`lists assets out of order or repeats ${a.token} on chain ${a.chainId}`)
    priorAsset = key
  }
  let priorPosition = ''
  for (const p of v.positionList) {
    if (p.valueInUsd === 0n) refuse(`carries a zero value for position ${p.id} on chain ${p.chainId}`)
    const key = positionKey(p)
    if (key <= priorPosition) refuse(`lists positions out of order or repeats ${p.id} on chain ${p.chainId}`)
    priorPosition = key
  }
}

export function verifyValuation(
  kind: string,
  v: IFund__Valuation,
  deadline: bigint,
  nowSec: bigint,
  audit: IValuationAudit | null
): void {
  if (audit === null) return
  if (deadline > nowSec + audit.config.markWindowSec) {
    throw new CompactError(
      'MARK_WINDOW',
      `the ${kind} deadline ${deadline} is ${deadline - nowSec}s out, past the ${audit.config.markWindowSec}s a valuation stays judgeable`,
      'hard'
    )
  }
  verifyCanonical(kind, v)
  for (const a of v.assetList) {
    const held = audit.mark.assetList.find(h => h.chainId === a.chainId && isAddressEqual(h.token, a.token))
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
  const { drift, allowed, profits, above } = driftVerdict(v.value, audit.mark.value, audit.gain, audit.config.driftToleranceBps)
  if (drift > allowed) {
    throw new CompactError(
      'VALUATION_DRIFT',
      profits
        ? `the ${kind} value ${v.value} sits ${above ? 'above' : 'below'} the attestor's ${audit.mark.value} by ${drift}bps, the side the signer profits from, where no drift is allowed`
        : `the ${kind} value ${v.value} diverges from the attestor's ${audit.mark.value} by ${drift}bps, past the ${allowed}bps band`,
      'hard'
    )
  }
}
