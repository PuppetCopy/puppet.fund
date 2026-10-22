import { CHAIN_NETWORK_MAP } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import type { IViewArgs, IViewCall, IViewFn, IViewReturn } from '@puppet/sdk/core'
import { type Abi, type Address, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, getAddress, type Hex } from 'viem'
import { uiStorage } from '@/ui-storage'
import { publicClientMap } from '../../wallet/wallet.js'

const VIEW_KEEP_MS = 3 * 24 * 60 * 60 * 1000

let cacheOwner: Address | null = null
export function setViewCacheOwner(owner: Address | null): void {
  cacheOwner = owner ? getAddress(owner) : null
}

const viewKey = (chainId: ChainId, address: Address, data: Hex, global: boolean | undefined): string =>
  `view:${(global ? null : cacheOwner) ?? 'shared'}:${CHAIN_NETWORK_MAP[chainId]}:${address}:${data}`

export async function localViewCall<
  const abi extends Abi,
  fn extends IViewFn<abi>,
  const args extends IViewArgs<abi, fn>
>(req: IViewCall<abi, fn, args>): Promise<IViewReturn<abi, fn, args> | null> {
  const abi = req.abi as Abi
  const functionName = req.functionName as string
  const hit = await uiStorage.device.read<Hex>(viewKey(req.chainId, req.address, encodeFunctionData({ abi, functionName, args: req.args as readonly unknown[] | undefined }), req.global))
  return hit === null ? null : (decodeFunctionResult({ abi, functionName, data: hit.value }) as IViewReturn<abi, fn, args>)
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
  const key = viewKey(req.chainId, req.address, encodeFunctionData({ abi, functionName, args }), req.global)
  const hit = await uiStorage.device.read<Hex>(key)
  const maxAge = req.minBlock !== undefined ? 0 : req.maxAge
  if (hit !== null && (maxAge === undefined || Date.now() - hit.at <= maxAge)) {
    return decodeFunctionResult({ abi, functionName, data: hit.value }) as IViewReturn<abi, fn, args>
  }
  const value = await direct()
  void uiStorage.device.write(key, encodeFunctionResult({ abi, functionName, result: value }), VIEW_KEEP_MS)
  return value
}
