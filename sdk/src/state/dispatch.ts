import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import type { Address, Hex, PublicClient } from 'viem'
import { getCode, readContract, waitForTransactionReceipt } from 'viem/actions'
import { awaitWhile } from '../core/await.js'

// Settlement is confirmed on-chain over RPC, not from an indexer: the matchmaker dispatches the
// tx and ACKs at dispatch, so the client polls chain truth for the consumed nonce / deployed code
// / mined deposit. The Account module address is deterministic (one CREATE2 universe), so the
// isNonceConsumed read is chain-agnostic in address and only the client varies.
const ACCOUNT = DEPLOYMENTS[`Account:${HUB_CHAIN_ID}`]

const SETTLEMENT_POLL_START_MS = 250
const SETTLEMENT_POLL_MAX_MS = 500

// The contract's nonce replay guard (Account.dispatch consumes the nonce keyed by the executing
// account); true once the dispatched intent has settled on-chain. Answers even for not-yet-deployed
// accounts (isNonceConsumed lives on the shared Account module, keyed per account).
export function isNonceConsumed(client: PublicClient, account: Address, nonce: bigint): Promise<boolean> {
  return readContract(client, {
    address: ACCOUNT.address,
    abi: ACCOUNT.abi,
    functionName: 'isNonceConsumed',
    args: [account, nonce]
  })
}

export async function awaitAccountCall(
  client: PublicClient,
  account: Address,
  nonce: bigint,
  timeoutMs: number
): Promise<void> {
  await awaitWhile(async () => (await isNonceConsumed(client, account, nonce)) || undefined, {
    timeoutMs,
    pollMs: SETTLEMENT_POLL_START_MS,
    maxPollMs: SETTLEMENT_POLL_MAX_MS,
    timeoutMessage: `nonce ${nonce} for ${account} not consumed on-chain within ${timeoutMs}ms`
  })
}

export async function awaitAccountDeployed(client: PublicClient, account: Address, timeoutMs: number): Promise<void> {
  await awaitWhile(
    async () => {
      const code = await getCode(client, { address: account })
      return (!!code && code !== '0x') || undefined
    },
    {
      timeoutMs,
      pollMs: SETTLEMENT_POLL_START_MS,
      maxPollMs: SETTLEMENT_POLL_MAX_MS,
      timeoutMessage: `account ${account} not deployed on-chain within ${timeoutMs}ms`
    }
  )
}

// The deposit settles when its tx is mined successfully; the receipt is the confirmation.
export async function awaitWalletDeposit(client: PublicClient, transactionHash: Hex, timeoutMs: number): Promise<void> {
  const receipt = await waitForTransactionReceipt(client, { hash: transactionHash, timeout: timeoutMs })
  if (receipt.status !== 'success') throw new Error(`deposit tx ${transactionHash} reverted on-chain`)
}
