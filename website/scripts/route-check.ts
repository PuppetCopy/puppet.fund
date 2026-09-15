import { CHAIN_NETWORK_MAP, CHAIN_TOKEN_MAP, PROTOCOL, SWAP_PROVIDER } from '@puppet/contracts/const'
import deployments from '@puppet/contracts/deployments'
import type { ChainId } from '@puppet/sdk/const'
import { DEFAULT_EVALUATION_CONFIG } from '@puppet/sdk/evaluate'
import {
  ACROSS_PERIPHERY,
  deliveredLeg,
  type IAcrossTiming,
  type IRoutePlan,
  quoteSwapRoutes,
  readAcrossBuffers
} from '@puppet/sdk/intent'
import { symbolOf } from '@puppet/sdk/state'
import { type Address, createPublicClient, http } from 'viem'
import { readContract } from 'viem/actions'

const required = (name: string): string => {
  const value = Bun.env[name]
  if (!value) throw new Error(`route-check: ${name} is not set; add it to puppet.fund/website/.env`)
  return value
}

const RPC_URL = required('RPC_URL')
const RPC_KEY_WEBSITE = required('RPC_KEY_WEBSITE')
const ACROSS_INTEGRATOR_ID = required('ACROSS_INTEGRATOR_ID')
const LIFI_API_KEY = Bun.env.LIFI_API_KEY

const ACCOUNT: Address = '0x78305f62c2a0e16D82fD09928f7B4DDe21922368'
const HUB: ChainId = 143
const ARB: ChainId = 42161

const proxy = Bun.serve({
  port: 0,
  idleTimeout: 60,
  fetch: async request => {
    const url = new URL(request.url)
    const relay = async (upstream: URL, headers: Record<string, string>): Promise<Response> => {
      try {
        const res = await fetch(upstream, { headers })
        return new Response(await res.text(), {
          status: res.status,
          headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' }
        })
      } catch (err) {
        const message = `route-check upstream ${upstream.host} unreachable: ${err instanceof Error ? err.message : String(err)}`
        return new Response(JSON.stringify({ message }), {
          status: 502,
          headers: { 'content-type': 'application/json' }
        })
      }
    }
    if (url.pathname.startsWith('/api/swap/across')) {
      const upstream = new URL(`https://app.across.to${url.pathname.replace(/^\/api\/swap\/across/, '/api')}`)
      upstream.search = url.search
      upstream.searchParams.set('integratorId', ACROSS_INTEGRATOR_ID)
      return relay(upstream, { accept: 'application/json' })
    }
    if (url.pathname.startsWith('/api/swap/lifi')) {
      const upstream = new URL(`https://li.quest${url.pathname.replace(/^\/api\/swap\/lifi/, '')}`)
      upstream.search = url.search
      return relay(
        upstream,
        LIFI_API_KEY ? { accept: 'application/json', 'x-lifi-api-key': LIFI_API_KEY } : { accept: 'application/json' }
      )
    }
    return new Response(`route-check proxy has no upstream for ${url.pathname}`, { status: 404 })
  }
})

const base = `http://localhost:${proxy.port}`
const ENDPOINTS = { lifi: base, across: base }

const clientFor = (chainId: ChainId) =>
  createPublicClient({ transport: http(`${RPC_URL}/${CHAIN_NETWORK_MAP[chainId]}/${RPC_KEY_WEBSITE}`) })

const timingCache = new Map<number, Promise<IAcrossTiming>>()
const timingFor = (chainId: ChainId) => (): Promise<IAcrossTiming> => {
  let pending = timingCache.get(chainId)
  if (!pending) {
    pending = readAcrossBuffers(clientFor(chainId), chainId).then(buffers => ({
      ...buffers,
      fillMargin: Number(PROTOCOL.maxIntentTtlSec)
    }))
    timingCache.set(chainId, pending)
  }
  return pending
}

const token = (chainId: ChainId, key: string): Address => {
  const address = (CHAIN_TOKEN_MAP[chainId] as Record<string, Address> | undefined)?.[key]
  if (!address) throw new Error(`route-check: no ${key} on chain ${chainId}`)
  return address
}

interface IJourney {
  name: string
  originChainId: ChainId
  destinationChainId: ChainId
  inputKey: string
  outputKey: string
  inputAmount: bigint
  maxLegs: number
  expect: 'viable' | 'gap'
  gap?: string
}

const WETH_IN = 89593282301017988n
const USDC_IN = 25000000n

const JOURNEYS: IJourney[] = [
  { name: 'deposit ARB WETH -> MON WETH', originChainId: ARB, destinationChainId: HUB, inputKey: 'WETH', outputKey: 'WETH', inputAmount: WETH_IN, maxLegs: 2, expect: 'viable' },
  { name: 'deposit ARB WETH -> MON USDC', originChainId: ARB, destinationChainId: HUB, inputKey: 'WETH', outputKey: 'USDC', inputAmount: WETH_IN, maxLegs: 2, expect: 'viable' },
  { name: 'deposit ARB USDC -> MON USDC', originChainId: ARB, destinationChainId: HUB, inputKey: 'USDC', outputKey: 'USDC', inputAmount: USDC_IN, maxLegs: 2, expect: 'viable' },
  {
    name: 'fund ARB USDC -> MON WETH',
    originChainId: ARB,
    destinationChainId: HUB,
    inputKey: 'USDC',
    outputKey: 'WETH',
    inputAmount: USDC_IN,
    maxLegs: 1,
    expect: 'gap',
    gap: 'the Fund editor runs maxLegs 1 so there is no composed fallback, and the single-leg route is the unscreened SpokePool arrival-swap shape; this is what a user funding a WETH fund with USDC hits'
  },
  { name: 'deposit ARB WETH -> MON WMON', originChainId: ARB, destinationChainId: HUB, inputKey: 'WETH', outputKey: 'WMON', inputAmount: WETH_IN, maxLegs: 2, expect: 'viable' },
  { name: 'withdraw MON WETH -> ARB WETH', originChainId: HUB, destinationChainId: ARB, inputKey: 'WETH', outputKey: 'WETH', inputAmount: WETH_IN, maxLegs: 1, expect: 'viable' },
  {
    name: 'withdraw MON USDC -> ARB WETH',
    originChainId: HUB,
    destinationChainId: ARB,
    inputKey: 'USDC',
    outputKey: 'WETH',
    inputAmount: USDC_IN,
    maxLegs: 1,
    expect: 'gap',
    gap: 'input is already the bridge asset, so Across returns a plain SpokePool deposit (0xad5425c6) with an arrival-side swap instead of a periphery swapAndBridge; we only screen the swapAndBridge shape'
  },
  { name: 'withdraw MON USDC -> ARB USDC', originChainId: HUB, destinationChainId: ARB, inputKey: 'USDC', outputKey: 'USDC', inputAmount: USDC_IN, maxLegs: 1, expect: 'viable' },
  { name: 'fundSwap ARB WETH -> MON WETH', originChainId: ARB, destinationChainId: HUB, inputKey: 'WETH', outputKey: 'WETH', inputAmount: WETH_IN, maxLegs: 3, expect: 'viable' },
  { name: 'fundSwap ARB WETH -> MON USDC', originChainId: ARB, destinationChainId: HUB, inputKey: 'WETH', outputKey: 'USDC', inputAmount: WETH_IN, maxLegs: 3, expect: 'viable' }
]

const MAX_LOSS_BPS = DEFAULT_EVALUATION_CONFIG.swapMaxSlippageBps

const lossBps = (inputAmount: bigint, plan: IRoutePlan): bigint => {
  const out = plan[plan.length - 1]?.outputAmount ?? 0n
  return ((inputAmount - out) * 10_000n) / inputAmount
}

const describe = (plan: IRoutePlan): string =>
  [
    `${plan[0].route.kind}@${plan[0].chainId}->${plan[0].destinationChainId}`,
    ...plan.slice(1).map(leg => `${leg.tool}@${leg.chainId}->${leg.destinationChainId}`)
  ].join(' + ')

let pinFailures = 0

for (const chainId of [ARB, HUB] as const) {
  const providers = SWAP_PROVIDER[chainId] as Record<string, Address>
  const register = (deployments as Record<string, { address: Address; abi: readonly unknown[] }>)[`Register:${chainId}`]
  for (const [name, address] of Object.entries(providers)) {
    if (name === 'acrossSpokePool') continue
    const cap = (await readContract(clientFor(chainId), {
      address: register.address,
      abi: register.abi as never,
      functionName: 'providerCapMap',
      args: [address]
    })) as bigint
    if (cap === 0n) {
      console.log(`  PIN FAIL chain ${chainId} ${name} ${address} is pinned but NOT whitelisted on-chain`)
      pinFailures++
    } else {
      console.log(`  pin ok   chain ${chainId} ${name} ${address} whitelisted`)
    }
  }
}
console.log(`  pin ok   ACROSS_PERIPHERY ${ACROSS_PERIPHERY} (quotes are refused by the SDK if Across returns another)`)

const PACE_MS = Number(Bun.env.ROUTE_CHECK_PACE_MS ?? 1500)
const only = Bun.env.ROUTE_CHECK_ONLY
const selected = only ? JOURNEYS.filter(j => j.name.includes(only)) : JOURNEYS
if (selected.length === 0) throw new Error(`route-check: ROUTE_CHECK_ONLY=${only} matched no journey`)

let failures = 0

for (const journey of selected) {
  await Bun.sleep(PACE_MS)
  const bounds = {
    chainId: journey.originChainId,
    destinationChainId: BigInt(journey.destinationChainId),
    inputToken: token(journey.originChainId, journey.inputKey),
    outputToken: token(journey.destinationChainId, journey.outputKey),
    inputAmount: journey.inputAmount
  }
  const candidates = quoteSwapRoutes(
    ENDPOINTS,
    ACCOUNT,
    ACCOUNT,
    bounds,
    timingFor(journey.originChainId),
    journey.maxLegs
  )
  const settled = await Promise.all(
    candidates.map(async candidate => {
      try {
        return { id: candidate.id, plan: await candidate.plan, error: null as string | null }
      } catch (err) {
        return { id: candidate.id, plan: null, error: err instanceof Error ? err.message : String(err) }
      }
    })
  )
  const ok = settled.filter((r): r is { id: string; plan: IRoutePlan; error: null } => r.plan !== null)
  const priced = ok
    .map(r => ({ ...r, bps: lossBps(journey.inputAmount, r.plan) }))
    .sort((a, b) =>
      a.plan.length !== b.plan.length
        ? a.plan.length - b.plan.length
        : deliveredLeg(b.plan).outputAmount > deliveredLeg(a.plan).outputAmount
          ? 1
          : -1
    )
  const signable = priced.filter(r => r.bps <= MAX_LOSS_BPS)

  console.log(`\n${journey.name}  (maxLegs ${journey.maxLegs})`)
  for (const r of settled) {
    const found = priced.find(p => p.id === r.id)
    if (found) {
      const comparable = journey.inputKey === journey.outputKey
      const mark = !comparable ? 'ok  ' : found.bps <= MAX_LOSS_BPS ? 'ok  ' : 'OVER'
      const cost = comparable ? `${String(found.bps).padStart(5)}bps` : `${String(found.plan[found.plan.length - 1]!.outputAmount).padStart(8)} out`
      console.log(`  ${mark} ${r.id.padEnd(11)} ${cost}  ${describe(found.plan)}`)
    } else {
      console.log(`  err  ${r.id.padEnd(11)} ${r.error?.slice(0, 96)}`)
    }
  }

  const sameAsset = journey.inputKey === journey.outputKey
  const best = sameAsset ? (signable[0]?.id === priced[0]?.id ? priced[0] : signable[0]) : priced[0]
  if (journey.expect === 'viable') {
    if (!best) {
      console.log(
        sameAsset
          ? `  FAIL expected a signable route, none within ${MAX_LOSS_BPS}bps`
          : '  FAIL expected a route, none quoted'
      )
      failures++
    } else {
      const first = best.plan[0]
      const originSideFirst = first.route.kind === 'swap' && BigInt(journey.originChainId) !== BigInt(journey.destinationChainId)
      const bridgeToken =
        journey.maxLegs < 3 || best.plan.length === 1
          ? null
          : first.route.kind === 'across'
            ? first.inputToken
            : first.outputToken
      let broken: string | null = null
      if (originSideFirst && journey.maxLegs < 3) {
        broken = 'plan[0] is same-chain; this flow signs plan[0] as the cross-chain leg'
      } else if (bridgeToken !== null) {
        try {
          symbolOf(journey.originChainId, bridgeToken)
        } catch {
          broken = `bridgeToken ${bridgeToken} does not resolve on the origin chain ${journey.originChainId}`
        }
      }
      const singleLegAvailable = priced.some(r => r.plan.length === 1)
      if (best.plan.length > 1 && singleLegAvailable) {
        broken =
          `selected a ${best.plan.length}-leg route while a single-leg route quoted; multi-leg costs ~10x in relay fees (see memory no-multileg-crosschain-route)`
      }
      if (broken) {
        console.log(`  FAIL ${broken}`)
        failures++
      } else {
        console.log(
          sameAsset
            ? `  PASS via ${best.id} at ${best.bps}bps`
            : `  PASS via ${best.id} (cross-asset: loss not comparable without a price, availability only)`
        )
      }
    }
  } else if (best) {
    console.log(`  FAIL known gap now has a route via ${best.id}; delete the gap entry`)
    failures++
  } else {
    console.log(`  GAP  ${journey.gap}`)
  }
}

proxy.stop(true)
console.log(`\n${failures + pinFailures === 0 ? 'route-check passed' : `route-check FAILED (${failures + pinFailures})`}`)
process.exit(failures + pinFailures === 0 ? 0 : 1)
