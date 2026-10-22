import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, type DecodeFunctionDataReturnType, decodeFunctionData, getAddress, isAddress, isAddressEqual } from 'viem'
import type { ChainId } from '../../const/index.js'
import { wrappedNativeAddressOf } from '../../state/tokenRegistry.js'
import { decodeErc20 } from '../erc20.js'
import type { IGuardReason, IOperateStep, IVenue } from '../types.js'
import { type IUniswapDeployment, PERMIT2_ABI, PERMIT2_ALLOWANCE_TYPES, PERMIT2_DOMAIN_NAME, UNISWAP_DEPLOYMENTS, UNISWAP_PLATFORM } from './contracts.js'
import { MSG_SENDER, planRouterCall } from './router.js'

const routerOf = (deployment: IUniswapDeployment, target: Address) => deployment.routerList.find(router => isAddressEqual(router.address, target))

const permitsToPermit2 = (deployment: IUniswapDeployment, call: IIAccount__Call): boolean => {
  const dec = decodeErc20(call.callData)
  return dec?.functionName === 'approve' && isAddressEqual(dec.args[0], deployment.permit2)
}

const UNISWAP_CHAINS = Object.keys(UNISWAP_DEPLOYMENTS).map(chainId => Number(chainId) as ChainId)

export const uniswapVenue: IVenue = {
  venueId: UNISWAP_PLATFORM,
  name: 'Uniswap',
  chains: UNISWAP_CHAINS,
  dapp: { hosts: ['uniswap.org'], chains: UNISWAP_CHAINS },
  contracts: Object.entries(UNISWAP_DEPLOYMENTS).flatMap(([chainId, deployment]) => [
    ...deployment.routerList.map(router => ({
      chainId: Number(chainId) as ChainId,
      address: router.address,
      name: `Uniswap Universal Router ${router.version}`,
      detail: 'swaps through Uniswap pools, paying only from its caller'
    })),
    { chainId: Number(chainId) as ChainId, address: deployment.permit2, name: 'Permit2', detail: 'moves tokens for the routers the account permits', pullsTokens: true }
  ]),
  claims(ctx, call) {
    const deployment = UNISWAP_DEPLOYMENTS[ctx.chainId]
    if (deployment === undefined) return false
    return routerOf(deployment, call.target) !== undefined || isAddressEqual(call.target, deployment.permit2) || permitsToPermit2(deployment, call)
  },
  screen(ctx, call) {
    const deployment = UNISWAP_DEPLOYMENTS[ctx.chainId]!
    if (isAddressEqual(call.target, deployment.permit2)) {
      let dec: DecodeFunctionDataReturnType<typeof PERMIT2_ABI>
      try {
        dec = decodeFunctionData({ abi: PERMIT2_ABI, data: call.callData })
      } catch {
        return [{ code: 'PERMIT2_FN_FORBIDDEN', detail: `Permit2 call ${call.callData.slice(0, 10)} is not approve; only a Permit2 allowance to a Universal Router is admitted` }]
      }
      const spender = dec.args[1]
      const reasons: IGuardReason[] = []
      if (routerOf(deployment, spender) === undefined) {
        reasons.push({ code: 'PERMIT_SPENDER_NOT_ROUTER', detail: `Permit2 approve names spender ${spender}; only a pinned Universal Router may be permitted` })
      }
      if (call.value !== 0n) reasons.push({ code: 'NATIVE_VALUE_FORBIDDEN', detail: `Permit2 approve forwards native value ${call.value}` })
      return reasons
    }
    const router = routerOf(deployment, call.target)
    if (router === undefined) {
      return call.value === 0n ? [] : [{ code: 'NATIVE_VALUE_FORBIDDEN', detail: `approve call to ${call.target} forwards native value ${call.value}` }]
    }
    const plan = planRouterCall(deployment, wrappedNativeAddressOf(ctx.chainId), router, call)
    const reasons = [...plan.refusals]
    const floors = new Map<Address, bigint>()
    for (const delivery of plan.deliveries) {
      if (isAddressEqual(delivery.to, MSG_SENDER) || isAddressEqual(delivery.to, ctx.account)) {
        floors.set(delivery.token, (floors.get(delivery.token) ?? 0n) + delivery.floor)
      } else if (delivery.via === 'portion') {
        reasons.push({
          code: 'FEE_RECIPIENT_NOT_PINNED',
          detail: `a ${delivery.via} of ${delivery.token} goes to ${delivery.to}, which is not a pinned Uniswap fee address; the screen cannot tell who controls it`
        })
      } else {
        reasons.push({ code: 'RECIPIENT_NOT_ACCOUNT', detail: `a ${delivery.via} delivers ${delivery.token} to ${delivery.to}; every recipient must be the account ${ctx.account}` })
      }
    }
    for (const [token, floor] of floors) {
      if (floor === 0n && plan.produced.has(token) && !plan.spent.has(token)) {
        reasons.push({ code: 'MIN_OUT_ZERO', detail: `${token} arrives with no minimum amount, so the trade carries no price bound` })
      }
    }
    for (const [token, left] of plan.stranded) {
      reasons.push({
        code: 'ROUTER_BALANCE_STRANDED',
        detail: `${left.exact ? left.floor : `at least ${left.floor}`} of ${token} is left at the router after the call, where anyone can sweep it; the call must sweep it back to the account`
      })
    }
    return reasons
  },
  outflows: () => [],
  grants(chainId, call) {
    const deployment = UNISWAP_DEPLOYMENTS[chainId]
    if (deployment === undefined) return []
    if (isAddressEqual(call.target, deployment.permit2)) {
      const dec = decodeFunctionData({ abi: PERMIT2_ABI, data: call.callData })
      const [token, spender, amount] = dec.args
      return [{ ledger: getAddress(deployment.permit2), token: getAddress(token), spender: getAddress(spender), amount }]
    }
    const router = routerOf(deployment, call.target)
    if (router === undefined) return []
    return planRouterCall(deployment, wrappedNativeAddressOf(chainId), router, call).permits.map(permit => ({ ledger: getAddress(deployment.permit2), ...permit }))
  },
  exchange(chainId, account, call) {
    const deployment = UNISWAP_DEPLOYMENTS[chainId]
    const router = deployment === undefined ? undefined : routerOf(deployment, call.target)
    if (deployment === undefined || router === undefined) return { spent: [], received: [] }
    const plan = planRouterCall(deployment, wrappedNativeAddressOf(chainId), router, call)
    const received = new Map<Address, bigint>()
    for (const delivery of plan.deliveries) {
      if (isAddressEqual(delivery.to, MSG_SENDER) || isAddressEqual(delivery.to, account)) {
        received.set(delivery.token, (received.get(delivery.token) ?? 0n) + delivery.floor)
      }
    }
    return {
      spent: [...plan.spent].map(([token, amount]) => ({ token, amount })),
      received: [...received].map(([token, amount]) => ({ token, amount }))
    }
  },
  describe(chainId, _account, callList) {
    const out = new Map<number, IOperateStep[]>()
    const deployment = UNISWAP_DEPLOYMENTS[chainId]
    if (deployment === undefined) return out
    callList.forEach((call, i) => {
      if (isAddressEqual(call.target, deployment.permit2)) {
        let dec: DecodeFunctionDataReturnType<typeof PERMIT2_ABI>
        try {
          dec = decodeFunctionData({ abi: PERMIT2_ABI, data: call.callData })
        } catch {
          return
        }
        const [token, spender, amount] = dec.args
        out.set(i, [{ kind: 'approve', token: getAddress(token), spender: getAddress(spender), amount }])
        return
      }
      const router = routerOf(deployment, call.target)
      if (router === undefined) return
      const plan = planRouterCall(deployment, wrappedNativeAddressOf(chainId), router, call)
      const received = new Map<Address, bigint>()
      for (const delivery of plan.deliveries) received.set(delivery.token, (received.get(delivery.token) ?? 0n) + delivery.floor)
      out.set(i, [
        {
          kind: 'venue',
          venueId: UNISWAP_PLATFORM,
          key: null,
          call: 'execute',
          label: 'Swap',
          fields: [],
          flows: [...plan.spent].map(([token, amount]) => ({ token, delta: -amount, exact: false })).concat([...received].map(([token, amount]) => ({ token, delta: amount, exact: false }))),
          fees: []
        }
      ])
    })
    return out
  },
  typedData(_account, typedData) {
    const verifying = typedData.domain?.verifyingContract
    if (verifying === undefined || !isAddress(verifying)) return null
    if (!Object.values(UNISWAP_DEPLOYMENTS).some(deployment => isAddressEqual(deployment.permit2, verifying))) return null
    const deployment = UNISWAP_DEPLOYMENTS[Number(typedData.domain?.chainId) as ChainId]
    if (deployment === undefined || !isAddressEqual(deployment.permit2, verifying) || typedData.domain?.name !== PERMIT2_DOMAIN_NAME) {
      return [
        {
          code: 'DAPP_DOMAIN_NOT_ADMITTED',
          detail: `a Permit2 signature for chain ${String(typedData.domain?.chainId)} under name ${typedData.domain?.name ?? '(none)'} is not admitted; Permit2 is admitted on ${Object.keys(UNISWAP_DEPLOYMENTS).join(', ')} under name ${PERMIT2_DOMAIN_NAME}`
        }
      ]
    }
    if (!PERMIT2_ALLOWANCE_TYPES.has(typedData.primaryType)) {
      return [
        {
          code: 'DAPP_ACTION_NOT_ADMITTED',
          detail: `a Permit2 ${typedData.primaryType} lets whoever holds the signature pull the tokens outside any account transaction, which is how UniswapX orders are filled; turn off UniswapX in the Uniswap app's swap settings and swap through the Universal Router`
        }
      ]
    }
    const spender = typedData.message.spender
    if (typeof spender !== 'string' || !isAddress(spender) || routerOf(deployment, spender) === undefined) {
      return [{ code: 'DAPP_ACTION_NOT_ADMITTED', detail: `a Permit2 ${typedData.primaryType} names spender ${String(spender)}; only a pinned Universal Router may be permitted` }]
    }
    return []
  },
  message: () => null
}
