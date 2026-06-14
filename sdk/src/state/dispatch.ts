import type { IAccount__AccountCall, IDeposit__Deposit } from '@puppet/indexer-graphql/entities'
import { type Address, getAddress, type Hex } from 'viem'
import { type IIndexerClient, selectOne } from './shared.js'

export type IAccountCallRow = IAccount__AccountCall
export type IWalletDepositRow = IDeposit__Deposit

const SETTLEMENT_POLL_START_MS = 250
const SETTLEMENT_POLL_MAX_MS = 500

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function pollUntil<T>(run: () => Promise<T | undefined>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let delay = SETTLEMENT_POLL_START_MS
  do {
    const found = await run()
    if (found !== undefined) return found
    await sleep(delay)
    delay = Math.min(delay * 2, SETTLEMENT_POLL_MAX_MS)
  } while (Date.now() < deadline)
  throw new Error(timeoutMessage)
}

export async function findAccountCallByNonce(
  sql: IIndexerClient,
  account: Address,
  chainId: number,
  nonce: bigint
): Promise<IAccountCallRow | undefined> {
  return selectOne(sql, 'Account__AccountCall', {
    where: { account: { _eq: getAddress(account) }, chainId: { _eq: BigInt(chainId) }, nonce: { _eq: nonce } }
  })
}

export async function awaitAccountCall(
  sql: IIndexerClient,
  account: Address,
  chainId: number,
  nonce: bigint,
  timeoutMs: number
): Promise<IAccountCallRow> {
  return pollUntil(
    () => findAccountCallByNonce(sql, account, chainId, nonce),
    timeoutMs,
    `AccountCall not surfaced for ${account} nonce=${nonce} chain=${chainId} within ${timeoutMs}ms`
  )
}

// Event-sourced: deployment presence IS the raw deploy event row.
export async function awaitAccountDeployed(
  sql: IIndexerClient,
  kind: 'createPuppetAccount' | 'createFundAccount',
  account: Address,
  chainId: number,
  timeoutMs: number
): Promise<void> {
  const entity =
    kind === 'createFundAccount' ? ('Account__DeployFundAccount' as const) : ('Account__DeployPuppetAccount' as const)
  await pollUntil(
    () =>
      selectOne(sql, entity, {
        where: { account: { _eq: getAddress(account) }, chainId: { _eq: BigInt(chainId) } },
        fields: ['id']
      }),
    timeoutMs,
    `account ${account} not deployed on chain ${chainId} within ${timeoutMs}ms`
  )
}

export async function findWalletDepositByTxHash(
  sql: IIndexerClient,
  transactionHash: Hex
): Promise<IWalletDepositRow | undefined> {
  return selectOne(sql, 'Deposit__Deposit', {
    where: { transactionHash: { _eq: transactionHash.toLowerCase() as Hex } }
  })
}

export async function awaitWalletDeposit(
  sql: IIndexerClient,
  transactionHash: Hex,
  timeoutMs: number
): Promise<IWalletDepositRow> {
  return pollUntil(
    () => findWalletDepositByTxHash(sql, transactionHash),
    timeoutMs,
    `WalletDeposit not surfaced for tx=${transactionHash} within ${timeoutMs}ms`
  )
}
