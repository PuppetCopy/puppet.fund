import { describe, expect, test } from 'bun:test'
import { accountmoduleAbi } from '@puppet/contracts/abi'
import { type Address, createPublicClient, custom, decodeFunctionData, encodeFunctionResult, getAddress, type Hex, isAddressEqual, type PublicClient } from 'viem'
import { predictUserAccount } from '../account/createAccount.js'
import { CHAIN_ID_LIST, type ChainId, deploymentAddress } from '../const/index.js'
import type { IAccountRow } from '../schema/index.js'
import { requireFoldedOn, uncreditedOf } from './terms.js'

const SIGNER_WALLET: Address = '0x5151515151515151515151515151515151515151'
const NEIGHBOUR_WALLET: Address = '0x7272727272727272727272727272727272727272'
const SIGNER = predictUserAccount(SIGNER_WALLET)
const NEIGHBOUR = predictUserAccount(NEIGHBOUR_WALLET)

interface ITipRead {
  chainId: ChainId
  account: Address
}

const chainsAt = (tips: ReadonlyMap<Address, ReadonlyMap<ChainId, bigint>>, reads: ITipRead[]): Record<number, PublicClient> =>
  Object.fromEntries(
    CHAIN_ID_LIST.map(chainId => [
      chainId,
      createPublicClient({
        transport: custom(
          {
            request: async ({ method, params }) => {
              const [call] = params as [{ to: Address; data: Hex }]
              if (method !== 'eth_call' || !isAddressEqual(call.to, deploymentAddress('AccountModule', chainId))) {
                throw new Error(`chain ${chainId} answers only calls to its AccountModule, got ${method}`)
              }
              const decoded = decodeFunctionData({ abi: accountmoduleAbi, data: call.data })
              if (decoded.functionName !== 'accountTipMap') throw new Error(`chain ${chainId} answers only accountTipMap, got ${decoded.functionName}`)
              const account = getAddress(decoded.args[0])
              const tip = tips.get(account)?.get(chainId)
              if (tip === undefined) throw new Error(`chain ${chainId} holds no tip for ${account}`)
              reads.push({ chainId, account })
              return encodeFunctionResult({ abi: accountmoduleAbi, functionName: 'accountTipMap', result: [tip, `0x${'00'.repeat(24)}`] })
            }
          },
          { retryCount: 0 }
        )
      })
    ])
  )

const rowsOf = (wallet: Address, folded: ReadonlyMap<ChainId, number>): IAccountRow[] =>
  [...folded].map(([chainId, lastBlock]) => ({
    chainId: BigInt(chainId),
    account: predictUserAccount(wallet),
    owner: wallet,
    epoch: 0n,
    revokedAt: 0,
    createdAt: 0,
    lastBlock,
    lastLogIndex: 0
  }))

const foldedAt = (offset: number): Map<ChainId, number> => new Map(CHAIN_ID_LIST.map((chainId, i) => [chainId, 1_000 + 10 * i + offset]))

const tipsAt = (folded: ReadonlyMap<ChainId, number>): Map<ChainId, bigint> => new Map([...folded].map(([chainId, block]) => [chainId, BigInt(block)]))

const readKeys = (reads: readonly ITipRead[]): string[] => reads.map(read => `${read.chainId}:${read.account}`).sort()

const everyChainOf = (account: Address): string[] => CHAIN_ID_LIST.map(chainId => `${chainId}:${account}`).sort()

describe('requireFoldedOn', () => {
  test("passes once every chain is folded up to the signer's tip", async () => {
    const folded = foldedAt(0)
    const [unused, ahead] = CHAIN_ID_LIST
    const tips = tipsAt(folded)
    tips.set(unused!, 0n)
    tips.set(ahead!, tips.get(ahead!)! - 5n)
    folded.delete(unused!)
    const reads: ITipRead[] = []
    await requireFoldedOn({ clients: chainsAt(new Map([[SIGNER, tips]]), reads) }, SIGNER, rowsOf(SIGNER_WALLET, folded), CHAIN_ID_LIST)
    expect(readKeys(reads)).toEqual(everyChainOf(SIGNER))
  })

  test("refuses CHRONICLE_BEHIND when any one chain records a call past the signer's fold there", async () => {
    for (const behind of CHAIN_ID_LIST) {
      const folded = foldedAt(0)
      const tips = tipsAt(folded)
      tips.set(behind, tips.get(behind)! + 1n)
      const refused = requireFoldedOn({ clients: chainsAt(new Map([[SIGNER, tips]]), []) }, SIGNER, rowsOf(SIGNER_WALLET, folded), CHAIN_ID_LIST)
      await expect(refused).rejects.toMatchObject({ code: 'CHRONICLE_BEHIND', severity: 'soft' })
      await expect(refused).rejects.toThrow(`on chain ${behind} up to block ${folded.get(behind)}`)
    }
  })

  test('refuses a chain the chronicle holds no row for once the account has a call there', async () => {
    const folded = foldedAt(0)
    const unfolded = CHAIN_ID_LIST[CHAIN_ID_LIST.length - 1]!
    const tips = tipsAt(folded)
    tips.set(unfolded, 5n)
    folded.delete(unfolded)
    const refused = requireFoldedOn({ clients: chainsAt(new Map([[SIGNER, tips]]), []) }, SIGNER, rowsOf(SIGNER_WALLET, folded), CHAIN_ID_LIST)
    await expect(refused).rejects.toMatchObject({ code: 'CHRONICLE_BEHIND', severity: 'soft' })
    await expect(refused).rejects.toThrow(`on chain ${unfolded} up to block 0`)
  })

  test("keys on the signer's own tip and rows, so a neighbour held back refuses only itself", async () => {
    const folded = foldedAt(0)
    const tips = new Map([
      [SIGNER, tipsAt(folded)],
      [NEIGHBOUR, tipsAt(foldedAt(9_000))]
    ])
    const signerReads: ITipRead[] = []
    await requireFoldedOn({ clients: chainsAt(tips, signerReads) }, SIGNER, rowsOf(SIGNER_WALLET, folded), CHAIN_ID_LIST)
    expect(readKeys(signerReads)).toEqual(everyChainOf(SIGNER))
    const neighbourReads: ITipRead[] = []
    await expect(requireFoldedOn({ clients: chainsAt(tips, neighbourReads) }, NEIGHBOUR, rowsOf(NEIGHBOUR_WALLET, folded), CHAIN_ID_LIST)).rejects.toMatchObject({
      code: 'CHRONICLE_BEHIND'
    })
    expect(new Set(neighbourReads.map(read => read.account))).toEqual(new Set([NEIGHBOUR]))
  })
})

describe('uncreditedOf: a spoke release stays the owner\'s until the hub credits it', () => {
  const OWNER = predictUserAccount(SIGNER_WALLET)
  const BODY: Address = '0x00000000000000000000000000000000000b0d1e'
  const WETH: Address = '0x4200000000000000000000000000000000000006'
  const release = (chainId: bigint, fulfilled: bigint, feeBilled: bigint) => ({ owner: OWNER, master: BODY, chainId, token: WETH, fulfilled, feeBilled })
  const credit = (creditChainId: bigint, credited: bigint, feeOwed: bigint) => ({ creditChainId, token: WETH, credited, feeOwed })

  test('a release the hub has not credited counts its net amount against the fund', () => {
    expect(uncreditedOf([release(4663n, 1_000n, 10n)], [])).toEqual([{ chainId: 4663, token: getAddress(WETH), amount: 990n }])
  })

  test('the credit of that exact total and fee leaves nothing pending', () => {
    expect(uncreditedOf([release(4663n, 1_000n, 10n)], [credit(4663n, 1_000n, 10n)])).toEqual([])
  })

  test('a second release counts only what the hub has not credited yet', () => {
    expect(uncreditedOf([release(4663n, 1_500n, 15n)], [credit(4663n, 1_000n, 10n)])).toEqual([{ chainId: 4663, token: getAddress(WETH), amount: 495n }])
  })

  test('a hub release is credited in its own round, so it never pends', () => {
    expect(uncreditedOf([release(10n, 1_000n, 10n)], [])).toEqual([])
  })

  test('a credit on another chain does not settle this one', () => {
    expect(uncreditedOf([release(4663n, 1_000n, 10n)], [credit(42161n, 1_000n, 10n)])).toEqual([{ chainId: 4663, token: getAddress(WETH), amount: 990n }])
  })
})
