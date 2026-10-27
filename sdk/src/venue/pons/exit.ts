import { PROTOCOL } from '@puppet/contracts/const'
import { type Address, encodeAbiParameters, getAddress, isAddressEqual, keccak256, parseAbiParameters, type PublicClient, zeroAddress } from 'viem'
import { CHAIN_MAP, type ChainId } from '../../const/index.js'
import { tokenMetaByChainToken, tokenMetaKey } from '../../state/tokenRegistry.js'
import { UNISWAP_POOLS, V4_QUOTER_ABI } from '../uniswap/contracts.js'
import { requireRevert } from '../uniswap/exit.js'
import { type IPonsDeployment, PONS_DEPLOYMENTS, PONS_FACTORY_ABI, PONS_GRADUATED_PHASE, PONS_MEME_HOOK_ABI } from './contracts.js'

export const PONS_EXIT_SAMPLES = 7
const PONS_SAMPLE_SPACING_MS = 300_000

export interface IPonsExit {
  token: Address
  amount: bigint
  hookFeeBps: number
  creatorTaxBps: number
}

export async function ponsExit(client: PublicClient, chainId: ChainId, token: Address, amount: bigint, blockNumber: bigint): Promise<IPonsExit | null> {
  const pons = (PONS_DEPLOYMENTS as Partial<Record<ChainId, IPonsDeployment>>)[chainId]
  const quoter = UNISWAP_POOLS[chainId]?.v4Quoter ?? null
  if (pons === undefined || quoter === null) return null
  const launched = await client.readContract({ address: pons.factory, abi: PONS_FACTORY_ABI, functionName: 'getLaunchedToken', args: [token], blockNumber })
  if (!launched.exists || launched.phase !== PONS_GRADUATED_PHASE || !isAddressEqual(launched.token, token)) return null
  const pair = isAddressEqual(launched.pairToken, zeroAddress) ? getAddress(PROTOCOL.nativeToken) : getAddress(launched.pairToken)
  if (!tokenMetaByChainToken.has(tokenMetaKey(chainId, pair))) return null
  const blockTime = CHAIN_MAP[chainId].blockTime
  if (blockTime === undefined) throw new Error(`chain ${chainId} declares no block time, so a Pons pool's quotes over 30 minutes cannot be placed`)
  const sellsCurrency0 = BigInt(token) < BigInt(launched.pairToken)
  const poolKey = {
    currency0: sellsCurrency0 ? getAddress(token) : launched.pairToken,
    currency1: sellsCurrency0 ? launched.pairToken : getAddress(token),
    fee: launched.poolFee,
    tickSpacing: launched.tickSpacing,
    hooks: pons.memeHook
  }
  const poolId = keccak256(
    encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks])
  )
  const step = BigInt(Math.round(PONS_SAMPLE_SPACING_MS / blockTime))
  const [terms, quotes] = await Promise.all([
    client.readContract({ address: pons.memeHook, abi: PONS_MEME_HOOK_ABI, functionName: 'launches', args: [poolId], blockNumber }),
    Promise.all(
      Array.from({ length: PONS_EXIT_SAMPLES }, (_, i) =>
        client
          .readContract({
            address: quoter,
            abi: V4_QUOTER_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{ poolKey, zeroForOne: sellsCurrency0, exactAmount: amount, hookData: '0x' }],
            blockNumber: blockNumber - BigInt(i) * step
          })
          .then(
            ([amountOut]) => amountOut,
            (err: unknown) => {
              requireRevert(err)
              return null
            }
          )
      )
    )
  ])
  const amounts = quotes.filter((quoted): quoted is bigint => quoted !== null && quoted > 0n)
  if (!terms[0] || amounts.length < quotes.length) return null
  return { token: pair, amount: amounts.reduce((lowest, quoted) => (quoted < lowest ? quoted : lowest)), hookFeeBps: terms[10], creatorTaxBps: terms[7] }
}
