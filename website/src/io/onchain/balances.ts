import { PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import type { IAccountBalanceRow, ITokenRegistryMap } from '@puppet/sdk/state'
import { type Address, decodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, type Hex, isAddressEqual, multicall3Abi } from 'viem'
import { readSignedBalance, SIGNED_BALANCE_ABI } from './account.js'
import { viewCall } from './viewRead.js'

const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'

// An account's signed balances read straight from each BaseAccount.signedBalanceOf across the registered token set
// (the registry is itself on-chain now), cache-first via the SW. Works for any account (own or a fund's subscriber).
// ONE Multicall3 aggregate3 per chain instead of a per-token eth_call fan-out (chains × tokens requests queued behind
// the connection cap); an individual failed sub-call (undeployed account reverts signedBalanceOf) is a provable empty,
// and a chain where the multicall itself fails falls back to per-token reads so a missing Multicall3 deploy can't
// silently blank that chain. Block metadata is not part of a point read and is unused by the current-balance path.
// Zero balances are dropped.
export async function readAccountBalances(
  registry: ITokenRegistryMap,
  account: Address,
  refresh?: boolean,
  // Settlement floor for ONE chain (block heights are per-chain): that chain's bundle is read pinned at the block, so
  // a lagging node fails loud rather than caching pre-settlement balances as fresh. Other chains read at latest.
  pin?: { chainId: ChainId; block: bigint }
): Promise<IAccountBalanceRow[]> {
  const acct = getAddress(account)
  const perChain = await Promise.all(
    [...registry].map(([chainId, tokens]) =>
      readChainBalances(acct, chainId, [...tokens.values()].map(i => i.token), refresh, pin?.chainId === chainId ? pin.block : undefined)
    )
  )
  return perChain.flat()
}

async function readChainBalances(
  acct: Address,
  chainId: ChainId,
  tokenList: Address[],
  refresh?: boolean,
  minBlock?: bigint
): Promise<IAccountBalanceRow[]> {
  if (tokenList.length === 0) return []
  const row = (token: Address, signed: bigint): IAccountBalanceRow | null =>
    signed === 0n
      ? null
      : {
          id: `${chainId}-${acct}-${token}`,
          chainId: BigInt(chainId),
          account: acct,
          token,
          blockNumber: 0n,
          blockTimestamp: 0,
          signedBalance: signed
        }

  const calls = tokenList.map(token => ({
    target: acct,
    allowFailure: true,
    callData: encodeFunctionData({ abi: SIGNED_BALANCE_ABI, functionName: 'signedBalanceOf', args: [token] })
  }))
  const results = (await viewCall({
    chainId,
    address: MULTICALL3,
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [calls],
    refresh,
    minBlock
  }).catch(() => null)) as { success: boolean; returnData: Hex }[] | null

  if (results === null) {
    // A PINNED bundle failure must stay loud: falling back to unpinned per-token reads here would re-cache the very
    // lagging-node state the pin exists to reject. The fallback only serves the unpinned path (no Multicall3 deploy).
    if (minBlock !== undefined) throw new Error(`pinned balance read failed for chain ${chainId} at block ${minBlock}`)
    const fallback = await Promise.all(
      tokenList.map(async token => row(token, await readSignedBalance(acct, chainId, token, refresh)))
    )
    return fallback.filter((r): r is IAccountBalanceRow => r !== null)
  }

  return tokenList.flatMap((token, i) => {
    const res = results[i]
    if (!res?.success || res.returnData === '0x') return []
    const r = row(token, decodeAbiParameters([{ type: 'uint256' }], res.returnData)[0] as bigint)
    return r ? [r] : []
  })
}

export interface IRouteBalanceRow {
  chainId: ChainId
  token: Hex
  amount: bigint
}

// Funds sitting AT the fund's cross-chain deposit route (a bridge delivery whose recognize never ran, or any direct
// transfer): raw balanceOf(route) per registered token, one aggregate3 per chain. The route usually has NO code (it is
// deployed lazily by the claim itself) — these are plain ERC-20 balances at a deterministic address; the native marker
// reads via Multicall3.getEthBalance. A chain whose multicall fails contributes nothing (surfacing pending funds must
// not take the whole panel down). Zero rows dropped; token is the registry BASE id (what a recognize intent carries).
export async function readRouteBalances(registry: ITokenRegistryMap, route: Address): Promise<IRouteBalanceRow[]> {
  const perChain = await Promise.all(
    [...registry].map(async ([chainId, tokens]) => {
      const entries = [...tokens]
      if (entries.length === 0) return []
      const calls = entries.map(([, info]) =>
        isAddressEqual(getAddress(info.token), getAddress(PROTOCOL.nativeToken))
          ? {
              target: MULTICALL3,
              allowFailure: true,
              callData: encodeFunctionData({ abi: multicall3Abi, functionName: 'getEthBalance', args: [route] })
            }
          : {
              target: info.token,
              allowFailure: true,
              callData: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [route] })
            }
      )
      const results = (await viewCall({
        chainId,
        address: MULTICALL3,
        abi: multicall3Abi,
        functionName: 'aggregate3',
        args: [calls],
        refresh: true
      }).catch(() => null)) as { success: boolean; returnData: Hex }[] | null
      if (results === null) return []
      return entries.flatMap(([id], i) => {
        const res = results[i]
        if (!res?.success || res.returnData === '0x') return []
        const amount = decodeAbiParameters([{ type: 'uint256' }], res.returnData)[0] as bigint
        return amount > 0n ? [{ chainId, token: id as Hex, amount }] : []
      })
    })
  )
  return perChain.flat()
}
