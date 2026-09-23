import type { IFund__Allocation, IFund__Valuation } from '@puppet/contracts/types'
import type { Address } from 'viem'
import { CompactError } from './error.js'
import { decode } from './frame.js'

export interface IComposedValuation {
  valuation: IFund__Valuation
}

interface IComposedRound extends IComposedValuation {
  allocationList: IFund__Allocation[]
}

function assertComposed(frame: unknown, what: string): asserts frame is IComposedValuation {
  const x = frame as Partial<{ valuation: Partial<IFund__Valuation> }>
  if (
    typeof x !== 'object' ||
    x === null ||
    typeof x.valuation !== 'object' ||
    x.valuation === null ||
    typeof x.valuation.value !== 'bigint' ||
    !Array.isArray(x.valuation.assetList) ||
    !Array.isArray(x.valuation.positionList)
  ) {
    throw new CompactError('BAD_COMPOSITION', `the ${what} reply was malformed`, 'server')
  }
}

async function composed(url: string, what: string, unavailable: string, detail: string): Promise<unknown> {
  const res = await fetch(url)
  if (res.status !== 200) {
    const refusal = res.status === 503 ? (decode(await res.text()) as { code: string; detail: string }) : null
    if (refusal !== null) throw new CompactError(refusal.code, refusal.detail, 'soft')
    throw new CompactError(unavailable, `${detail} (HTTP ${res.status})`, 'soft')
  }
  const frame = decode(await res.text())
  assertComposed(frame, what)
  return frame
}

export async function requestValuation(matchmakerUrl: string, master: Address, share: Address): Promise<IComposedValuation> {
  return (await composed(
    `${matchmakerUrl}/valuation?master=${master}&share=${share}`,
    'valuation',
    'VALUATION_UNAVAILABLE',
    `the attestor could not value the fund of ${master}`
  )) as IComposedValuation
}

export async function requestAllocation(
  matchmakerUrl: string,
  master: Address,
  share: Address,
  contribution: bigint,
  funded: { user: Address; chainId: number; token: Address } | null
): Promise<IComposedRound> {
  const stake = funded === null ? '' : `&user=${funded.user}&chainId=${funded.chainId}&token=${funded.token}`
  const frame = await composed(
    `${matchmakerUrl}/allocation?master=${master}&share=${share}&contribution=${contribution}${stake}`,
    'allocation',
    'ALLOCATION_UNAVAILABLE',
    `the attestor could not compose a round for ${master}`
  )
  if (!Array.isArray((frame as Partial<IComposedRound>).allocationList)) {
    throw new CompactError('BAD_COMPOSITION', 'the allocation reply carried no allocation list', 'server')
  }
  return frame as IComposedRound
}
