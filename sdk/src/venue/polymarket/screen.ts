import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, isAddressEqual, size, slice, toFunctionSelector } from 'viem'
import { decodeErc20, isRegisteredToken } from '../erc20.js'
import type { IGuardReason, IOperateStep, IVenue } from '../types.js'
import {
  EXCHANGE_DOMAIN,
  ONRAMP_ABI,
  OWNER_ABI,
  POLYMARKET_BRIDGED_USDC,
  POLYMARKET_CHAIN_ID,
  POLYMARKET_DEPOSIT_MIN,
  POLYMARKET_DEPOSIT_TOKEN,
  POLYMARKET_ONRAMP,
  POLYMARKET_PLATFORM,
  POLYMARKET_SWAP_FEE,
  POLYMARKET_SWAP_ROUTER,
  polymarketDepositFloor,
  SWAP_ROUTER_ABI,
  WALLET_DOMAIN
} from './contracts.js'
import { polymarketPositions } from './evaluate.js'
import { attestPolymarketOrder } from './order.js'
import { polymarketWalletOf, screenPolymarketTypedData } from './sign.js'
import { attestPolymarketUnwrap, polymarketWithdrawBalance, polymarketWithdrawLanding, polymarketWithdrawTypedData, submitPolymarketWithdraw } from './withdraw.js'

const EXACT_INPUT_SINGLE = toFunctionSelector(SWAP_ROUTER_ABI[0])
const WRAP = toFunctionSelector(ONRAMP_ABI[0])
const WRAPPED_ASSETS: readonly Address[] = [POLYMARKET_BRIDGED_USDC, POLYMARKET_DEPOSIT_TOKEN]

function swapOf(call: IIAccount__Call) {
  if (!isAddressEqual(call.target, POLYMARKET_SWAP_ROUTER) || size(call.callData) < 4 || slice(call.callData, 0, 4) !== EXACT_INPUT_SINGLE) return null
  try {
    return decodeFunctionData({ abi: SWAP_ROUTER_ABI, data: call.callData }).args[0]
  } catch {
    return null
  }
}

function depositSwapOf(call: IIAccount__Call) {
  const swap = swapOf(call)
  return swap !== null && isAddressEqual(swap.tokenIn, POLYMARKET_DEPOSIT_TOKEN) && isAddressEqual(swap.tokenOut, POLYMARKET_BRIDGED_USDC) && swap.fee === POLYMARKET_SWAP_FEE
    ? swap
    : null
}

function wrapOf(call: IIAccount__Call) {
  if (!isAddressEqual(call.target, POLYMARKET_ONRAMP) || size(call.callData) < 4 || slice(call.callData, 0, 4) !== WRAP) return null
  try {
    const [asset, to, amount] = decodeFunctionData({ abi: ONRAMP_ABI, data: call.callData }).args
    return { asset: getAddress(asset), to: getAddress(to), amount }
  } catch {
    return null
  }
}

export const polymarketVenue: IVenue = {
  venueId: POLYMARKET_PLATFORM,
  name: 'Polymarket',
  chains: [POLYMARKET_CHAIN_ID],
  contracts: [
    {
      chainId: POLYMARKET_CHAIN_ID,
      address: POLYMARKET_SWAP_ROUTER,
      name: 'Uniswap SwapRouter02',
      detail: 'swaps USDC to USDC.e, the collateral Polymarket wraps',
      pullsTokens: true
    },
    {
      chainId: POLYMARKET_CHAIN_ID,
      address: POLYMARKET_ONRAMP,
      name: 'Polymarket Onramp',
      detail: 'wraps USDC.e into pUSD in your Polymarket wallet, ready to trade',
      pullsTokens: true
    }
  ],
  claims(ctx, call) {
    if (ctx.chainId !== POLYMARKET_CHAIN_ID) return false
    if (isAddressEqual(call.target, POLYMARKET_SWAP_ROUTER) || isAddressEqual(call.target, POLYMARKET_ONRAMP)) return true
    const dec = decodeErc20(call.callData)
    if (!isRegisteredToken(ctx, call.target) || dec?.functionName !== 'approve') return false
    const spender = (dec.args as readonly [Address, bigint])[0]
    return isAddressEqual(spender, POLYMARKET_SWAP_ROUTER) || isAddressEqual(spender, POLYMARKET_ONRAMP)
  },
  screen(ctx, call) {
    const reasons: IGuardReason[] = []
    if (call.value !== 0n) {
      reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `call to ${call.target} forwards native value ${call.value}` })
    }
    if (isAddressEqual(call.target, POLYMARKET_ONRAMP)) {
      const wrap = wrapOf(call)
      if (wrap === null) {
        reasons.push({
          code: 'ROUTER_FN_FORBIDDEN',
          detail: `call ${size(call.callData) < 4 ? call.callData : slice(call.callData, 0, 4)} to the Polymarket onramp is not a readable wrap`
        })
        return reasons
      }
      if (!WRAPPED_ASSETS.some(asset => isAddressEqual(asset, wrap.asset))) {
        reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `the Polymarket onramp wraps ${WRAPPED_ASSETS.join(' or ')} into pUSD, not ${wrap.asset}` })
      }
      const wallet = polymarketWalletOf(ctx.account)
      const owner = ctx.facts.owners.get(wallet)
      if (!isAddressEqual(wrap.to, wallet)) {
        reasons.push({ code: 'VENUE_DEPOSIT_BAD_RECIPIENT', detail: `a Polymarket deposit may only credit the account's own wallet ${wallet}, not ${wrap.to}` })
      } else if (owner === undefined) {
        reasons.push({ code: 'VENUE_ACCOUNT_UNRESOLVED', detail: `the fund's Polymarket wallet ${wallet} was not read at the pinned block, so the deposit cannot be checked` })
      } else if (owner === null) {
        reasons.push({ code: 'VENUE_ACCOUNT_UNDEPLOYED', detail: 'Polymarket has not created this fund\'s wallet yet. Link polymarket.com once so Polymarket creates it, then deposit.' })
      } else if (!isAddressEqual(owner, ctx.account)) {
        reasons.push({ code: 'VENUE_ACCOUNT_NOT_OWNED', detail: `the Polymarket wallet ${wallet} is owned by ${owner}, not the fund ${ctx.account}, so nothing may be deposited into it` })
      }
      if (wrap.amount === 0n) {
        reasons.push({ code: 'VENUE_DEPOSIT_BELOW_MIN', detail: 'the wrap moves nothing into the Polymarket wallet' })
      }
      return reasons
    }
    if (!isAddressEqual(call.target, POLYMARKET_SWAP_ROUTER)) {
      const spender = (decodeErc20(call.callData)?.args as readonly [Address, bigint] | undefined)?.[0]
      const allowed = spender !== undefined && isAddressEqual(spender, POLYMARKET_ONRAMP) ? WRAPPED_ASSETS : [POLYMARKET_DEPOSIT_TOKEN]
      if (!allowed.some(token => isAddressEqual(token, call.target))) {
        reasons.push({ code: 'VENUE_DEPOSIT_BAD_TOKEN', detail: `a Polymarket deposit approves ${allowed.join(' or ')} to ${spender}, not ${call.target}` })
      }
      return reasons
    }
    const swap = swapOf(call)
    if (swap === null) {
      reasons.push({
        code: 'ROUTER_FN_FORBIDDEN',
        detail: `call ${size(call.callData) < 4 ? call.callData : slice(call.callData, 0, 4)} to the swap router is not a readable exactInputSingle; multicall, sweeps and unwraps are not admitted`
      })
      return reasons
    }
    if (!isAddressEqual(swap.tokenIn, POLYMARKET_DEPOSIT_TOKEN) || !isAddressEqual(swap.tokenOut, POLYMARKET_BRIDGED_USDC)) {
      reasons.push({
        code: 'VENUE_DEPOSIT_BAD_TOKEN',
        detail: `a Polymarket deposit swaps ${POLYMARKET_DEPOSIT_TOKEN} into ${POLYMARKET_BRIDGED_USDC}, the collateral its onramp wraps, not ${swap.tokenIn} into ${swap.tokenOut}`
      })
    }
    if (swap.fee !== POLYMARKET_SWAP_FEE) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_POOL', detail: `a Polymarket deposit swaps through the pinned ${POLYMARKET_SWAP_FEE} fee tier pool, not the ${swap.fee} one` })
    }
    if (!isAddressEqual(swap.recipient, ctx.account)) {
      reasons.push({ code: 'VENUE_DEPOSIT_BAD_RECIPIENT', detail: `the deposit swap pays the fund ${ctx.account} itself, which then wraps into its Polymarket wallet, not ${swap.recipient}` })
    }
    if (swap.sqrtPriceLimitX96 !== 0n) {
      reasons.push({ code: 'VENUE_DEPOSIT_PARTIAL', detail: `the price limit ${swap.sqrtPriceLimitX96} lets the swap stop early and move less than the ${swap.amountIn} it declares` })
    }
    if (swap.amountIn < POLYMARKET_DEPOSIT_MIN) {
      reasons.push({ code: 'VENUE_DEPOSIT_BELOW_MIN', detail: `Polymarket deposits start at ${POLYMARKET_DEPOSIT_MIN}; ${swap.amountIn} is below it` })
    } else if (swap.amountOutMinimum < polymarketDepositFloor(swap.amountIn)) {
      reasons.push({
        code: 'VENUE_DEPOSIT_FEE',
        detail: `the swap guarantees ${swap.amountOutMinimum} for ${swap.amountIn}, below the ${polymarketDepositFloor(swap.amountIn)} floor a same-asset swap may leave`
      })
    }
    return reasons
  },
  outflows(account, call) {
    const wrap = wrapOf(call)
    if (wrap !== null) return [{ token: wrap.asset, amount: wrap.amount }]
    const swap = depositSwapOf(call)
    return swap === null || !isAddressEqual(swap.recipient, polymarketWalletOf(account)) ? [] : [{ token: POLYMARKET_DEPOSIT_TOKEN, amount: swap.amountIn }]
  },
  exchange(_chainId, account, call) {
    const swap = depositSwapOf(call)
    return swap === null || !isAddressEqual(swap.recipient, account)
      ? { spent: [], received: [] }
      : { spent: [{ token: POLYMARKET_DEPOSIT_TOKEN, amount: swap.amountIn }], received: [{ token: POLYMARKET_BRIDGED_USDC, amount: swap.amountOutMinimum }] }
  },
  async resolve(client, callList, blockNumber) {
    const wallets = [
      ...new Set(
        callList.flatMap(call => {
          const wrap = wrapOf(call)
          return wrap === null ? [] : [wrap.to]
        })
      )
    ]
    const owners = await Promise.all(
      wallets.map(async wallet => {
        const code = await client.getCode({ address: wallet, blockNumber })
        return [wallet, code === undefined || code === '0x' ? null : await client.readContract({ address: wallet, abi: OWNER_ABI, functionName: 'owner', blockNumber })] as const
      })
    )
    return { markets: new Map(), tokens: new Map(), owners: new Map(owners) }
  },
  describe(chainId, _account, callList) {
    const out = new Map<number, IOperateStep[]>()
    if (chainId !== POLYMARKET_CHAIN_ID) return out
    callList.forEach((call, i) => {
      const swap = depositSwapOf(call)
      if (swap !== null) {
        out.set(i, [
          {
            kind: 'venue',
            venueId: POLYMARKET_PLATFORM,
            key: null,
            call: 'exactInputSingle',
            label: 'Swap',
            fields: [{ label: 'into', value: 'USDC.e, the collateral Polymarket wraps' }],
            flows: [
              { token: POLYMARKET_DEPOSIT_TOKEN, delta: -swap.amountIn, exact: true },
              { token: POLYMARKET_BRIDGED_USDC, delta: swap.amountOutMinimum, exact: false }
            ],
            fees:
              swap.amountIn > swap.amountOutMinimum
                ? [{ payee: 'route', token: POLYMARKET_DEPOSIT_TOKEN, amount: swap.amountIn - swap.amountOutMinimum, expected: (swap.amountIn * BigInt(swap.fee)) / 1_000_000n }]
                : []
          }
        ])
        return
      }
      const wrap = wrapOf(call)
      if (wrap === null) return
      out.set(i, [
        {
          kind: 'venue',
          venueId: POLYMARKET_PLATFORM,
          key: null,
          call: 'wrap',
          label: 'Deposit',
          fields: [{ label: 'credits', value: 'your Polymarket wallet as pUSD, ready to trade' }],
          flows: [{ token: wrap.asset, delta: -wrap.amount, exact: true }],
          fees: []
        }
      ])
    })
    return out
  },
  typedData: screenPolymarketTypedData,
  attestTypedData: (clients, account, td) =>
    td.domain?.name === EXCHANGE_DOMAIN.name ? attestPolymarketOrder(clients, account, td) : td.domain?.name === WALLET_DOMAIN.name ? attestPolymarketUnwrap(clients, account, td) : Promise.resolve([]),
  message: () => null,
  positions: polymarketPositions,
  deposit: {
    chainId: POLYMARKET_CHAIN_ID,
    token: POLYMARKET_DEPOSIT_TOKEN,
    min: POLYMARKET_DEPOSIT_MIN,
    creditSec: 0,
    callsOf: (account, amount) => {
      const wrapped = polymarketDepositFloor(amount)
      return [
        {
          target: POLYMARKET_DEPOSIT_TOKEN,
          value: 0n,
          gasLimit: 100_000n,
          callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [POLYMARKET_SWAP_ROUTER, amount] })
        },
        {
          target: POLYMARKET_SWAP_ROUTER,
          value: 0n,
          gasLimit: 300_000n,
          callData: encodeFunctionData({
            abi: SWAP_ROUTER_ABI,
            functionName: 'exactInputSingle',
            args: [
              {
                tokenIn: POLYMARKET_DEPOSIT_TOKEN,
                tokenOut: POLYMARKET_BRIDGED_USDC,
                fee: POLYMARKET_SWAP_FEE,
                recipient: account,
                amountIn: amount,
                amountOutMinimum: wrapped,
                sqrtPriceLimitX96: 0n
              }
            ]
          })
        },
        {
          target: POLYMARKET_BRIDGED_USDC,
          value: 0n,
          gasLimit: 100_000n,
          callData: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [POLYMARKET_ONRAMP, wrapped] })
        },
        {
          target: POLYMARKET_ONRAMP,
          value: 0n,
          gasLimit: 200_000n,
          callData: encodeFunctionData({ abi: ONRAMP_ABI, functionName: 'wrap', args: [POLYMARKET_BRIDGED_USDC, polymarketWalletOf(account), wrapped] })
        }
      ]
    }
  },
  withdraw: {
    chainId: POLYMARKET_CHAIN_ID,
    token: POLYMARKET_BRIDGED_USDC,
    balance: polymarketWithdrawBalance,
    feeOf: () => 0n,
    typedData: polymarketWithdrawTypedData,
    landing: polymarketWithdrawLanding
  },
  submit: submitPolymarketWithdraw,
  dapp: { hosts: ['polymarket.com'], chains: [POLYMARKET_CHAIN_ID] }
}
