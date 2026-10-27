import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, BaseError, ContractFunctionRevertedError, getAddress, isAddressEqual, type PublicClient, zeroAddress } from 'viem'
import type { ChainId } from '../../const/index.js'
import { CHAIN_TOKEN_MAP } from '../../const/network.js'
import { type IUniswapPools, QUOTER_V2_ABI, V3_FACTORY_ABI, V3_POOL_ABI } from './contracts.js'

export const TWAP_SEC = 1800
const FEE_TIERS = [100, 500, 3000, 10_000] as const
const MAX_UINT256 = 2n ** 256n - 1n
const Q192 = 2n ** 192n
const TICK_FACTORS: readonly (readonly [bigint, bigint])[] = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n]
]

export const isCanonical = (chainId: ChainId, token: Address): boolean =>
  Object.values(CHAIN_TOKEN_MAP[chainId as keyof typeof CHAIN_TOKEN_MAP] as Record<string, string>).some(known => isAddressEqual(known as Address, token))

const sqrtRatioAtTick = (tick: number): bigint => {
  const abs = BigInt(Math.abs(tick))
  if (abs > 887_272n) throw new Error(`tick ${tick} is outside the Uniswap range`)
  let ratio = (abs & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  for (const [bit, factor] of TICK_FACTORS) if ((abs & bit) !== 0n) ratio = (ratio * factor) >> 128n
  if (tick > 0) ratio = MAX_UINT256 / ratio
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

export const requireRevert = (err: unknown): void => {
  if (!(err instanceof BaseError) || err.walk(e => e instanceof ContractFunctionRevertedError) === null) throw err
}

export interface IUniswapExit {
  fee: number
  token: Address
  amount: bigint
}

export interface IUniswapQuote {
  fee: number
  token: Address
  quoted: bigint
  averaged: bigint | null
}

export interface IUniswapPool {
  address: Address
  fee: number
  token: Address
}

export async function uniswapPools(client: PublicClient, pinned: IUniswapPools, chainId: ChainId, token: Address, blockNumber: bigint): Promise<IUniswapPool[]> {
  const pairs = (Object.values(CHAIN_TOKEN_MAP[chainId as keyof typeof CHAIN_TOKEN_MAP]) as Address[])
    .filter(out => !isAddressEqual(out, PROTOCOL.nativeToken) && !isAddressEqual(out, token))
    .flatMap(out => FEE_TIERS.map(fee => ({ fee, token: getAddress(out) })))
  const found = await client.multicall({
    allowFailure: false,
    batchSize: 0,
    blockNumber,
    contracts: pairs.map(pair => ({ address: pinned.v3Factory, abi: V3_FACTORY_ABI, functionName: 'getPool' as const, args: [token, pair.token, pair.fee] as const }))
  })
  return pairs.flatMap((pair, i) => (isAddressEqual(found[i]!, zeroAddress) ? [] : [{ address: found[i]!, ...pair }]))
}

export async function uniswapQuotes(
  client: PublicClient,
  pinned: IUniswapPools,
  token: Address,
  pools: readonly IUniswapPool[],
  amount: bigint,
  blockNumber: bigint
): Promise<IUniswapQuote[]> {
  if (pools.length === 0) return []
  const read = await client.multicall({
    allowFailure: true,
    batchSize: 0,
    blockNumber,
    contracts: pools.flatMap(pool => [
      {
        address: pinned.quoterV2,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle' as const,
        args: [{ tokenIn: token, tokenOut: pool.token, amountIn: amount, fee: pool.fee, sqrtPriceLimitX96: 0n }] as const
      },
      { address: pool.address, abi: V3_POOL_ABI, functionName: 'observe' as const, args: [[TWAP_SEC, 0]] as const }
    ])
  })
  return pools.flatMap((pool, i): IUniswapQuote[] => {
    const quoted = read[2 * i]!
    const observed = read[2 * i + 1]!
    if (quoted.status === 'failure') {
      requireRevert(quoted.error)
      return []
    }
    const amountOut = (quoted.result as readonly [bigint, bigint, number, bigint])[0]
    if (observed.status === 'failure') {
      requireRevert(observed.error)
      return [{ fee: pool.fee, token: pool.token, quoted: amountOut, averaged: null }]
    }
    const cumulatives = (observed.result as readonly [readonly bigint[], readonly bigint[]])[0]
    const delta = cumulatives[1]! - cumulatives[0]!
    const window = BigInt(TWAP_SEC)
    const meanTick = delta / window - (delta < 0n && delta % window !== 0n ? 1n : 0n)
    const ratioX192 = sqrtRatioAtTick(Number(meanTick)) ** 2n
    return [{ fee: pool.fee, token: pool.token, quoted: amountOut, averaged: BigInt(token) < BigInt(pool.token) ? (ratioX192 * amount) / Q192 : (Q192 * amount) / ratioX192 }]
  })
}

export async function uniswapExits(
  client: PublicClient,
  pinned: IUniswapPools,
  token: Address,
  pools: readonly IUniswapPool[],
  amount: bigint,
  blockNumber: bigint
): Promise<IUniswapExit[]> {
  return (await uniswapQuotes(client, pinned, token, pools, amount, blockNumber)).flatMap(quote =>
    quote.averaged === null ? [] : [{ fee: quote.fee, token: quote.token, amount: quote.quoted < quote.averaged ? quote.quoted : quote.averaged }]
  )
}
