import { createOperatorCore, runOperator } from '@puppet.fund/operator'
import { GMX_BASE_TOKEN_ID, gmxOperator } from '@puppet.fund/operator/gmx'
import type { Address, Hex } from 'viem'

// The bare starting point — two pieces, composed. `core` is the connection: identity,
// account state, lifecycle, the generic operate() escape hatch, and signedBalance
// recognition. `gmx` is the venue layer built on it: orders + market/position reads. You
// hold both — call connection/account actions on `core`, GMX actions on `gmx`. There is no
// required shape; a poll loop, a one-shot, a webhook, or an event subscription all work.
//
// `bun run dev` prints a pairing link — approve it on the site; the core then holds your
// session key (in memory) and the site's endpoints. Everything below is an optional .env
// override (point at a local site, use your own endpoints, or run headless). The operator can
// open and manage positions within the rules you signed, but can never withdraw.
const core = await createOperatorCore({
  baseTokenId: GMX_BASE_TOKEN_ID,
  siteUrl: Bun.env.SITE_URL,
  matchmakerUrl: Bun.env.MATCHMAKER_WS_URL,
  indexerUrl: Bun.env.INDEXER_ENDPOINT,
  rpcUrl: Bun.env.ARBITRUM_RPC_URL,
  signerKey: Bun.env.OPERATOR_SIGNER_KEY as Hex | undefined,
  user: Bun.env.OPERATOR_USER as Address | undefined,
  pairPort: Bun.env.PAIR_PORT ? Number(Bun.env.PAIR_PORT) : undefined
})
const gmx = gmxOperator(core)

await runOperator(core, async signal => {
  // ── YOUR OPERATOR ──────────────────────────────────────────────────────────────────────
  // Replace this block. Everything is connected and ready:
  //   core   getAccountState() · isOpen() · status · operate(calls, amounts)
  //          · recordReturnedBalance() / getUnrecognizedBalance()  (recognize base GMX
  //            returns after a close, else the next outflow eventually reverts)
  //   gmx    createOrder(order) · cancelOrder · updateOrder · getPositions(account?)
  //          · getOrders(account?) · getMarket(indexToken) · markets
  // createOrder is the one primitive for every order type (orderType + triggerPrice). The
  // usd() / weth() / gmxPrice() helpers from '@puppet.fund/operator/gmx' build amounts. Gate
  // any trading on core.isOpen() so you skip ticks while the matchmaker reconnects.
  //
  // Common shapes — pick one:
  //   poll loop : while (!signal.aborted) { if (core.isOpen()) { /* decide + act */ } await Bun.sleep(15_000) }
  //   one-shot  : do work, then return — runOperator closes the connection and the process exits
  //   event     : subscribe to a source, then await the signal to stay alive
  //
  // Prefer a ready strategy? Scaffold a different variant: gmx/copy-trader, gmx/trend, gmx/llm-basic.
  console.log(`operator ready — master ${core.master}, signer ${core.signer}. Write your strategy. Ctrl-C to stop.`)
  await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
})
