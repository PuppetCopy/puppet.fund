# Website submission flow review

Findings on `website/src/relay/index.ts`, `website/src/components/$ActionDrawer.ts`, `website/src/components/executeDraft.ts`. Severity-ordered, no edits applied.

## High

### 1. `draftKey` collision for withdraws with different destChainId

`executeDraft.ts:54-59`

```ts
return `withdraw:${d.symbol}:${d.from}`.toLowerCase()
```

Two withdraws with the same `(symbol, from)` but different `destChainId` (one home `transferOut`, one bridge `bridgeOut`) collide in `progressMap`. The second draft overwrites the first's status row; only one progress indicator renders while both execute.

Fix: include `destChainId` in the key — `withdraw:${symbol}:${from}:${destChainId}`.

Other kinds verified collision-free:
- `subscribe:${master}` — one subscription per master per user.
- `deposit:${symbol}:${chainId}:${recipient}` — origin chain in key, OK.
- `bridgeIn:${nonce}` — random nonce.

### 2. Balance validation reads `balanceOf` not `signedBalance`

`executeDraft.ts:783-790` (transferOut), `891-900` (bridgeOut)

```ts
liveBalance = await readContract(wallet.publicClient, {
  address: draft.token, abi: erc20Abi, functionName: 'balanceOf', args: [puppetAddress]
})
```

The contract checks `signedBalance >= amount` (cosigned-flow ledger), not the raw ERC20 balance. Drift case: puppet receives token via non-cosigned path → `liveBalance > signedBalance` → UI greenlights intent that contract rejects. Opposite direction is structurally impossible. User signs a doomed intent; relay fee burns; UX shows opaque downstream failure.

Fix: call `IAccount(puppet).signedBalance()` for the precondition check. Live balance still useful for the user-facing "available to withdraw" display, but the intent precondition must use signed.

## Medium

### 3. bridgeOut sweep `inputAmount` from live balance

`executeDraft.ts:913`

```ts
const inputAmount = draft.amount > 0n ? draft.amount : liveBalance - relayFee
```

Across quote at lines 920-930 uses this `inputAmount`. Contract internally resolves sweep against `signedBalance - relayFee`. If `liveBalance != signedBalance`, Across quotes for X but contract approves Y. `depositV3` reverts on amount mismatch.

Same fix as #2: use `signedBalance` to compute the sweep `inputAmount`. After the broader sweep-removal landing, this still applies for the bridgeOut sweep path (kept for Across quote alignment).

### 4. Matchmaker response path appears missing

`matchmaker/src/server.ts` dispatches via `HANDLERS[request.kind](request, env)`. No outbound `ws.send` in the message handler. Website's `compact.request<TxRef>('relay', req)` (every `executeDraft` runner) awaits a `TxRef`. `compact.request<IHealth>('health')` similarly awaits.

Two possibilities:
- Response path lives inside the `compact` SDK boundary not visible from server.ts.
- Client's `compact.request<TxRef>` resolves to something else than the type suggests.

Verify: instrument the matchmaker's `submit()` return and confirm it reaches the client. If the gap is real, matchmaker needs `ws.send(encode({ id, result: txRef }))` after successful handler return, plus error response on the catch path.

### 5. `userDeploySig` / `userSignerProof` sent on every relay request

Every relay request in `executeDraft.ts` includes both fields (lines 359, 444, 663, 748, 848, 985, 1097). Only consumed by the matchmaker's auto-deploy path when puppet is undeployed. After deployment, they're dead weight on the wire and a small information leak (session bind sig published per request).

Fix: gate inclusion on `getCode(puppet)`. UI knows it ran `ensureHomePuppetDeployedViaRelay` successfully and can skip on subsequent submissions in the same session.

## Low

### 6. No progress between leg1 receipt and Across fill

`runBridgeHome` (`executeDraft.ts:378-396`) calls `waitForFillByDepositTx` between leg1 dispatch and leg2 transferIn. Can take several minutes. User sees `txList` updated with leg1, then nothing until leg2 lands. Drawer looks frozen.

Fix: yield an intermediate state event with a `phase: 'awaiting_fill'` annotation before line 379. Extend `RowState` to carry a `phase`/`note` field or accept an arbitrary status string.

### 7. `MASTER_NOT_FOUND` misleading vs indexer lag

`runSubscribe` (`executeDraft.ts:1006`) throws `MASTER_NOT_FOUND` if indexer hasn't seen the master row yet. Indistinguishable from "master doesn't exist."

Fix: query on-chain (`getCode(predictMasterAddress)`). If contract exists but indexer doesn't, message `MASTER_INDEXER_LAGGING` — "master deployed but not yet indexed; retry in ~30s." Otherwise current `MASTER_NOT_FOUND` is correct.

### 8. `transport.send` drops silently when WS not OPEN

`relay/index.ts:68-70`

```ts
send(raw) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(raw)
}
```

If socket is closed mid-send (during the 2s reconnect window), message is dropped without notification. Compact SDK on top may have request timeouts; transport-level there's no signal.

Partial mitigation already in place: `$ActionDrawer.submitDisabled` blocks submit when `compactStatus !== 'open'`. ✓ But in-flight requests when the socket dies still disappear silently.

### 9. Eager WebSocket connection at module load

`relay/index.ts:49` calls `connect()` synchronously. Module import opens WS. Hard to test, hard to delay until user actually needs the relay. Cosmetic — PWA contexts typically want it eager.

## Info

### 10. switchMap cancellation leaves untracked on-chain state

`$ActionDrawer.ts:113` uses `switchMap` over `clickSubmit` → `runSession`. Second click before completion switches/disposes the first. Intents already dispatched to the relay are on-chain regardless; drawer just stops tracking them.

Mitigated by `submitDisabled` (line 177-185) blocking double-click during `inFlight`. Verified defense-in-depth.

## Summary table

| # | Item | Severity | File:line |
|---|---|---|---|
| 1 | `draftKey` collision for withdraws with different destChainId | High | `executeDraft.ts:54-59` |
| 2 | Balance validation uses `balanceOf` not `signedBalance` | High | `executeDraft.ts:783-790, 891-900` |
| 3 | bridgeOut sweep `inputAmount` from live balance | Medium | `executeDraft.ts:913` |
| 4 | Matchmaker response path appears missing | Medium (verify) | `matchmaker/server.ts` + `relay/index.ts` |
| 5 | `userDeploySig` / `signerProof` sent every relay call | Medium | per relay request in `executeDraft.ts` |
| 6 | No progress between leg1 and Across fill | Low (UX) | `executeDraft.ts:378-396` |
| 7 | `MASTER_NOT_FOUND` misleading vs indexer lag | Low (UX) | `executeDraft.ts:1006` |
| 8 | `transport.send` drops on closed WS | Low | `relay/index.ts:68-70` |
| 9 | Eager WS connection at module load | Low (cosmetic) | `relay/index.ts:49` |
| 10 | switchMap cancellation leaves untracked on-chain state | Info (design) | `$ActionDrawer.ts:113` |

Items 1-4 are the substantive findings. 1 and 2 are clear bugs. 3 is a derived consequence of 2. 4 needs verification before classifying.
