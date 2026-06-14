import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { STAKE_RATIO_CAP } from '@puppet/sdk/attestation'
import { HUB_CHAIN } from '@puppet/sdk/const'
import { readableTokenAmount } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  computeClaimable,
  computeQueuedShares,
  getFundPoolState,
  getPuppetRedeemPosition,
  type IFundPoolState,
  type IPuppetRedeemPosition,
  type ITokenRegistryMap,
  liveFundPoolState,
  livePuppetRedeemPosition,
  liveSelect,
  select,
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
import { fetchPositions } from '@puppet/sdk/venue'
import { formatUsd, priceFor } from '../../io/gmx/priceFeed.js'
import { sqlClient } from '../../io/indexer/sql.js'
import { type IRedeemDraft, SHARE_DECIMALS } from './draft.js'

export interface I$FulfillEditor {
  master: Address
  masterAccount: Address
  baseToken: Address
  baseTokenId: Hex
  tokenRegistry: ITokenRegistryMap
}

type IExitMode = 'redeem' | 'liquidate'

const EMPTY_POSITION: IPuppetRedeemPosition = {
  sharesHeld: 0n,
  stake: 0n,
  cursor: 0n,
  accrued: 0n,
  accruedPerStake: 0n,
  totalStake: 0n,
  queuedShares: 0n
}

// Mirrors the on-chain guard on post-queue values: the master's share of the queue may
// not exceed his share of the fund, so he can never exit ahead of his investors.
function guardPasses(pool: IFundPoolState, position: IPuppetRedeemPosition, sharesOut: bigint): boolean {
  let queued = pool.queuedShares
  let totalStake = pool.totalStake
  let stake = position.stake
  let wallet = position.sharesHeld
  if (sharesOut > 0n) {
    if (sharesOut > wallet) return false
    if (totalStake > queued * STAKE_RATIO_CAP) return false
    const added = totalStake === 0n ? sharesOut : (sharesOut * totalStake) / queued
    if (added === 0n) return false
    stake += added
    totalStake += added
    queued += sharesOut
    wallet -= sharesOut
  }
  if (stake === 0n) return true
  return wallet * totalStake + stake * queued >= stake * pool.totalShareSupply
}

// Largest exit-alongside the guard admits (the boundary is exact: equality passes, one
// share over reverts); -1 means even a plain drain is blocked by carried stake. The
// pass predicate is monotone in sharesOut, so bisect.
function maxExitAlongside(pool: IFundPoolState, position: IPuppetRedeemPosition): bigint {
  if (!guardPasses(pool, position, 0n)) return -1n
  let lo = 0n
  let hi = position.sharesHeld
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (guardPasses(pool, position, mid)) lo = mid
    else hi = mid - 1n
  }
  return lo
}

// The fund's payable base: the indexed SIGNED balance is true accounting (fund
// dispatches sign real amounts), so no RPC read is needed.
const liveFundBalance = (fund: Address, baseTokenId: Hex): IStream<bigint> => {
  const balanceArgs = {
    where: {
      account: { _eq: getAddress(fund) },
      chainId: { _eq: BigInt(HUB_CHAIN_ID) },
      tokenId: { _eq: baseTokenId }
    },
    orderBy: { blockTimestamp: 'desc' as const },
    limit: 1,
    fields: ['signedBalance'] as const
  }
  return op(
    merge(
      fromPromise(select(sqlClient, 'AccountBalanceCheckpoint', balanceArgs)),
      liveSelect(sqlClient, 'AccountBalanceCheckpoint', balanceArgs)
    ),
    map(rows => rows[0]?.signedBalance ?? 0n),
    state()
  )
}

export const $FulfillEditor = ({ master, masterAccount, baseToken, baseTokenId, tokenRegistry }: I$FulfillEditor) =>
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
      const desc = getTokenDescription(tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseTokenId).token)

      const poolStream: IStream<IFundPoolState> = op(
        merge(fromPromise(getFundPoolState(sqlClient, masterAccount)), liveFundPoolState(sqlClient, masterAccount)),
        state()
      )
      const navStream: IStream<bigint> = liveFundBalance(masterAccount, baseTokenId)
      const positionStream: IStream<IPuppetRedeemPosition> = op(
        merge(
          fromPromise(getPuppetRedeemPosition(sqlClient, master, masterAccount)),
          livePuppetRedeemPosition(sqlClient, master, masterAccount)
        ),
        state(EMPTY_POSITION)
      )

      const maxExitStream: IStream<bigint> = op(
        combine({ pool: poolStream, pos: positionStream }),
        map(p => maxExitAlongside(p.pool, p.pos))
      )

      const hasOpenPositions: IStream<boolean> = op(
        fromPromise(fetchPositions(sqlClient, masterAccount, 'open')),
        map(positions => positions.length > 0),
        state(true)
      )
      const offHubLiquidity: IStream<boolean> = op(
        fromPromise(
          select(sqlClient, 'AccountBalanceCheckpoint', {
            where: { account: { _eq: getAddress(masterAccount) } },
            distinctOn: ['chainId', 'tokenId'],
            orderBy: [{ chainId: 'asc' }, { tokenId: 'asc' }, { blockTimestamp: 'desc' }],
            fields: ['chainId', 'tokenId', 'signedBalance']
          })
        ),
        map(rows =>
          rows.some(r => (Number(r.chainId) !== HUB_CHAIN_ID || r.tokenId !== baseTokenId) && r.signedBalance > 0n)
        ),
        state(true)
      )
      const liquidateBlocked: IStream<boolean> = op(
        combine({ pos: hasOpenPositions, off: offHubLiquidity }),
        map(p => p.pos || p.off),
        state(true)
      )
      // Self-exit rides every redeem by default, sized PROPORTIONALLY to the drain:
      // the investors' queue is paid first, and only the surplus of the chosen amount
      // folds the master's own shares in (capped by the guard ceiling). A partial drain
      // therefore retires everything it queues and leaves no own residual in the pool.
      const selfExit: IStream<boolean> = state(true, toggleSelfExit)
      const selfExitCap: IStream<bigint> = map(
        p => (p.on && p.max > 0n ? p.max : 0n),
        combine({ on: selfExit, max: maxExitStream })
      )

      // The reachable ceiling: the queue's worth plus the full self-exit allowance.
      const queueValueStream: IStream<bigint> = op(
        combine({ pool: poolStream, nav: navStream, cap: selfExitCap }),
        map(p =>
          p.pool.totalShareSupply === 0n ? 0n : ((p.pool.queuedShares + p.cap) * p.nav) / p.pool.totalShareSupply
        )
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
          if (p.cap === 0n || p.nav === 0n || p.pool.totalShareSupply === 0n) return 0n
          const needed = (p.assets * p.pool.totalShareSupply + p.nav - 1n) / p.nav - p.pool.queuedShares
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
      const focused: IStream<boolean> = state(false, merge(constant(true, focusAssets), constant(false, blurAssets)))

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
          baseTokenId,
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
          const supply = p.pool.totalShareSupply
          const queuedValue = supply === 0n ? 0n : (p.pool.queuedShares * p.nav) / supply
          const ownStakeShares = computeQueuedShares(p.pos)
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
                `${readableTokenAmount(SHARE_DECIMALS, p.pool.queuedShares)} shares (${readableTokenAmount(desc, queuedValue)} ${desc.symbol})`
              ),
              ...(p.pos.stake > 0n
                ? [
                    $statRow('Your queued stake', `${readableTokenAmount(SHARE_DECIMALS, ownStakeShares)} shares`),
                    $node(style({ color: palette.foreground, fontSize: text.xs }))(
                      $text('Your queued payout flushes to your balance with this redeem.')
                    )
                  ]
                : []),
              ...(computeClaimable(p.pos) > 0n
                ? [
                    $statRow(
                      'Your pending payout',
                      `${readableTokenAmount(desc, computeClaimable(p.pos))} ${desc.symbol}`
                    )
                  ]
                : [])
            ),
            $column(spacing.small)(
              $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between' }))(
                $Checkbox({ value: selfExit, label: 'Exit alongside' })({ check: toggleSelfExitTether() }),
                $node(style({ color: palette.message, fontWeight: '600', fontSize: text.xs }))(
                  $text(
                    map(
                      shares => (shares === 0n ? '' : `${readableTokenAmount(SHARE_DECIMALS, shares)} shares`),
                      sharesOutValue
                    )
                  )
                )
              ),
              $node(style({ color: palette.foreground, fontSize: text.xs }))(
                $text(
                  blocked
                    ? 'Processing blocked: your carried stake is ahead of your fund share. Add stake or await investor exits.'
                    : p.maxExit === 0n
                      ? 'Nothing to exit against yet. Your exit capacity grows with investor exits; this is the skin-in-the-game guarantee.'
                      : `Folds up to ${readableTokenAmount(SHARE_DECIMALS, p.maxExit)} of your shares into this redeem, capped by investor exits.`
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
                        $node(style({ color: p.liquidateBlocked ? palette.negative : palette.message, fontSize: text.xs }))(
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
