# Puppet GMX operator: llm-basic

An LLM (Claude) agent. Same perceive / size / execute as the deterministic bots, but the long /
flat / close DECISION is delegated to Claude via structured tool use: the model proposes, your code
enforces the risk caps, and the protocol's signed rules are the final backstop. One file:
`src/index.ts`.

## Setup

1. `bun install`  (pulls `@anthropic-ai/sdk`)
2. Set `ANTHROPIC_API_KEY=...` in `.env` (get one at https://console.anthropic.com).
3. Create your account + allocate a **WETH** fund on the site, then `bun run dev` to pair.
4. **Dry-run is the default** (`DRY_RUN=1` in `.env.example`): the model still decides every tick
   and the full order pipeline runs, but nothing dispatches. Set `DRY_RUN=0` to trade live.

Uses `claude-opus-4-8`, ticking every 5 minutes. Edit the `SYSTEM` prompt, the market context you
feed it, and `PARAMS` (risk/leverage/caps). Note that `stopLossPct` only converts risk into a
position size: no stop order is placed on-chain and there is no liquidation guard here (the
`guarded` variant is the one with real stops).

**Not financial advice.** An LLM decision is non-deterministic; the hard caps + signed rules bound
the downside. The decision is the only thing the model controls, sizing and limits are yours.
