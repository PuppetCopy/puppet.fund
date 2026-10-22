import {
  type Address,
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  getContractAddress,
  type Hex,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  pad,
  size,
  slice,
  toFunctionSelector,
  toHex,
  zeroAddress,
  zeroHash
} from 'viem'
import { decodeErc20 } from '../erc20.js'
import { asBigInt, exactTypes, refuse, sameAddress } from '../typedFields.js'
import type { IDappScreenReason, IDappTypedData } from '../types.js'
import {
  BATCH_TYPES,
  CALL_TYPES,
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_MESSAGE,
  CLOB_AUTH_TYPES,
  DEPOSIT_WALLET_SIGNATURE_TYPE,
  EXCHANGE_DOMAIN,
  OFFRAMP_ABI,
  ONRAMP_ABI,
  ORDER_TYPES,
  POLYMARKET_ADMITTED_APPROVALS,
  POLYMARKET_ADMITTED_OPERATORS,
  POLYMARKET_BRIDGED_USDC,
  POLYMARKET_CHAIN_ID,
  POLYMARKET_DEPOSIT_TOKEN,
  POLYMARKET_EXCHANGES,
  POLYMARKET_OFFRAMP,
  POLYMARKET_ONRAMP,
  POLYMARKET_RELAY_DEPOSITORY,
  POLYMARKET_RELAY_PROXY,
  POLYMARKET_RELAY_ROUTER,
  POLYMARKET_TYCHO_ROUTER,
  POLYMARKET_WALLET_BEACON,
  POLYMARKET_WALLET_FACTORY,
  polymarketDepositFloor,
  RELAY_PROXY_ABI,
  RELAY_ROUTER_ABI,
  SET_APPROVAL_FOR_ALL_ABI,
  TYCHO_ROUTER_ABI,
  TYPED_DATA_SIGN_TYPES,
  WALLET_DOMAIN
} from './contracts.js'

export function polymarketWalletOf(body: Address): Address {
  const args = encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [POLYMARKET_WALLET_FACTORY, pad(body)])
  const initCode = concatHex([
    '0x61',
    toHex(0x52 + size(args), { size: 2 }),
    '0x3d8160233d3973',
    POLYMARKET_WALLET_BEACON,
    '0x60195155f3363d3d373d3d363d602036600436635c60da',
    '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c',
    '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3',
    args
  ])
  return getContractAddress({ opcode: 'CREATE2', from: POLYMARKET_WALLET_FACTORY, salt: keccak256(args), bytecodeHash: keccak256(initCode) })
}

const onPolygon = (td: IDappTypedData): boolean => asBigInt(td.domain?.chainId) === BigInt(POLYMARKET_CHAIN_ID)


function screenClobAuth(account: Address, td: IDappTypedData): IDappScreenReason[] {
  if (td.domain?.version !== CLOB_AUTH_DOMAIN.version || !onPolygon(td) || td.domain.verifyingContract !== undefined) {
    return refuse('DAPP_DOMAIN_NOT_ADMITTED', `ClobAuth is signed only under ${CLOB_AUTH_DOMAIN.name} v${CLOB_AUTH_DOMAIN.version} on chain ${POLYMARKET_CHAIN_ID} with no verifying contract`)
  }
  if (td.primaryType !== 'ClobAuth' || !exactTypes(td, { ClobAuth: CLOB_AUTH_TYPES })) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `${td.primaryType} under ${CLOB_AUTH_DOMAIN.name} is not the ClobAuth API key attestation`)
  }
  if (!sameAddress(td.message.address, account)) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `ClobAuth must name the account itself (${account}), not ${String(td.message.address)}`)
  }
  if (td.message.message !== CLOB_AUTH_MESSAGE) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `ClobAuth carries only the fixed attestation "${CLOB_AUTH_MESSAGE}"`)
  }
  return []
}

function screenOrder(account: Address, td: IDappTypedData): IDappScreenReason[] {
  const exchange = td.domain?.verifyingContract
  if (td.domain?.version !== EXCHANGE_DOMAIN.version || !onPolygon(td) || typeof exchange !== 'string' || !POLYMARKET_EXCHANGES.some(pinned => sameAddress(exchange, pinned))) {
    return refuse(
      'DAPP_DOMAIN_NOT_ADMITTED',
      `Polymarket orders are signed only for the v${EXCHANGE_DOMAIN.version} exchanges ${POLYMARKET_EXCHANGES.join(', ')} on chain ${POLYMARKET_CHAIN_ID}, not v${td.domain?.version} at ${String(exchange)}`
    )
  }
  if (td.primaryType !== 'TypedDataSign' || !exactTypes(td, { TypedDataSign: TYPED_DATA_SIGN_TYPES, Order: ORDER_TYPES })) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `${td.primaryType} is not a Deposit Wallet order; the account signs Polymarket orders only as TypedDataSign over Order`)
  }
  const wallet = polymarketWalletOf(account)
  const m = td.message
  if (m.name !== WALLET_DOMAIN.name || m.version !== WALLET_DOMAIN.version || asBigInt(m.chainId) !== BigInt(POLYMARKET_CHAIN_ID) || !sameAddress(m.verifyingContract, wallet) || m.salt !== zeroHash) {
    return refuse('DAPP_EXIT_DESTINATION', `an order is signed only for the account's own Polymarket wallet ${wallet}, not ${String(m.verifyingContract)}`)
  }
  const order = m.contents
  if (typeof order !== 'object' || order === null) return refuse('DAPP_ACTION_NOT_ADMITTED', 'the order carries no contents')
  const o = order as Record<string, unknown>
  if (!sameAddress(o.maker, wallet) || !sameAddress(o.signer, wallet)) {
    return refuse('DAPP_EXIT_DESTINATION', `an order's maker and signer must both be the account's Polymarket wallet ${wallet}, not ${String(o.maker)} and ${String(o.signer)}`)
  }
  if (asBigInt(o.signatureType) !== BigInt(DEPOSIT_WALLET_SIGNATURE_TYPE)) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `an order uses the Deposit Wallet signature type ${DEPOSIT_WALLET_SIGNATURE_TYPE}, not ${String(o.signatureType)}`)
  }
  if (o.metadata !== zeroHash) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `order metadata ${String(o.metadata)} is a hash the account cannot read; it must be zero`)
  }
  if (o.builder !== zeroHash) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `order builder ${String(o.builder)} would route a builder fee; funds trade with no builder code`)
  }
  const side = asBigInt(o.side)
  const makerAmount = asBigInt(o.makerAmount)
  const takerAmount = asBigInt(o.takerAmount)
  if ((side !== 0n && side !== 1n) || makerAmount === null || takerAmount === null || makerAmount <= 0n || takerAmount <= 0n) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `the order's side ${String(o.side)} and amounts ${String(o.makerAmount)} / ${String(o.takerAmount)} are not a valid limit order`)
  }
  return []
}

const SET_APPROVAL_FOR_ALL = toFunctionSelector(SET_APPROVAL_FOR_ALL_ABI[0])
const WRAP = toFunctionSelector(ONRAMP_ABI[0])
const UNWRAP = toFunctionSelector(OFFRAMP_ABI[0])
const TRANSFER_AND_MULTICALL = toFunctionSelector(RELAY_PROXY_ABI[0])
const SEQUENTIAL_SWAP = toFunctionSelector(TYCHO_ROUTER_ABI[0])
const CLEANUP_ERC20S = toFunctionSelector(RELAY_ROUTER_ABI[0])

const selects = (data: Hex, selector: Hex): boolean => size(data) >= 4 && slice(data, 0, 4) === selector

function screenRelayWithdraw(account: Address, data: Hex, i: number): IDappScreenReason[] {
  if (!selects(data, TRANSFER_AND_MULTICALL)) return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i}: Relay's approval proxy is admitted only for transferAndMulticall`)
  const [tokens, amounts, calls, refundTo, nftRecipient] = decodeFunctionData({ abi: RELAY_PROXY_ABI, data }).args
  if (tokens.length !== 1 || amounts.length !== 1 || !isAddressEqual(tokens[0]!, POLYMARKET_BRIDGED_USDC)) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i}: a Relay withdrawal moves only USDC.e ${POLYMARKET_BRIDGED_USDC}, not ${tokens.join(', ')}`)
  }
  if (!isAddressEqual(refundTo, account) || (!isAddressEqual(nftRecipient, account) && !isAddressEqual(nftRecipient, zeroAddress))) {
    return refuse('DAPP_EXIT_DESTINATION', `batch call ${i}: Relay refunds to ${refundTo} and ${nftRecipient}; a withdrawal pays only the fund ${account}`)
  }
  const amount = amounts[0]!
  const swap = calls.findIndex(inner => isAddressEqual(inner.target, POLYMARKET_TYCHO_ROUTER))
  const reasons = calls.flatMap((inner, j): IDappScreenReason[] => {
    const at = `batch call ${i}, Relay call ${j}`
    if (inner.value !== 0n || inner.allowFailure) return refuse('DAPP_ACTION_NOT_ADMITTED', `${at} forwards value or may fail silently`)
    if (isAddressEqual(inner.target, POLYMARKET_BRIDGED_USDC)) {
      const dec = decodeErc20(inner.callData)
      if (dec?.functionName === 'approve' && isAddressEqual((dec.args as readonly [Address, bigint])[0], POLYMARKET_TYCHO_ROUTER)) return []
      return refuse('DAPP_ACTION_NOT_ADMITTED', `${at}: USDC.e is admitted only as an approval to the swap router ${POLYMARKET_TYCHO_ROUTER}`)
    }
    if (isAddressEqual(inner.target, POLYMARKET_TYCHO_ROUTER)) {
      if (j !== swap || !selects(inner.callData, SEQUENTIAL_SWAP)) return refuse('DAPP_ACTION_NOT_ADMITTED', `${at}: the swap router is admitted for one sequentialSwap`)
      const [amountIn, tokenIn, tokenOut, , minAmountOut, receiver, fee] = decodeFunctionData({ abi: TYCHO_ROUTER_ABI, data: inner.callData }).args
      if (amountIn !== amount || !isAddressEqual(tokenIn, POLYMARKET_BRIDGED_USDC) || !isAddressEqual(tokenOut, POLYMARKET_DEPOSIT_TOKEN)) {
        return refuse('DAPP_ACTION_NOT_ADMITTED', `${at}: the swap must turn all ${amount} USDC.e into USDC ${POLYMARKET_DEPOSIT_TOKEN}, not ${amountIn} of ${tokenIn} into ${tokenOut}`)
      }
      if (!isAddressEqual(receiver, POLYMARKET_RELAY_ROUTER)) return refuse('DAPP_EXIT_DESTINATION', `${at}: the swap pays ${receiver}, not Relay's router ${POLYMARKET_RELAY_ROUTER}`)
      if (fee.clientFeeBps !== 0) return refuse('DAPP_ACTION_NOT_ADMITTED', `${at}: a ${fee.clientFeeBps} bps client fee to ${fee.clientFeeReceiver} is not admitted`)
      if (minAmountOut < polymarketDepositFloor(amountIn)) {
        return refuse('ORDER_PRICE_BOUND', `${at}: the swap guarantees ${minAmountOut} USDC for ${amountIn} USDC.e, below the ${polymarketDepositFloor(amountIn)} floor`)
      }
      return []
    }
    if (isAddressEqual(inner.target, POLYMARKET_RELAY_ROUTER) && selects(inner.callData, CLEANUP_ERC20S)) {
      const [, recipients] = decodeFunctionData({ abi: RELAY_ROUTER_ABI, data: inner.callData }).args
      const foreign = recipients.find(recipient => !isAddressEqual(recipient, account))
      return foreign === undefined ? [] : refuse('DAPP_EXIT_DESTINATION', `${at}: Relay's router pays ${foreign}; a withdrawal pays only the fund ${account}`)
    }
    return refuse('DAPP_ACTION_NOT_ADMITTED', `${at} to ${inner.target} is not an admitted Relay withdraw step`)
  })
  if (reasons.length > 0) return reasons
  const swept = calls.some((inner, j) => {
    if (j <= swap || !isAddressEqual(inner.target, POLYMARKET_RELAY_ROUTER)) return false
    const [cleaned, , cleanedAmounts] = decodeFunctionData({ abi: RELAY_ROUTER_ABI, data: inner.callData }).args
    return cleaned.some((token, k) => isAddressEqual(token, POLYMARKET_DEPOSIT_TOKEN) && cleanedAmounts[k] === 0n)
  })
  return swap !== -1 && swept ? [] : refuse('DAPP_EXIT_DESTINATION', `batch call ${i}: the Relay route must swap the USDC.e and then sweep all the USDC to the fund ${account}`)
}

function screenCall(account: Address, wallet: Address, call: unknown, i: number): IDappScreenReason[] {
  if (typeof call !== 'object' || call === null) return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} is not a call`)
  const { target, value, data } = call as Record<string, unknown>
  if (typeof target !== 'string' || !isAddress(target) || typeof data !== 'string' || !isHex(data)) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} has no readable target and data`)
  }
  if (asBigInt(value) !== 0n) return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} to ${target} forwards value ${String(value)}`)
  if (isAddressEqual(target, wallet)) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} calls the wallet itself (session signers, ownership, upgrades); the account never signs those`)
  }
  if (isAddressEqual(target, POLYMARKET_ONRAMP)) {
    if (size(data as Hex) >= 4 && slice(data as Hex, 0, 4) === WRAP) {
      const [asset, to] = decodeFunctionData({ abi: ONRAMP_ABI, data: data as Hex }).args
      if (!isAddressEqual(asset, POLYMARKET_BRIDGED_USDC)) return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} wraps ${asset}; only USDC.e ${POLYMARKET_BRIDGED_USDC} is wrapped`)
      if (!isAddressEqual(to, wallet)) return refuse('DAPP_EXIT_DESTINATION', `batch call ${i} wraps into ${to}, not the account's Polymarket wallet ${wallet}`)
      return []
    }
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i}: the onramp is admitted only for wrap into the wallet`)
  }
  if (isAddressEqual(target, POLYMARKET_OFFRAMP)) {
    if (size(data as Hex) >= 4 && slice(data as Hex, 0, 4) === UNWRAP) {
      const [asset, to] = decodeFunctionData({ abi: OFFRAMP_ABI, data: data as Hex }).args
      if (!isAddressEqual(asset, POLYMARKET_BRIDGED_USDC)) return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} unwraps into ${asset}; only USDC.e ${POLYMARKET_BRIDGED_USDC} is admitted`)
      if (!isAddressEqual(to, account) && !isAddressEqual(to, wallet)) {
        return refuse('DAPP_EXIT_DESTINATION', `batch call ${i} unwraps to ${to}; an unwrap pays only the fund ${account} or its Polymarket wallet ${wallet}`)
      }
      return []
    }
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i}: the offramp is admitted only for unwrap to the fund`)
  }
  if (isAddressEqual(target, POLYMARKET_RELAY_PROXY)) return screenRelayWithdraw(account, data as Hex, i)
  if (isAddressEqual(target, POLYMARKET_RELAY_DEPOSITORY)) {
    return refuse('DAPP_EXIT_DESTINATION', `batch call ${i} deposits into Relay's escrow, which pays out off-chain under an id this signature cannot read`)
  }
  const spenders = [...POLYMARKET_ADMITTED_APPROVALS].find(([token]) => isAddressEqual(token, target))?.[1]
  if (spenders !== undefined) {
    const dec = decodeErc20(data as Hex)
    if (dec?.functionName === 'approve' && spenders.some(spender => isAddressEqual((dec.args as readonly [Address, bigint])[0], spender))) return []
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i}: ${target} ${dec?.functionName ?? 'call'} is admitted only as an approval to ${spenders.join(', ')}`)
  }
  const operators = [...POLYMARKET_ADMITTED_OPERATORS].find(([token]) => isAddressEqual(token, target))?.[1]
  if (operators !== undefined) {
    if (size(data as Hex) >= 4 && slice(data as Hex, 0, 4) === SET_APPROVAL_FOR_ALL) {
      const [operator] = decodeFunctionData({ abi: SET_APPROVAL_FOR_ALL_ABI, data: data as Hex }).args
      if (operators.some(admitted => isAddressEqual(operator, admitted))) return []
      return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} asks to let ${operator} move every position at ${target}; only ${operators.join(', ')} may`)
    }
    return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} calls ${size(data as Hex) >= 4 ? slice(data as Hex, 0, 4) : data} on the positions at ${target}; only setApprovalForAll to ${operators.join(', ')} is admitted`)
  }
  return refuse('DAPP_ACTION_NOT_ADMITTED', `batch call ${i} to ${target} (${size(data as Hex) >= 4 ? slice(data as Hex, 0, 4) : data}) is not an admitted Polymarket wallet call`)
}

function screenBatch(account: Address, td: IDappTypedData): IDappScreenReason[] {
  const wallet = polymarketWalletOf(account)
  if (td.domain?.version !== WALLET_DOMAIN.version || !onPolygon(td) || !sameAddress(td.domain.verifyingContract, wallet)) {
    return refuse('DAPP_EXIT_DESTINATION', `a wallet batch is signed only for the account's own Polymarket wallet ${wallet}, not ${String(td.domain?.verifyingContract)}`)
  }
  if (td.primaryType !== 'Batch' || !exactTypes(td, { Batch: BATCH_TYPES, Call: CALL_TYPES })) {
    return refuse('DAPP_ACTION_NOT_ADMITTED', `${td.primaryType} under ${WALLET_DOMAIN.name} is not a wallet batch`)
  }
  if (!sameAddress(td.message.wallet, wallet)) {
    return refuse('DAPP_EXIT_DESTINATION', `the batch names wallet ${String(td.message.wallet)}, not the account's ${wallet}`)
  }
  const calls = td.message.calls
  if (!Array.isArray(calls) || calls.length === 0) return refuse('DAPP_ACTION_NOT_ADMITTED', 'the batch carries no calls')
  const reasons = calls.flatMap((call, i) => screenCall(account, wallet, call, i))
  if (
    reasons.length === 0 ||
    !calls.some(call => typeof call === 'object' && call !== null && [POLYMARKET_RELAY_PROXY, POLYMARKET_RELAY_DEPOSITORY, POLYMARKET_OFFRAMP].some(target => sameAddress((call as Record<string, unknown>).target, target)))
  ) {
    return reasons
  }
  const [first, ...rest] = reasons
  return [{ ...first!, detail: `${first!.detail}. To take money out of Polymarket, use Withdraw in your fund's Polymarket block; it pays USDC.e straight to your fund.` }, ...rest]
}

export function screenPolymarketTypedData(account: Address, td: IDappTypedData): IDappScreenReason[] | null {
  const name = td.domain?.name
  if (name === CLOB_AUTH_DOMAIN.name) return screenClobAuth(account, td)
  if (name === EXCHANGE_DOMAIN.name) return screenOrder(account, td)
  if (name === WALLET_DOMAIN.name) return screenBatch(account, td)
  return null
}
