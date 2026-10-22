import { PROTOCOL } from '@puppet/contracts/const'
import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, type DecodeFunctionDataReturnType, decodeAbiParameters, decodeFunctionData, getAddress, type Hex, hexToBytes, isAddressEqual, parseAbiParameters, size, slice, zeroAddress } from 'viem'
import type { IGuardReason } from '../types.js'
import { type IUniswapDeployment, type IUniswapRouter, ROUTER_ABI } from './contracts.js'

export const MSG_SENDER = getAddress('0x0000000000000000000000000000000000000001')
const ADDRESS_THIS = getAddress('0x0000000000000000000000000000000000000002')
const NATIVE = getAddress(PROTOCOL.nativeToken)
const CONTRACT_BALANCE = 1n << 255n
const OPEN_DELTA = 0n
const ALLOW_REVERT = 0x80
const REVERTIBLE: ReadonlySet<number> = new Set([0x03, 0x0a, 0x0e])

export const V3_SWAP = { '2.0': parseAbiParameters('address, uint256, uint256, bytes, bool'), '2.1': parseAbiParameters('address, uint256, uint256, bytes, bool, uint256[]') }
const V2_SWAP = { '2.0': parseAbiParameters('address, uint256, uint256, address[], bool'), '2.1': parseAbiParameters('address, uint256, uint256, address[], bool, uint256[]') }
const TOKEN_RECIPIENT_AMOUNT = parseAbiParameters('address, address, uint256')
const RECIPIENT_AMOUNT = parseAbiParameters('address, uint256')
const COMMANDS_INPUTS = parseAbiParameters('bytes, bytes[]')
const TRANSFER_BATCH = parseAbiParameters(['AllowanceTransferDetails[]', 'struct AllowanceTransferDetails { address from; address to; uint160 amount; address token; }'])
const PERMIT_SINGLE = parseAbiParameters([
  'PermitSingle, bytes',
  'struct PermitSingle { PermitDetails details; address spender; uint256 sigDeadline; }',
  'struct PermitDetails { address token; uint160 amount; uint48 expiration; uint48 nonce; }'
])
const PERMIT_BATCH = parseAbiParameters([
  'PermitBatch, bytes',
  'struct PermitBatch { PermitDetails[] details; address spender; uint256 sigDeadline; }',
  'struct PermitDetails { address token; uint160 amount; uint48 expiration; uint48 nonce; }'
])
const POOL_KEY = 'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }'
const PATH_KEY = 'struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }'
const V4_EXACT_IN_SINGLE = {
  '2.0': parseAbiParameters(['ExactInputSingle', 'struct ExactInputSingle { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; bytes hookData; }', POOL_KEY]),
  '2.1': parseAbiParameters([
    'ExactInputSingle',
    'struct ExactInputSingle { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; uint256 minHopPriceX36; bytes hookData; }',
    POOL_KEY
  ])
}
const V4_EXACT_IN = {
  '2.0': parseAbiParameters(['ExactInput', 'struct ExactInput { address currencyIn; PathKey[] path; uint128 amountIn; uint128 amountOutMinimum; }', PATH_KEY]),
  '2.1': parseAbiParameters([
    'ExactInput',
    'struct ExactInput { address currencyIn; PathKey[] path; uint256[] minHopPriceX36; uint128 amountIn; uint128 amountOutMinimum; }',
    PATH_KEY
  ])
}
const V4_EXACT_OUT_SINGLE = {
  '2.0': parseAbiParameters(['ExactOutputSingle', 'struct ExactOutputSingle { PoolKey poolKey; bool zeroForOne; uint128 amountOut; uint128 amountInMaximum; bytes hookData; }', POOL_KEY]),
  '2.1': parseAbiParameters([
    'ExactOutputSingle',
    'struct ExactOutputSingle { PoolKey poolKey; bool zeroForOne; uint128 amountOut; uint128 amountInMaximum; uint256 minHopPriceX36; bytes hookData; }',
    POOL_KEY
  ])
}
const V4_EXACT_OUT = {
  '2.0': parseAbiParameters(['ExactOutput', 'struct ExactOutput { address currencyOut; PathKey[] path; uint128 amountOut; uint128 amountInMaximum; }', PATH_KEY]),
  '2.1': parseAbiParameters([
    'ExactOutput',
    'struct ExactOutput { address currencyOut; PathKey[] path; uint256[] minHopPriceX36; uint128 amountOut; uint128 amountInMaximum; }',
    PATH_KEY
  ])
}
const SETTLE = parseAbiParameters('address, uint256, bool')
const CURRENCY_AMOUNT = parseAbiParameters('address, uint256')

export interface IRouterDelivery {
  token: Address
  floor: bigint
  to: Address
  via: 'swap' | 'take' | 'sweep' | 'transfer' | 'portion' | 'wrap' | 'unwrap'
}

interface IRouterHeld {
  floor: bigint
  exact: boolean
}

export interface IRouterPlan {
  refusals: IGuardReason[]
  spent: Map<Address, bigint>
  produced: Set<Address>
  deliveries: IRouterDelivery[]
  stranded: Map<Address, IRouterHeld>
  permits: { token: Address; spender: Address; amount: bigint }[]
}

const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`

const assetOf = (currency: Address): Address => (isAddressEqual(currency, zeroAddress) ? NATIVE : getAddress(currency))

function v3PathTokens(path: Hex): Address[] | null {
  const length = size(path)
  if (length < 43 || (length - 20) % 23 !== 0) return null
  const tokens: Address[] = []
  for (let offset = 0; offset <= length - 20; offset += 23) tokens.push(getAddress(slice(path, offset, offset + 20)))
  return tokens
}

export function planRouterCall(deployment: IUniswapDeployment, wrapped: Address, router: IUniswapRouter, call: IIAccount__Call): IRouterPlan {
  const plan: IRouterPlan = { refusals: [], spent: new Map(), produced: new Set(), deliveries: [], stranded: new Map(), permits: [] }
  const version = router.version
  const held = plan.stranded
  const refuse = (code: string, detail: string): void => {
    plan.refusals.push({ code, detail })
  }
  const spend = (token: Address, amount: bigint): void => {
    plan.spent.set(token, (plan.spent.get(token) ?? 0n) + amount)
  }
  const park = (token: Address, floor: bigint, exact: boolean): void => {
    const prior = held.get(token) ?? { floor: 0n, exact: true }
    held.set(token, { floor: prior.floor + floor, exact: prior.exact && exact })
  }
  const drawExact = (token: Address, amount: bigint): void => {
    const prior = held.get(token)
    if (prior !== undefined) held.set(token, { floor: prior.floor > amount ? prior.floor - amount : 0n, exact: prior.exact })
  }
  const drawAll = (token: Address): IRouterHeld => {
    const prior = held.get(token) ?? { floor: 0n, exact: true }
    held.delete(token)
    return prior
  }
  const drawShare = (token: Address, kept: bigint, whole: bigint): void => {
    const prior = held.get(token)
    if (prior !== undefined) held.set(token, { floor: (prior.floor * kept) / whole, exact: prior.exact && prior.floor === 0n })
  }
  const route = (token: Address, recipient: Address, floor: bigint, exact: boolean, via: IRouterDelivery['via']): void => {
    if (isAddressEqual(recipient, ADDRESS_THIS)) park(token, floor, exact)
    else plan.deliveries.push({ token, floor, to: getAddress(recipient), via })
  }
  const checkSpender = (spender: Address, at: string): void => {
    if (!deployment.routerList.some(r => isAddressEqual(r.address, spender))) {
      refuse('PERMIT_SPENDER_NOT_ROUTER', `the Permit2 permit in command ${at} names spender ${spender}; only a pinned Universal Router may be permitted`)
    }
  }

  const v4 = (input: Hex, at: string): void => {
    const [actions, params] = decodeAbiParameters(COMMANDS_INPUTS, input)
    const actionList = hexToBytes(actions)
    if (actionList.length !== params.length) {
      refuse('UNDECODABLE_COMMAND', `V4_SWAP in command ${at} carries ${actionList.length} actions and ${params.length} params`)
      return
    }
    const debt = new Map<Address, { max: bigint; exact: boolean }>()
    const credit = new Map<Address, bigint>()
    const owe = (currency: Address, amount: bigint, exact: boolean): void => {
      const prior = debt.get(currency)
      debt.set(currency, { max: (prior?.max ?? 0n) + amount, exact: (prior?.exact ?? true) && exact })
    }
    const earn = (currency: Address, floor: bigint): void => {
      credit.set(currency, (credit.get(currency) ?? 0n) + floor)
    }
    const admitHook = (hooks: Address, where: string): void => {
      if (isAddressEqual(hooks, zeroAddress)) return
      refuse(
        'V4_HOOK_NOT_ADMITTED',
        `the v4 pool in ${where} runs hook ${getAddress(hooks)}; a hook is code anyone can deploy, and it can take a fee from every swap for an address the screen cannot pin, so only pools without a hook are admitted. Route the trade through a pool without a hook`
      )
    }
    const settle = (currency: Address, amount: bigint, fromUser: boolean, where: string): void => {
      const owed = debt.get(currency) ?? { max: 0n, exact: true }
      const fromRouter = !fromUser || isAddressEqual(currency, NATIVE)
      if (amount === CONTRACT_BALANCE) {
        if (fromRouter) drawAll(currency)
        else refuse('AMOUNT_UNBOUNDED', `SETTLE of ${currency} in ${where} pulls from the account an amount equal to the router's own balance, which no field bounds`)
        return
      }
      const paid = amount === OPEN_DELTA ? owed.max : amount
      if (!fromRouter) spend(currency, paid)
      else if (amount === OPEN_DELTA && !owed.exact) drawShare(currency, 0n, 1n)
      else drawExact(currency, paid)
      if (amount === OPEN_DELTA) debt.delete(currency)
      else debt.set(currency, { max: owed.max > amount ? owed.max - amount : 0n, exact: owed.exact })
    }
    actionList.forEach((action, j) => {
      const param = params[j]!
      const where = `${at}.${j}`
      if (action === 0x06) {
        const [swap] = decodeAbiParameters(V4_EXACT_IN_SINGLE[version], param)
        admitHook(swap.poolKey.hooks, where)
        const [currencyIn, currencyOut] = swap.zeroForOne ? [swap.poolKey.currency0, swap.poolKey.currency1] : [swap.poolKey.currency1, swap.poolKey.currency0]
        if (swap.amountIn !== OPEN_DELTA) owe(assetOf(currencyIn), swap.amountIn, true)
        earn(assetOf(currencyOut), swap.amountOutMinimum)
        plan.produced.add(assetOf(currencyOut))
      } else if (action === 0x07) {
        const [swap] = decodeAbiParameters(V4_EXACT_IN[version], param)
        const last = swap.path.at(-1)
        if (last === undefined) {
          refuse('UNDECODABLE_COMMAND', `SWAP_EXACT_IN in ${where} has an empty path`)
          return
        }
        swap.path.forEach((hop, k) => admitHook(hop.hooks, `${where} hop ${k}`))
        if (swap.amountIn !== OPEN_DELTA) owe(assetOf(swap.currencyIn), swap.amountIn, true)
        earn(assetOf(last.intermediateCurrency), swap.amountOutMinimum)
        plan.produced.add(assetOf(last.intermediateCurrency))
      } else if (action === 0x08) {
        const [swap] = decodeAbiParameters(V4_EXACT_OUT_SINGLE[version], param)
        admitHook(swap.poolKey.hooks, where)
        const [currencyIn, currencyOut] = swap.zeroForOne ? [swap.poolKey.currency0, swap.poolKey.currency1] : [swap.poolKey.currency1, swap.poolKey.currency0]
        owe(assetOf(currencyIn), swap.amountInMaximum, false)
        earn(assetOf(currencyOut), swap.amountOut)
        plan.produced.add(assetOf(currencyOut))
      } else if (action === 0x09) {
        const [swap] = decodeAbiParameters(V4_EXACT_OUT[version], param)
        const first = swap.path[0]
        if (first === undefined) {
          refuse('UNDECODABLE_COMMAND', `SWAP_EXACT_OUT in ${where} has an empty path`)
          return
        }
        swap.path.forEach((hop, k) => admitHook(hop.hooks, `${where} hop ${k}`))
        owe(assetOf(first.intermediateCurrency), swap.amountInMaximum, false)
        earn(assetOf(swap.currencyOut), swap.amountOut)
        plan.produced.add(assetOf(swap.currencyOut))
      } else if (action === 0x0b) {
        const [currency, amount, payerIsUser] = decodeAbiParameters(SETTLE, param)
        settle(assetOf(currency), amount, payerIsUser, where)
      } else if (action === 0x0c) {
        const [currency, maxAmount] = decodeAbiParameters(CURRENCY_AMOUNT, param)
        const asset = assetOf(currency)
        const owed = debt.get(asset)?.max ?? 0n
        settle(asset, owed < maxAmount ? OPEN_DELTA : maxAmount, true, where)
      } else if (action === 0x0e) {
        const [currency, recipient, amount] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, param)
        const asset = assetOf(currency)
        const earned = credit.get(asset) ?? 0n
        if (amount === OPEN_DELTA) credit.delete(asset)
        else credit.set(asset, earned > amount ? earned - amount : 0n)
        route(asset, recipient, amount === OPEN_DELTA ? earned : amount, amount !== OPEN_DELTA, 'take')
      } else if (action === 0x0f) {
        const [currency, minAmount] = decodeAbiParameters(CURRENCY_AMOUNT, param)
        const asset = assetOf(currency)
        const earned = credit.get(asset) ?? 0n
        credit.delete(asset)
        route(asset, MSG_SENDER, earned > minAmount ? earned : minAmount, false, 'take')
      } else if (action === 0x10) {
        const [currency, recipient, bips] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, param)
        const asset = assetOf(currency)
        const earned = credit.get(asset) ?? 0n
        credit.set(asset, bips >= 10_000n ? 0n : (earned * (10_000n - bips)) / 10_000n)
        route(asset, recipient, 0n, false, 'portion')
      } else {
        refuse('V4_ACTION_NOT_ADMITTED', `V4 action ${hex(action)} in ${where} is not a swap, settle or take; the Universal Router ${version} does not run it`)
      }
    })
  }

  const run = (commands: Hex, inputs: readonly Hex[], path: string): void => {
    const commandList = hexToBytes(commands)
    if (commandList.length !== inputs.length) {
      refuse('UNDECODABLE_ROUTER_CALL', `${commandList.length} commands carry ${inputs.length} inputs`)
      return
    }
    commandList.forEach((byte, i) => {
      const command = byte & 0x7f
      const input = inputs[i]!
      const at = `${path}${i}`
      if ((byte & ALLOW_REVERT) !== 0 && !REVERTIBLE.has(command)) {
        refuse('ALLOW_REVERT_FORBIDDEN', `command ${hex(command)} at ${at} may fail silently, so nothing it delivers or returns is guaranteed`)
      }
      try {
        if (command === 0x00 || command === 0x01 || command === 0x08 || command === 0x09) {
          const v3 = command <= 0x01
          const exactOut = command === 0x01 || command === 0x09
          const [recipient, amount, bound, rawPath, payerIsUser] = decodeAbiParameters(v3 ? V3_SWAP[version] : V2_SWAP[version], input)
          const hops = v3 ? v3PathTokens(rawPath as Hex) : (rawPath as readonly Address[]).map(token => getAddress(token))
          if (hops === null || hops.length < 2) {
            refuse('UNDECODABLE_COMMAND', `swap command ${hex(command)} at ${at} has no usable path`)
            return
          }
          const tokenIn = v3 && exactOut ? hops.at(-1)! : hops[0]!
          const tokenOut = v3 && exactOut ? hops[0]! : hops.at(-1)!
          const prePaid = command === 0x08 && amount === 0n
          const maxIn = exactOut ? bound : amount
          if (payerIsUser) {
            if (maxIn === CONTRACT_BALANCE) {
              refuse('AMOUNT_UNBOUNDED', `swap command ${hex(command)} at ${at} pulls from the account an amount equal to the router's own balance, which no field bounds`)
            } else if (!prePaid) spend(tokenIn, maxIn)
          } else if (exactOut) drawShare(tokenIn, 0n, 1n)
          else if (amount === CONTRACT_BALANCE) drawAll(tokenIn)
          else if (!prePaid) drawExact(tokenIn, amount)
          plan.produced.add(tokenOut)
          route(tokenOut, recipient, exactOut ? amount : bound, exactOut, 'swap')
        } else if (command === 0x02) {
          const [token, recipient, amount] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, input)
          spend(getAddress(token), amount)
          route(getAddress(token), recipient, amount, true, 'transfer')
        } else if (command === 0x0d) {
          const [details] = decodeAbiParameters(TRANSFER_BATCH, input)
          for (const detail of details) {
            spend(getAddress(detail.token), detail.amount)
            route(getAddress(detail.token), detail.to, detail.amount, true, 'transfer')
          }
        } else if (command === 0x03) {
          const [permit] = decodeAbiParameters(PERMIT_BATCH, input)
          checkSpender(permit.spender, at)
          for (const detail of permit.details) plan.permits.push({ token: getAddress(detail.token), spender: getAddress(permit.spender), amount: detail.amount })
        } else if (command === 0x0a) {
          const [permit] = decodeAbiParameters(PERMIT_SINGLE, input)
          checkSpender(permit.spender, at)
          plan.permits.push({ token: getAddress(permit.details.token), spender: getAddress(permit.spender), amount: permit.details.amount })
        } else if (command === 0x04) {
          const [token, recipient, amountMin] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, input)
          const asset = assetOf(token)
          const drawn = drawAll(asset)
          route(asset, recipient, drawn.floor > amountMin ? drawn.floor : amountMin, drawn.exact, 'sweep')
        } else if (command === 0x05) {
          const [token, recipient, value] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, input)
          const asset = assetOf(token)
          if (value === CONTRACT_BALANCE) {
            const drawn = drawAll(asset)
            route(asset, recipient, drawn.floor, drawn.exact, 'transfer')
          } else {
            drawExact(asset, value)
            route(asset, recipient, value, true, 'transfer')
          }
        } else if (command === 0x06 || (command === 0x07 && version === '2.1')) {
          const [token, recipient, portion] = decodeAbiParameters(TOKEN_RECIPIENT_AMOUNT, input)
          const asset = assetOf(token)
          const whole = command === 0x06 ? 10_000n : 10n ** 18n
          drawShare(asset, portion >= whole ? 0n : whole - portion, whole)
          route(asset, recipient, 0n, false, 'portion')
        } else if (command === 0x0b) {
          const [recipient, amount] = decodeAbiParameters(RECIPIENT_AMOUNT, input)
          const drawn = amount === CONTRACT_BALANCE ? drawAll(NATIVE) : { floor: amount, exact: true }
          if (amount !== CONTRACT_BALANCE) drawExact(NATIVE, amount)
          if (plan.produced.has(NATIVE)) plan.produced.add(wrapped)
          route(wrapped, recipient, drawn.floor, drawn.exact, 'wrap')
        } else if (command === 0x0c) {
          const [recipient, amountMin] = decodeAbiParameters(RECIPIENT_AMOUNT, input)
          if (plan.produced.has(wrapped)) plan.produced.add(NATIVE)
          const drawn = drawAll(wrapped)
          route(NATIVE, recipient, drawn.floor > amountMin ? drawn.floor : amountMin, drawn.exact, 'unwrap')
        } else if (command === 0x0e) {
          return
        } else if (command === 0x10) {
          v4(input, at)
        } else if (command === 0x11 || command === 0x12 || command === 0x14) {
          refuse('LIQUIDITY_NOT_ADMITTED', `command ${hex(command)} at ${at} manages a liquidity position; LP positions are not yet valued, so providing liquidity is not admitted`)
        } else if (command === 0x13) {
          refuse('POOL_INIT_NOT_ADMITTED', `command ${hex(command)} at ${at} initializes a V4 pool; an account trades in existing pools only`)
        } else if (command === 0x21) {
          const [subCommands, subInputs] = decodeAbiParameters(COMMANDS_INPUTS, input)
          run(subCommands, subInputs, `${at}.`)
        } else if (command === 0x40 && version === '2.1') {
          refuse('BRIDGE_NOT_ADMITTED', `command ${hex(command)} at ${at} bridges the output to another chain through Across; bridge through the account's own withdraw instead`)
        } else {
          refuse('COMMAND_NOT_ADMITTED', `command ${hex(command)} at ${at} is not a Universal Router ${version} command`)
        }
      } catch (err) {
        refuse('UNDECODABLE_COMMAND', `command ${hex(command)} at ${at} does not decode: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
    })
  }

  let decoded: DecodeFunctionDataReturnType<typeof ROUTER_ABI>
  try {
    decoded = decodeFunctionData({ abi: ROUTER_ABI, data: call.callData })
  } catch {
    refuse('ROUTER_FN_FORBIDDEN', `Universal Router call ${call.callData.slice(0, 10)} is not execute; signed and other entry points are not admitted`)
    return plan
  }
  if (call.value > 0n) {
    spend(NATIVE, call.value)
    park(NATIVE, call.value, true)
  }
  run(decoded.args[0], decoded.args[1], '')
  for (const [token, left] of held) if (left.exact && left.floor === 0n) held.delete(token)
  return plan
}
