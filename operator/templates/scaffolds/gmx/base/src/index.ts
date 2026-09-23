import { createConnector, runOperator } from '@puppet.fund/operator'
import { gmxOperator } from '@puppet.fund/operator/gmx'

// The bare starting point: two handles, three layers. `connector` is the established connection
// to Puppet: your identity (connector.account, the puppet account that signs and holds what you
// deposit), the relay, and the lifecycle. `gmx` is the venue operator built on it: it internally
// establishes a chain-bound operator for your trading account (RPC client, balance reads, the
// generic allocate()/convert()/operate()/poolSwap()/redeem() dispatch) and exposes it as
// `gmx.operator`; the attestor co-signs only GMX-perimeter calls today, so arbitrary targets
// are rejected. One connector can back venue operators on several chains. There is no required
// shape; a poll loop, a one-shot, a webhook, or an event subscription all work.
//
// `bun run dev` prints a pairing link: approve it on the site, and the sealed session carries
// everything: your in-memory session key, the trading account you selected on the site (its name
// and network terms), the matchmaker and oracle endpoints, and the token registry. PAIR_URL
// points at a local dev site; .env names the chronicle and the Arbitrum and Optimism (hub) RPC
// endpoints (set your own RPC beyond a first run). The operator can open and
// manage positions within the rules you signed, but can never withdraw.
if (!Bun.env.CHRONICLE_URL || !Bun.env.ARBITRUM_RPC_URL || !Bun.env.OPTIMISM_RPC_URL) {
  throw new Error('set CHRONICLE_URL, ARBITRUM_RPC_URL and OPTIMISM_RPC_URL in .env (cp .env.example .env)')
}
const connector = await createConnector({ pairUrl: Bun.env.PAIR_URL, chronicleUrl: Bun.env.CHRONICLE_URL })
const gmx = await gmxOperator(connector, {
  rpcUrl: Bun.env.ARBITRUM_RPC_URL,
  hubRpcUrl: Bun.env.OPTIMISM_RPC_URL,
  token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
})

await runOperator(connector, async signal => {
  // ── YOUR OPERATOR ──────────────────────────────────────────────────────────────────────
  // Replace this block. Everything is connected and ready:
  //   connector     account / signer identity · close() (runOperator handles it)
  //   gmx.operator  account (your trading account: positions live under it, and collateral freed
  //                 by a close returns here on its own) · readBalance(token) · allocate(contribution)
  //                 · convert(inputToken, outputToken, inputAmount) · operate(callList)
  //                 · poolSwap(inputToken, outputToken, inputAmount, destinationChainId) · redeem(retire, drain)
  //   gmx           createOrder(order) · cancelOrder · updateOrder · getPositions(account?)
  //                 · getOrders(account?) · getMarket(indexToken) · markets
  // createOrder is the one primitive for every order type (orderType + triggerPrice). The
  // usd() / gmxPrice() helpers from '@puppet.fund/operator/gmx' build amounts; viem's
  // parseEther() builds 18dp WETH amounts.
  //
  // The relay is fire-and-ACK: it acks a dispatch and stays silent otherwise, so a failed/timed-out
  // dispatch may STILL land until its intent deadline (~5min). There is no connection state to gate
  // on: just attempt the operate and handle a thrown DISPATCH_TIMEOUT; arm your cooldowns on attempt
  // (not success) and hold off re-firing until that window has passed.
  //
  // Common shapes, pick one:
  //   poll loop : while (!signal.aborted) { /* decide + act */ await Bun.sleep(15_000) }
  //   one-shot  : do work, then return; runOperator closes the connection and the process exits
  //   event     : subscribe to a source, then await the signal to stay alive
  //
  // Prefer a ready strategy? Scaffold a different variant: gmx/copy-trader, gmx/trend, gmx/llm-basic.
  console.log(`operator ready: trading account ${gmx.operator.account}. Write your strategy. Ctrl-C to stop.`)
  await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
})
