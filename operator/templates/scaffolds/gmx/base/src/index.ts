import { createOperatorCore, pairOverBrowser, runOperator } from '@puppet.fund/operator'
import { gmxOperator } from '@puppet.fund/operator/gmx'

// The bare starting point — two pieces, composed. `core` is the connection: your identity
// (core.account, the account that signs) and your fund (core.fund, the pooled vehicle that
// holds capital and carries positions), lifecycle, and the generic operate() dispatch (the
// attestor co-signs only GMX-perimeter calls today, so arbitrary targets are rejected).
// `gmx` is the venue layer built on it: orders + market/position reads. You hold both —
// call connection/account actions on `core`, GMX actions on `gmx`. There is no required
// shape; a poll loop, a one-shot, a webhook, or an event subscription all work.
//
// `bun run dev` prints a pairing link — approve it on the site, and the sealed session carries
// everything: your in-memory session key, your fund identity and its base token, the matchmaker
// endpoint, and the token registry. PAIR_URL points at a local dev site; RPC defaults to the
// public Arbitrum endpoint (set ARBITRUM_RPC_URL beyond a first run). The operator can open and
// manage positions within the rules you signed, but can never withdraw.
const session = await pairOverBrowser(Bun.env.PAIR_URL)
const core = await createOperatorCore(session, { rpcUrl: Bun.env.ARBITRUM_RPC_URL })
const gmx = gmxOperator(core)

await runOperator(core, async signal => {
  // ── YOUR OPERATOR ──────────────────────────────────────────────────────────────────────
  // Replace this block. Everything is connected and ready:
  //   core   getFundBalance() (deployable base in the fund — collateral freed by a close
  //          returns here on its own and the next order re-signs it automatically)
  //          · getFundSignedBalance() · isOpen() · status · operate(callList, transferList?)
  //   gmx    createOrder(order) · cancelOrder · updateOrder · getPositions(account?)
  //          · getOrders(account?) · getMarket(indexToken) · markets
  // createOrder is the one primitive for every order type (orderType + triggerPrice). The
  // usd() / weth() / gmxPrice() helpers from '@puppet.fund/operator/gmx' build amounts. Gate
  // any trading on core.isOpen() so you skip ticks while the matchmaker reconnects.
  //
  // The relay never replies with errors — it acks dispatches and stays silent otherwise, so
  // a failed/timed-out dispatch may STILL land until its intent deadline (~5min). Arm your
  // cooldowns on attempt (not success) and hold off re-firing until that window has passed.
  //
  // Common shapes — pick one:
  //   poll loop : while (!signal.aborted) { if (core.isOpen()) { /* decide + act */ } await Bun.sleep(15_000) }
  //   one-shot  : do work, then return — runOperator closes the connection and the process exits
  //   event     : subscribe to a source, then await the signal to stay alive
  //
  // Prefer a ready strategy? Scaffold a different variant: gmx/copy-trader, gmx/trend, gmx/llm-basic.
  console.log(`operator ready — fund ${core.fund}, signer ${core.signer}. Write your strategy. Ctrl-C to stop.`)
  await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
})
