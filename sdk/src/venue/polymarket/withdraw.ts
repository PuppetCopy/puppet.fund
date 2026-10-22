import { type Address, decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits, getAbiItem, getAddress, type Hex, isAddressEqual, type PublicClient, recoverTypedDataAddress, type TypedDataDefinition } from 'viem'
import { getTokenDescription } from '../../core/token.js'
import type { IDappScreenReason, IDappTypedData, IVenueCredentials, IVenueWithdrawContext } from '../types.js'
import {
  BATCH_TYPES,
  CALL_TYPES,
  OFFRAMP_ABI,
  POLYMARKET_BRIDGED_USDC,
  POLYMARKET_CHAIN_ID,
  POLYMARKET_COLLATERAL,
  POLYMARKET_COLLATERAL_VAULT,
  POLYMARKET_OFFRAMP,
  POLYMARKET_RELAYER_URL,
  POLYMARKET_WALLET_FACTORY,
  POLYMARKET_WITHDRAW_DEADLINE_SEC,
  WALLET_DOMAIN,
  WALLET_NONCE_ABI
} from './contracts.js'
import { polymarketWalletOf } from './sign.js'

export async function polymarketWithdrawTypedData(ctx: IVenueWithdrawContext, account: Address, amount: bigint, time: number): Promise<TypedDataDefinition> {
  const polygon = ctx.clients[POLYMARKET_CHAIN_ID]
  if (polygon === undefined) throw new Error(`a Polymarket withdrawal needs a client for chain ${POLYMARKET_CHAIN_ID}`)
  const wallet = polymarketWalletOf(account)
  const nonce = await polygon.readContract({ address: wallet, abi: WALLET_NONCE_ABI, functionName: 'nonce' })
  return {
    domain: { name: WALLET_DOMAIN.name, version: WALLET_DOMAIN.version, chainId: POLYMARKET_CHAIN_ID, verifyingContract: wallet },
    types: { Batch: BATCH_TYPES, Call: CALL_TYPES },
    primaryType: 'Batch',
    message: {
      wallet,
      nonce,
      deadline: BigInt(Math.floor(time / 1000) + POLYMARKET_WITHDRAW_DEADLINE_SEC),
      calls: [
        { target: POLYMARKET_COLLATERAL, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [POLYMARKET_OFFRAMP, amount] }) },
        { target: POLYMARKET_OFFRAMP, value: 0n, data: encodeFunctionData({ abi: OFFRAMP_ABI, functionName: 'unwrap', args: [POLYMARKET_BRIDGED_USDC, account, amount] }) }
      ]
    }
  }
}

export async function polymarketWithdrawBalance(ctx: IVenueWithdrawContext, account: Address): Promise<{ total: bigint; free: bigint }> {
  const polygon = ctx.clients[POLYMARKET_CHAIN_ID]
  if (polygon === undefined) throw new Error(`a Polymarket withdrawal needs a client for chain ${POLYMARKET_CHAIN_ID}`)
  const held = await polygon.readContract({ address: POLYMARKET_COLLATERAL, abi: erc20Abi, functionName: 'balanceOf', args: [polymarketWalletOf(account)] })
  return { total: held, free: held }
}

export async function attestPolymarketUnwrap(clients: Readonly<Record<number, PublicClient>>, account: Address, td: IDappTypedData): Promise<IDappScreenReason[]> {
  const unwrapped = (td.message.calls as readonly { target: Address; data: Hex }[])
    .filter(call => isAddressEqual(call.target, POLYMARKET_OFFRAMP))
    .reduce((sum, call) => sum + decodeFunctionData({ abi: OFFRAMP_ABI, data: call.data }).args[2], 0n)
  if (unwrapped === 0n) return []
  const available = (await polymarketWithdrawBalance({ clients }, account)).free
  if (unwrapped <= available) return []
  const { decimals } = getTokenDescription(POLYMARKET_CHAIN_ID, POLYMARKET_BRIDGED_USDC)
  return [
    {
      code: 'DAPP_EXIT_ABOVE_AVAILABLE',
      detail: `Polymarket can release ${formatUnits(available, decimals)} USDC.e from this fund's wallet now, not ${formatUnits(unwrapped, decimals)}. Withdraw ${formatUnits(available, decimals)} USDC.e or less.`
    }
  ]
}

export async function polymarketWithdrawLanding(
  client: PublicClient,
  account: Address,
  typedData: TypedDataDefinition,
  due: bigint,
  fromBlock: bigint
): Promise<{ block: bigint; txHash: Hex } | { expired: string } | null> {
  const paid = (
    await client.getLogs({ address: POLYMARKET_BRIDGED_USDC, event: getAbiItem({ abi: erc20Abi, name: 'Transfer' }), args: { from: POLYMARKET_COLLATERAL_VAULT, to: account }, fromBlock, strict: true })
  ).find(log => log.args.value >= due)
  if (paid !== undefined) return { block: paid.blockNumber, txHash: paid.transactionHash }
  const { wallet, nonce, deadline } = typedData.message as { wallet: Address; nonce: bigint; deadline: bigint }
  if (BigInt(Math.floor(Date.now() / 1000)) <= deadline) return null
  return (await client.readContract({ address: wallet, abi: WALLET_NONCE_ABI, functionName: 'nonce' })) <= nonce
    ? { expired: `The Polymarket withdrawal expired unexecuted at ${deadline}; nothing moved, so withdraw again.` }
    : null
}

const base64UrlKeepPad = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_')

async function builderHeaders(credentials: IVenueCredentials, method: string, path: string, body: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(credentials.secret), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}${method}${path}${body}`))
  return {
    POLY_BUILDER_API_KEY: credentials.key,
    POLY_BUILDER_PASSPHRASE: credentials.passphrase,
    POLY_BUILDER_SIGNATURE: base64UrlKeepPad(signature),
    POLY_BUILDER_TIMESTAMP: String(timestamp)
  }
}

export async function submitPolymarketWithdraw(typedData: IDappTypedData, signature: Hex, credentials: IVenueCredentials | null): Promise<void> {
  const message = typedData.message as { wallet: string; nonce: bigint | string; deadline: bigint | string; calls: { target: string; value: bigint | string; data: Hex }[] }
  const from = await recoverTypedDataAddress({ ...(typedData as unknown as TypedDataDefinition), signature })
  const path = '/submit'
  const body = JSON.stringify({
    type: 'WALLET',
    from,
    to: POLYMARKET_WALLET_FACTORY,
    nonce: String(message.nonce),
    signature,
    depositWalletParams: {
      depositWallet: getAddress(message.wallet),
      deadline: String(message.deadline),
      calls: message.calls.map(call => ({ target: getAddress(call.target), value: String(call.value), data: call.data }))
    }
  })
  const res = await fetch(`${POLYMARKET_RELAYER_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(credentials === null ? {} : await builderHeaders(credentials, 'POST', path, body)) },
    body
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Polymarket's relayer answered ${res.status} to the withdrawal batch: ${text}`)
}
