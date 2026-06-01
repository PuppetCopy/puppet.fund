import { gmxOperator } from '@puppet.fund/operator/gmx'

// GMX runs on a WETH account (collateral and the keeper fee are the same token),
// so create and fund a WETH account on the site first. `bun run dev` prints a
// pairing link; the site hands over its matchmaker/indexer/rpc endpoints and your
// session key (in memory only), so there's nothing else to configure.
//
// Advanced (optional): pass siteUrl to pair against a local site, matchmakerUrl/
// indexerUrl/rpcUrl to use your own endpoints, or signerKey + user to run headless.
const gmx = await gmxOperator()

const intervalMs = Number(Bun.env.LOOP_INTERVAL_MS ?? 15_000)
// ETH perp market — its index token is WETH on Arbitrum. Pass a different index
// token to trade another market (collateral is always your WETH base).
const ethMarket = gmx.getMarket('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1')

console.log(`[operator] master=${gmx.master} signer=${gmx.signer} ethMarket=${ethMarket}`)

while (true) {
  try {
    const account = await gmx.getAccountState()
    const positions = await gmx.getPositions()
    console.log(`[operator] signedBalance=${account.signedBalance} positions=${positions.length}`)

    // Your strategy goes here. Read account state + positions, then act. Opening is an
    // increase from zero; a full close is a decrease by the position's whole size.
    //
    //   if (positions.length === 0 && account.signedBalance > 10_000_000_000_000_000n) {
    //     await gmx.createOrder({
    //       orderType: gmx.GMX_ORDER_TYPE.MarketIncrease,
    //       market: ethMarket,
    //       isLong: true,
    //       collateralDelta: 5_000_000_000_000_000n,                  // 0.005 WETH (18 dp)
    //       sizeDeltaUsd: 30_000_000_000_000_000_000_000_000_000_000n, // 30 USD (30 dp)
    //       executionFee: 500_000_000_000_000n                        // 0.0005 WETH (18 dp)
    //     })
    //   } else if (positions.length > 0) {
    //     const pos = positions[0]
    //     await gmx.createOrder({
    //       orderType: gmx.GMX_ORDER_TYPE.MarketDecrease,
    //       market: ethMarket,
    //       isLong: true,
    //       collateralDelta: 0n,
    //       sizeDeltaUsd: pos.numbers.sizeInUsd,                       // full size = close
    //       executionFee: 500_000_000_000_000n
    //     })
    //   }
  } catch (err) {
    console.error('[operator] tick failed:', err instanceof Error ? err.message : err)
  }
  await Bun.sleep(intervalMs)
}
