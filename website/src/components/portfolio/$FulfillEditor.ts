import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { WEIGHT_RATIO_CAP } from '@puppet/sdk/attestation'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { getRegisteredTokenDescription, readableTokenAmount } from '@puppet/sdk/core'
import {
  computeClaimable,
  computeQueuedShares,
  type IFund,
  type IFundPosition,
  type ITokenRegistryMap,
  tokenInfoFor
} from '@puppet/sdk/state'
import {
  combine,
  constant,
  empty,
  filter,
  fromPromise,
  type IStream,
  map,
  merge,
  op,
  sampleMap,
  switchLatest,
  switchMap
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type INode, nodeEvent, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, getAddress, type Hex } from 'viem'
import {
  $ButtonSecondary,
  $Checkbox,
  $defaultSliderContainer,
  $infoTooltip,
  $Slider,
  $TokenAmountInput,
  text
} from '@/ui-components'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { liveBalance, liveFundPool, liveRedeemPosition } from '../../io/live.js'
import { fetchOpenPositions } from '../../io/matchmaker/reads.js'
import { readAccountBalances } from '../../io/onchain/balances.js'
import type { IRedeemDraft } from './draft.js'
import { createFocusState } from './editorUtils.js'

export interface I$FulfillEditor {
  master: Address
  masterAccount: Address
  baseToken: Address
  tokenRegistry: ITokenRegistryMap
}

type IExitMode = 'redeem' | 'liquidate'

// Mirrors the on-chain guard: with carried weight the master must still hold at least half
// of the non-queued shares, so he can never exit ahead of his investors.
function guardPasses(pool: IFund | undefined, position: IFundPosition | undefined, sharesOut: bigint): boolean {
  if (!pool) return false
  let queued = pool.queuedShares
  let poolWeight = pool.weight
  // Carried weight from a previous fund epoch is zeroed on-chain (attestRedeemIntent: masterEpoch < poolEpoch -> 0), so
  // mirror that here or the off-chain guard would wrongly block a redeem the contract accepts.
  let positionWeight = position ? (position.epoch < pool.epoch ? 0n : position.weight) : 0n
  let wallet = position?.sharesHeld ?? 0n
  if (sharesOut > 0n) {
    if (sharesOut > wallet) return false
    if (poolWeight > queued * WEIGHT_RATIO_CAP) return false
    const added = poolWeight === 0n ? sharesOut : (sharesOut * poolWeight) / queued
    if (added === 0n) return false
    positionWeight += added
    poolWeight += added
    queued += sharesOut
    wallet -= sharesOut
  }
  if (positionWeight === 0n) return true
  return 2n * wallet >= pool.totalShareSupply - queued
}

// Largest exit-alongside the guard admits (the boundary is exact: equality passes, one
// share over reverts); -1 means even a plain drain is blocked by carried stake. The
// pass predicate is monotone in sharesOut, so bisect.
function maxExitAlongside(pool: IFund | undefined, position: IFundPosition | undefined): bigint {
  if (!guardPasses(pool, position, 0n)) return -1n
  let lo = 0n
  let hi = position?.sharesHeld ?? 0n
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (guardPasses(pool, position, mid)) lo = mid
    else hi = mid - 1n
  }
  return lo
}

// The fund's payable base: the folded SIGNED balance is true accounting (fund dispatches sign real amounts), so no RPC
// read is needed. Polled on the relay head. null = unreadable (treated as not-ready, i.e. 0n, by the gates below).
const liveFundBalance = (fund: Address, baseToken: Address): IStream<bigint | null> =>
  liveBalance(getAddress(fund), HUB_CHAIN_ID, baseToken)

export const $FulfillEditor = ({ master, masterAccount, baseToken, tokenRegistry }: I$FulfillEditor) =>
  component(
    (
      [inputAssets, inputAssetsTether]: IBehavior<bigint>,
      [focusAssets, focusAssetsTether]: IBehavior<FocusEvent>,
      [blurAssets, blurAssetsTether]: IBehavior<FocusEvent>,
      [enterAssets, enterAssetsTether]: IBehavior<KeyboardEvent>,
      [sliderPercent, sliderPercentTether]: IBehavior<number>,
      [clickFulfill, clickFulfillTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [clickLiquidate, clickLiquidateTether]: IBehavior<INode<HTMLButtonElement>, MouseEvent>,
      [toggleSelfExit, toggleSelfExitTether]: IBehavior<boolean>,
      [clickSubmit, clickSubmitTether]: IBehavior<PointerEvent>
    ) => {
      const desc = getRegisteredTokenDescription(tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseToken).token)

      const poolStream: IStream<IFund | undefined> = op(liveFundPool(getAddress(masterAccount)), state())
      const navStream: IStream<bigint> = op(
        liveFundBalance(masterAccount, baseToken),
        map(nav => nav ?? 0n)
      )
      const positionStream: IStream<IFundPosition | undefined> = op(
        liveRedeemPosition(getAddress(master), getAddress(masterAccount)),
        state()
      )

      const maxExitStream: IStream<bigint> = op(
        combine({ pool: poolStream, pos: positionStream }),
        map(p => maxExitAlongside(p.pool, p.pos))
      )

      // Liquidate is irreversible, so an UNREADABLE positions/balances read must keep it BLOCKED (fail closed), never
      // unblock it by mistaking a failed read for "no positions / no off-hub liquidity".
      const hasOpenPositions: IStream<boolean> = op(
        fromPromise(
          fetchOpenPositions(getAddress(masterAccount))
            .then(positions => positions.length > 0)
            .catch(() => true)
        ),
        state(true)
      )
      const offHubLiquidity: IStream<boolean> = op(
        fromPromise(
          readAccountBalances(tokenRegistry, getAddress(masterAccount))
            .then(rows =>
              rows.some(r => (Number(r.chainId) !== HUB_CHAIN_ID || r.token !== baseToken) && r.signedBalance > 0n)
            )
            .catch(() => true)
        ),
        state(true)
      )
      const liquidateBlocked: IStream<boolean> = op(
        combine({ pos: hasOpenPositions, off: offHubLiquidity }),
        map(p => p.pos || p.off),
        state(true)
      )
      // The master's own exit is ALWAYS available up to the skin-guard ceiling (the contract's redeem(sharesOut)
      // path: 2*masterShares >= supply - poolShares). It does not depend on investor exits — the master's shares
      // ARE the queue when he redeems. The chosen amount folds them in proportionally (any investor queue is paid
      // first), capped here at the skin limit.
      const selfExitCap: IStream<bigint> = map(max => (max > 0n ? max : 0n), maxExitStream)
      // The toggle only decides whether the drain is sized to ALSO clear the pending investor queue alongside the
      // master's exit; the master can always reach his own skin-limited exit regardless of it.
      const fulfillQueue: IStream<boolean> = state(true, toggleSelfExit)

      // The reachable ceiling: the master's full self-exit allowance, plus the investor queue when folding it in.
      const queueValueStream: IStream<bigint> = op(
        combine({ pool: poolStream, nav: navStream, cap: selfExitCap, fulfill: fulfillQueue }),
        map(p => {
          const supply = p.pool?.totalShareSupply ?? 0n
          if (supply === 0n) return 0n
          const queued = p.fulfill ? (p.pool?.queuedShares ?? 0n) : 0n
          return ((queued + p.cap) * p.nav) / supply
        })
      )

      // The slider spans the WHOLE fund so the queue reads at its true scale: the drag
      // clamps at the queue's worth, and only liquidate reaches the rest of the track.
      const sliderAssets: IStream<bigint> = sampleMap(
        (bounds, pct) => {
          const bp = BigInt(Math.round(Math.max(0, Math.min(1, pct)) * 10000))
          const scaled = (bounds.nav * bp) / 10000n
          return scaled < bounds.queueValue ? scaled : bounds.queueValue
        },
        combine({ nav: navStream, queueValue: queueValueStream }),
        sliderPercent
      )
      const snapAssets: IStream<bigint> = sampleMap(queueValue => queueValue, queueValueStream, clickFulfill)
      const liquidateAssets: IStream<bigint> = sampleMap(nav => nav, navStream, clickLiquidate)
      const assetsValue: IStream<bigint> = op(merge(inputAssets, sliderAssets, snapAssets, liquidateAssets), state(0n))
      // Own shares joining this redeem: just enough for the chosen amount to retire the
      // WHOLE resulting queue (ceil so the drain never overshoots the queue's worth).
      const sharesOutValue: IStream<bigint> = map(
        p => {
          const supply = p.pool?.totalShareSupply ?? 0n
          if (p.cap === 0n || p.nav === 0n || supply === 0n) return 0n
          const needed = (p.assets * supply + p.nav - 1n) / p.nav - (p.pool?.queuedShares ?? 0n)
          return needed <= 0n ? 0n : needed < p.cap ? needed : p.cap
        },
        combine({ pool: poolStream, nav: navStream, cap: selfExitCap, assets: assetsValue })
      )
      // Liquidate is an armed MODE, not an immediate action: the snap fills the whole
      // track (all assets in) and surfaces the warning; any manual edit disarms it.
      const exitMode: IStream<IExitMode> = state(
        'redeem',
        merge(
          constant('liquidate' as IExitMode, clickLiquidate),
          constant('redeem' as IExitMode, merge(inputAssets, sliderPercent, clickFulfill))
        )
      )
      const fulfillSnap: IStream<boolean> = state(
        false,
        merge(constant(true, clickFulfill), constant(false, merge(inputAssets, sliderPercent)))
      )
      const focused = createFocusState(focusAssets, blurAssets)

      const changeDraft: IStream<IRedeemDraft> = sampleMap(
        (p): IRedeemDraft => ({
          kind: 'redeem',
          id: `fulfill:${masterAccount}`,
          account: masterAccount,
          title: p.mode === 'liquidate' ? 'Liquidate' : 'Redeem',
          alert: null,
          master,
          masterAccount,
          baseToken,
          sharesOut: p.mode === 'liquidate' ? 0n : p.shares,
          assetsOut: p.assets,
          fulfill: p.mode === 'redeem' && (p.fulfill || p.assets === p.queueValue),
          liquidate: p.mode === 'liquidate'
        }),
        combine({
          assets: assetsValue,
          shares: sharesOutValue,
          fulfill: fulfillSnap,
          queueValue: queueValueStream,
          mode: exitMode
        }),
        merge(clickSubmit, enterAssets)
      )

      const submitDisabled: IStream<boolean> = map(
        p =>
          p.mode === 'liquidate'
            ? p.nav === 0n || p.liquidateBlocked
            : p.assets === 0n || p.assets > p.queueValue || p.maxExit < 0n,
        combine({
          assets: assetsValue,
          queueValue: queueValueStream,
          maxExit: maxExitStream,
          mode: exitMode,
          nav: navStream,
          liquidateBlocked
        })
      )

      // Inputs stay OUT of the rebuild combine: a keystroke must stream into the existing
      // DOM, not re-render the editor (which recreates the input and drops focus).
      const $editor = switchMap(
        p => {
          const supply = p.pool?.totalShareSupply ?? 0n
          const queuedValue = supply === 0n ? 0n : ((p.pool?.queuedShares ?? 0n) * p.nav) / supply
          const ownStakeShares = computeQueuedShares(p.pos, p.pool)
          const blocked = p.maxExit < 0n

          const valueToShow: IStream<string> = map(
            (x: { amt: bigint; focused: boolean }) => (x.amt === 0n ? '' : readableTokenAmount(desc, x.amt)),
            filter((x: { amt: bigint; focused: boolean }) => !x.focused, combine({ amt: assetsValue, focused }))
          )
          const sliderValue: IStream<number> = map(
            amt => (p.nav > 0n ? Number((amt * 10000n) / p.nav) / 10000 : 0),
            assetsValue
          )

          const $assetsField = $TokenAmountInput({ decimals: desc.decimals, valueToShow })({
            inputAmount: inputAssetsTether(),
            focus: focusAssetsTether(),
            blur: blurAssetsTether(),
            enter: enterAssetsTether()
          })

          const $miniAction = (label: string, disabled: boolean, tether: (op: any) => any, negative = false) =>
            $element('button')(
              attr({ type: 'button', disabled: disabled ? 'true' : null }),
              style({
                background: 'transparent',
                border: `1px solid ${negative ? colorShade(palette.negative, 35) : colorShade(palette.foreground, 25)}`,
                borderRadius: '8px',
                padding: '2px 8px',
                fontSize: text.xs,
                fontWeight: '600',
                color: negative ? palette.negative : palette.foreground,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? '0.4' : '1'
              }),
              tether(nodeEvent('click'))
            )($text(label))

          const $statRow = (label: string, value: string | IStream<string>) =>
            $row(spacing.small, style({ alignItems: 'baseline', justifyContent: 'space-between' }))(
              $node(style({ color: palette.foreground, fontSize: text.xs }))($text(label)),
              $node(style({ color: palette.message, fontWeight: '600' }))($text(value))
            )

          return $column(spacing.default, style({ minWidth: '380px' }))(
            $row(
              style({
                padding: '18px 28px',
                borderRadius: '22px 22px 0 0',
                background: palette.background,
                margin: '-28px -28px 0px',
                gap: '12px',
                alignItems: 'center'
              })
            )(
              $element('label')(
                style({
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'text',
                  flex: '1',
                  minWidth: '0',
                  gap: '4px'
                })
              )(
                $row(spacing.tiny, style({ alignItems: 'center' }))(
                  $node(style({ color: palette.foreground, fontSize: text.sm, fontWeight: '500' }))(
                    $text('Process redemptions')
                  ),
                  $infoTooltip(
                    'Pays everyone in the queue this fraction of their pending exit, at the fund’s payable value.',
                    palette.foreground,
                    '14px'
                  )
                ),
                $row(spacing.small, style({ alignItems: 'center' }))(
                  $assetsField,
                  $miniAction('Fulfill', p.queueValue === 0n, clickFulfillTether),
                  $row(style({ gap: '3px', alignItems: 'center' }))(
                    $miniAction('Liquidate', p.nav === 0n || p.liquidateBlocked, clickLiquidateTether, true),
                    ...(p.liquidateBlocked
                      ? [
                          $infoTooltip(
                            `Unwind every open position and move all holdings to ${HUB_CHAIN.name} as ${desc.symbol} first: liquidate deposits the full NAV here so every holder can exit.`,
                            palette.negative,
                            '16px'
                          )
                        ]
                      : [])
                  )
                ),
                $node(style({ color: palette.foreground, fontSize: text.xs }))(
                  $text(map(x => formatUsd(x.amt, x.price), combine({ amt: assetsValue, price: priceFor(baseToken) })))
                )
              )
            ),
            $node(style({ margin: '0 -26px', display: 'flex' }))(
              $Slider({
                value: sliderValue,
                step: 0.01,
                orientation: 'horizontal',
                ariaLabel: 'Redemption amount',
                disabled: map(() => p.queueValue === 0n, assetsValue),
                error: map(() => false, assetsValue),
                motion: { stiffness: 800, damping: 58 },
                $container: $defaultSliderContainer(
                  style({ height: '14px', width: '100%', margin: '-26px 0', flexShrink: '0' })
                )
              })({ change: sliderPercentTether() })
            ),
            $column(spacing.small)(
              $statRow(
                'Awaiting redemption',
                `${readableTokenAmount(PRECISION.shareTokenDecimals, p.pool?.queuedShares ?? 0n)} shares (${readableTokenAmount(desc, queuedValue)} ${desc.symbol})`
              ),
              ...((p.pos?.weight ?? 0n) > 0n
                ? [
                    $statRow('Your queued stake', `${readableTokenAmount(PRECISION.shareTokenDecimals, ownStakeShares)} shares`),
                    $node(style({ color: palette.foreground, fontSize: text.xs }))(
                      $text('Your queued payout flushes to your balance with this redeem.')
                    )
                  ]
                : []),
              ...(computeClaimable(p.pos, p.pool) > 0n
                ? [
                    $statRow(
                      'Your pending payout',
                      `${readableTokenAmount(desc, computeClaimable(p.pos, p.pool))} ${desc.symbol}`
                    )
                  ]
                : [])
            ),
            $column(spacing.small)(
              $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
                $Checkbox({ value: fulfillQueue, label: 'Fulfill investor queue' })({ check: toggleSelfExitTether() }),
                $node(style({ color: palette.message, fontWeight: '600', fontSize: text.xs }))(
                  $text(
                    map(
                      shares => (shares === 0n ? '' : `${readableTokenAmount(PRECISION.shareTokenDecimals, shares)} shares`),
                      sharesOutValue
                    )
                  )
                )
              ),
              $node(style({ color: palette.foreground, fontSize: text.xs }))(
                $text(
                  blocked
                    ? 'Processing blocked: your carried stake exceeds your current fund share; it must rebalance before you can exit.'
                    : p.maxExit === 0n
                      ? "You're at your skin-in-the-game floor: redeeming more would drop your share below the required half."
                      : `Redeems up to ${readableTokenAmount(PRECISION.shareTokenDecimals, p.maxExit)} of your shares, keeping your required skin.`
                )
              )
            ),
            switchLatest(
              map(
                mode =>
                  mode === 'liquidate'
                    ? $column(
                        spacing.tiny,
                        style({
                          border: `1px solid ${colorShade(palette.negative, 35)}`,
                          borderRadius: '12px',
                          padding: '10px 14px',
                          lineHeight: '1.5'
                        })
                      )(
                        $row(spacing.tiny, style({ alignItems: 'center' }))(
                          $node(style({ color: palette.negative, fontSize: text.sm, fontWeight: '600' }))(
                            $text('Ends this fund permanently')
                          ),
                          $infoTooltip(
                            $column(style({ display: 'flex', maxWidth: '280px', whiteSpace: 'normal', gap: '4px' }))(
                              $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
                                $text(
                                  `Requires every venue position unwound (full value in ${HUB_CHAIN.name}). Your shares settle to your account now; investors claim theirs anytime. Cannot be undone.`
                                )
                              )
                            ),
                            palette.foreground,
                            '18px'
                          )
                        ),
                        $node(
                          style({ color: p.liquidateBlocked ? palette.negative : palette.message, fontSize: text.xs })
                        )(
                          $text(
                            p.liquidateBlocked
                              ? `Unwind every open position and move all holdings to ${HUB_CHAIN.name} as ${desc.symbol} first: the full NAV must be liquid here to settle everyone.`
                              : `The entire ${readableTokenAmount(desc, p.nav)} ${desc.symbol} drains and every holder receives the identical closing price per share.`
                          )
                        )
                      )
                    : empty,
                exitMode
              )
            ),
            $row(spacing.small, style({ alignItems: 'center' }))(
              $node(style({ flex: 1 }))(),
              switchLatest(
                map(
                  mode =>
                    $ButtonSecondary({
                      disabled: submitDisabled,
                      $content:
                        mode === 'liquidate'
                          ? $node(style({ color: palette.negative }))($text('Liquidate'))
                          : $text('Redeem')
                    })({ click: clickSubmitTether() }),
                  exitMode
                )
              )
            )
          )
        },
        combine({
          pool: poolStream,
          nav: navStream,
          pos: positionStream,
          maxExit: maxExitStream,
          queueValue: queueValueStream,
          liquidateBlocked
        })
      )

      return [$editor, { changeDraft }]
    }
  )
