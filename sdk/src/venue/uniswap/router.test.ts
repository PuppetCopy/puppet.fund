import { describe, expect, test } from 'bun:test'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, encodeAbiParameters, encodeFunctionData, getAddress, type Hex, parseAbiParameters, zeroAddress } from 'viem'
import type { ChainId } from '../../const/index.js'
import { wrappedNativeAddressOf } from '../../state/tokenRegistry.js'
import { PONS_DEPLOYMENTS } from '../pons/contracts.js'
import { ROUTER_ABI, UNISWAP_DEPLOYMENTS } from './contracts.js'
import { planRouterCall } from './router.js'

const ROBINHOOD = 4663 as ChainId
const MEME = getAddress('0xB0c2D83Af6763A1838064748FBBED266B7550deb')
const EXACT_IN_SINGLE = parseAbiParameters([
  'ExactInputSingle',
  'struct ExactInputSingle { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; uint256 minHopPriceX36; bytes hookData; }',
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }'
])

const deployment = UNISWAP_DEPLOYMENTS[ROBINHOOD]
if (deployment === undefined) throw new Error('no Uniswap deployment pinned on Robinhood Chain')
const router = deployment.routerList.find(each => each.version === '2.1')
if (router === undefined) throw new Error('no Universal Router 2.1 pinned on Robinhood Chain')

const swapThrough = (hooks: Address): IIAccount__Call => {
  const single: Hex = encodeAbiParameters(EXACT_IN_SINGLE, [
    {
      poolKey: { currency0: zeroAddress, currency1: MEME, fee: 0, tickSpacing: 200, hooks },
      zeroForOne: true,
      amountIn: 10n ** 15n,
      amountOutMinimum: 1n,
      minHopPriceX36: 0n,
      hookData: '0x'
    }
  ])
  const v4: Hex = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), ['0x06', [single]])
  return { target: router.address, value: 10n ** 15n, gasLimit: 500_000n, callData: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'execute', args: ['0x10', [v4]] }) }
}

const hookRefusals = (hooks: Address) =>
  planRouterCall(deployment, wrappedNativeAddressOf(ROBINHOOD), router, swapThrough(hooks)).refusals.filter(reason => reason.code === 'V4_HOOK_NOT_ADMITTED')

describe('Uniswap v4 hooks', () => {
  test('a pool on the vetted Pons meme hook is admitted', () => {
    expect(hookRefusals(PONS_DEPLOYMENTS[4663].memeHook)).toEqual([])
  })

  test('a pool without a hook is admitted', () => {
    expect(hookRefusals(zeroAddress)).toEqual([])
  })

  test('a pool on the Uniswap aggregator hook into Ramses V3 is admitted', () => {
    expect(hookRefusals(getAddress('0xA117C4f25474b1283345E4DF8D88b9aeC4F62888'))).toEqual([])
  })

  test('a pool on any other hook is refused', () => {
    const refused = hookRefusals(getAddress('0x00000000000000000000000000000000000000c4'))
    expect(refused).toHaveLength(1)
    expect(refused[0]!.detail).toContain('is not vetted')
  })
})
