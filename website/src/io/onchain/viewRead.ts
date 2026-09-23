import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import {
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type Hex
} from 'viem'
import { EVICT_VIEW_OWNER, viewUrl } from '../../app/swCache.js'
import { publicClientMap } from '../../wallet/wallet.js'

const swActive = (): boolean =>
  typeof navigator !== 'undefined' && navigator.serviceWorker?.controller != null

let cacheOwner: Address | null = null
export function setViewCacheOwner(owner: Address | null): void {
  const next = owner ? getAddress(owner) : null
  if (next === cacheOwner) return
  const previous = cacheOwner
  cacheOwner = next
  if (previous && swActive()) {
    navigator.serviceWorker.controller?.postMessage({ type: EVICT_VIEW_OWNER, owner: previous })
  }
}

const readOwner = (global?: boolean): Address | null => (global ? null : cacheOwner)

type IViewFn<abi extends Abi> = ContractFunctionName<abi, 'pure' | 'view'>
type IViewArgs<abi extends Abi, fn extends IViewFn<abi>> = ContractFunctionArgs<abi, 'pure' | 'view', fn>
type IViewReturn<abi extends Abi, fn extends IViewFn<abi>, args extends IViewArgs<abi, fn>> = ContractFunctionReturnType<
  abi,
  'pure' | 'view',
  fn,
  args
>

interface IViewCall<abi extends Abi, fn extends IViewFn<abi>, args extends IViewArgs<abi, fn>> {
  chainId: ChainId
  address: Address
  abi: abi
  functionName: fn
  args?: args
  maxAge?: number
  global?: boolean
  minBlock?: bigint
}

export async function viewCall<
  const abi extends Abi,
  fn extends IViewFn<abi>,
  const args extends IViewArgs<abi, fn>
>(req: IViewCall<abi, fn, args>): Promise<IViewReturn<abi, fn, args>> {
  const abi = req.abi as Abi
  const functionName = req.functionName as string
  const args = req.args as readonly unknown[] | undefined
  const direct = async (): Promise<IViewReturn<abi, fn, args>> =>
    (await publicClientMap[req.chainId].readContract({
      address: req.address,
      abi,
      functionName,
      args,
      ...(req.minBlock !== undefined ? { blockNumber: req.minBlock } : {})
    })) as IViewReturn<abi, fn, args>
  if (!swActive()) return direct()
  const data = encodeFunctionData({ abi, functionName, args })
  const url = viewUrl({
    net: CHAIN_NETWORK_MAP[req.chainId],
    to: req.address,
    data,
    owner: readOwner(req.global),
    maxAge: req.maxAge,
    block: req.minBlock !== undefined ? `0x${req.minBlock.toString(16)}` : undefined
  })
  const res = await fetch(url)
  const raw = res.ok ? await res.text() : ''
  if (raw === '') return direct()
  const body = JSON.parse(raw) as { result?: Hex; error?: string }
  if (body.error !== undefined || body.result === undefined) throw new Error(body.error ?? 'view read failed')
  return decodeFunctionResult({ abi, functionName, data: body.result }) as IViewReturn<abi, fn, args>
}
