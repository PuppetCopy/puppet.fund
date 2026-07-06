import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import { type IRuleBody, RULE_REVOKED } from '@puppet/sdk/attestation'
import { IntervalTime } from '@puppet/sdk/const'
import { formatFixed, getChainTokenDescription, getDuration, getMasterMatchingKey, parseBps, parseFixed } from '@puppet/sdk/core'
import {
  combine,
  combineMap,
  empty,
  type IStream,
  just,
  map,
  merge,
  o,
  op,
  sampleMap,
  start,
  switchMap,
  toStream
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address, Hex } from 'viem'
import {
  $ButtonPrimaryOutline,
  $ButtonSecondary,
  $Checkbox,
  $Dropdown,
  $FieldLabeled,
  $infoTooltip,
  $labeledDivider,
  text
} from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../../app/localStoreSchema.js'
import type { ISubscribeRule } from '../../io/datastore/query.js'

export type { ISubscribeRule }

export type I$MatchingRuleEditor = {
  model?: ISubscribeRule
  masterMatchingKey: Hex
  baseToken: Address
  master: Address
  // The fund's pinned name completes its {master, baseToken, name} CREATE2 identity, which
  // the mandate rule needs to derive the on-chain fund address under multi-key addressing.
  name: Hex
  draftMatchingRuleList: IStream<ISubscribeRule[]>
}

type InputStateParams<T> = { [P in keyof T]: IStream<T[P]> | T[P] }

function combineForm<A, K extends keyof A = keyof A>(state: InputStateParams<A>, defaultState: A): IStream<A> {
  const entries = Object.entries(state) as [keyof A, IStream<A[K]> | A[K]][]
  if (entries.length === 0) return just({} as A)
  const streams = entries.map(([key, stream]) => start(defaultState[key], toStream(stream)))
  return combineMap(
    (...args: A[K][]) =>
      args.reduce((seed, val, idx) => {
        const key = entries[idx][0]
        seed[key] = val
        return seed
      }, {} as A),
    ...streams
  )
}

export const $MatchingRuleEditor = (config: I$MatchingRuleEditor) =>
  component(
    (
      [inputAllocationRate, inputAllocationRateTether]: IBehavior<string | number, bigint>,
      [inputRateLimit, inputRateLimitTether]: IBehavior<string | number, bigint>,
      [changeThrottlePeriod, changeThrottlePeriodTether]: IBehavior<number, bigint>,
      [inputSymmetry, inputSymmetryTether]: IBehavior<string | number, bigint>,
      [inputExitFreeze, inputExitFreezeTether]: IBehavior<string | number, bigint>,
      [clickRemove, clickRemoveTether]: IBehavior<PointerEvent>,
      [changeAdvanced, changeAdvancedTether]: IBehavior<boolean>,
      [save, saveTether]: IBehavior<PointerEvent>
    ) => {
      const advancedEnabled = uiStorage.replayWrite(
        localStoreSchema.ruleEditor.advancedRouteEditorEnabled,
        changeAdvanced
      )

      const { model, masterMatchingKey, draftMatchingRuleList, baseToken, master, name } = config
      const tokenDesc = getChainTokenDescription(HUB_CHAIN_ID, baseToken)
      const { decimals, symbol } = tokenDesc

      const $fieldLabel = (label: string, explainer: string | I$Node): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', whiteSpace: 'nowrap', flexWrap: 'nowrap' }))(
          $text(label),
          $infoTooltip(explainer, palette.foreground, '18px')
        )

      const defaultDraft: IRuleBody = {
        throttlePeriod: BigInt(IntervalTime.HR12),
        rateLimit: 0n,
        exitFreeze: parseBps(0.5),
        allocationRate: 1000n,
        symmetry: parseBps(1)
      }

      const allocationRate = op(
        start(model ? model.allocationRate : defaultDraft.allocationRate, inputAllocationRate),
        state()
      )
      const rateLimit = op(start(model ? model.rateLimit : defaultDraft.rateLimit, inputRateLimit), state())
      const throttlePeriod = op(
        start(model ? model.throttlePeriod : defaultDraft.throttlePeriod, changeThrottlePeriod),
        state()
      )
      const modelSymmetry = model ? (model.symmetry === 1n ? parseBps(1) : model.symmetry) : defaultDraft.symmetry
      const symmetry = op(start(modelSymmetry, inputSymmetry), state())
      const exitFreeze = op(start(model ? model.exitFreeze : defaultDraft.exitFreeze, inputExitFreeze), state())

      const draft = combineForm({ throttlePeriod, rateLimit, exitFreeze, allocationRate, symmetry }, defaultDraft)

      const isSubscribed = !!model && model.allocationRate > 0n

      const $meterRow = (label: string, fill: number, amount: string) =>
        $row(style({ alignItems: 'center', gap: '10px' }))(
          $node(style({ fontSize: text.xs, color: palette.foreground, width: '104px', flexShrink: 0 }))($text(label)),
          $node(
            style({
              width: '160px',
              height: '10px',
              borderRadius: '5px',
              flexShrink: 0,
              backgroundColor: colorShade(palette.foreground, 30)
            })
          )(
            $node(
              style({
                height: '100%',
                width: `${Math.min(160, Math.max(2, fill))}px`,
                borderRadius: '5px',
                backgroundColor: palette.primary
              })
            )()
          ),
          $node(style({ fontSize: text.xs, color: palette.message, whiteSpace: 'nowrap', flex: 1, textAlign: 'right' }))(
            $text(amount)
          )
        )

      const $symmetryExplainer = $column(spacing.default, style({ maxWidth: '340px' }))(
        $node(style({ color: palette.message }))(
          $text(
            `Caps each allocation relative to what the trader commits that round. 100% never commits more than the trader; 200% allows up to double; clear to remove the cap.`
          )
        ),
        switchMap(sym => {
          const capRate = formatFixed(4, sym)
          const committed = sym > 0n ? Math.min(160, Math.round(100 * capRate * 100) / 100) : 160
          const spare = Math.round((160 - committed) * 100) / 100
          return $column(spacing.small)(
            $meterRow('Trader adds', 100, `100 ${symbol}`),
            $meterRow('Your allocate %', 160, `160 ${symbol}`),
            $meterRow(
              sym > 0n ? `At ${Math.round(capRate * 10000) / 100}%` : 'No cap',
              committed,
              `${committed} ${symbol}`
            ),
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text(
                spare > 0
                  ? `The uncommitted ${spare} ${symbol} stays in your balance.`
                  : `The cap does not bind here; the full 160 ${symbol} follows.`
              )
            )
          )
        }, symmetry)
      )

      const $timelineRow = (label: string, followed: number[], skipped: number[]) =>
        $row(style({ alignItems: 'center', gap: '10px' }))(
          $node(style({ fontSize: text.xs, color: palette.foreground, width: '104px', flexShrink: 0 }))($text(label)),
          $node(style({ position: 'relative', width: '160px', height: '10px', flexShrink: 0 }))(
            $node(
              style({
                position: 'absolute',
                top: '4px',
                left: '0',
                right: '0',
                height: '2px',
                borderRadius: '1px',
                backgroundColor: colorShade(palette.foreground, 30)
              })
            )(),
            ...followed.map(p =>
              $node(
                style({
                  position: 'absolute',
                  left: `${p}%`,
                  top: '0',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: palette.primary
                })
              )()
            ),
            ...skipped.map(p =>
              $node(
                style({
                  position: 'absolute',
                  left: `${p}%`,
                  top: '0',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: colorShade(palette.foreground, 40)
                })
              )()
            )
          )
        )

      const $rateLimitExplainer = $column(spacing.default, style({ maxWidth: '340px' }))(
        $node(style({ color: palette.message }))(
          $text(
            `A hard ceiling on the ${symbol} committed in any single round, whatever your allocate % works out to. Even the matchmaker cannot exceed it; leave empty for no cap.`
          )
        ),
        switchMap(params => {
          const asks = Math.round(1000 * formatFixed(4, params.rate) * 100) / 100
          const cap = formatFixed(decimals, params.cap)
          const committed = params.cap > 0n ? Math.min(asks, cap) : asks
          const fill = asks > 0 ? (160 * committed) / asks : 2
          return $column(spacing.default)(
            $column(spacing.small)(
              $meterRow('A round asks', 160, `${asks.toLocaleString('en-US')} ${symbol}`),
              $meterRow(
                params.cap > 0n ? 'You commit' : 'No cap',
                fill,
                `${committed.toLocaleString('en-US')} ${symbol}`
              )
            ),
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text(
                params.cap === 0n
                  ? 'No cap set: rounds are sized by your allocate % alone.'
                  : committed < asks
                    ? `The cap trims this round by ${(asks - committed).toLocaleString('en-US')} ${symbol}.`
                    : 'The cap does not bind this round.'
              )
            )
          )
        }, combine({ rate: allocationRate, cap: rateLimit }))
      )

      const $exitFreezeExplainer = $column(spacing.default, style({ maxWidth: '340px' }))(
        switchMap(freeze => {
          const threshold = Math.round(formatFixed(4, freeze) * 10000) / 100
          if (freeze === 0n) {
            return $column(spacing.default)(
              $node(style({ color: palette.message }))(
                $text(
                  "Backs you off as this trader's investors queue to exit. Disabled: rounds stay full-size even while the pool empties."
                )
              ),
              $column(spacing.small)(
                $meterRow('Queue at 0%', 160, 'full round'),
                $meterRow('Queue at 50%', 160, 'full round'),
                $meterRow('Queue at 100%', 160, 'full round')
              )
            )
          }
          return $column(spacing.default)(
            $node(style({ color: palette.message }))(
              $text(
                `Backs you off as this trader's investors queue to exit. Each round shrinks in proportion to the share of the pool waiting to redeem, freezing fully at ${threshold}%.`
              )
            ),
            $column(spacing.small)(
              $meterRow('Queue at 0%', 160, 'full round'),
              $meterRow(`Queue at ${threshold / 2}%`, 80, 'half round'),
              $meterRow(`Queue at ${threshold}%`, 0, 'frozen')
            ),
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text('A swelling exit queue is the clearest warning a fund gives; lower the threshold to react sooner, clear to ignore it.')
            )
          )
        }, exitFreeze)
      )

      const $throttleExplainer = $column(spacing.default, style({ maxWidth: '340px' }))(
        switchMap(tp => {
          const period = getDuration(Number(tp))
          return $column(spacing.default)(
            $node(style({ color: palette.message }))(
              $text(
                `Your funds follow this trader at most once every ${period}. Rounds that land inside the window are skipped, not queued, so a hyperactive trader cannot commit your balance faster than you allow.`
              )
            ),
            $column(spacing.small)(
              $timelineRow('Trader funds', [0, 18, 34, 80], []),
              $timelineRow('You follow', [0, 80], [18, 34])
            ),
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text(`The two middle rounds fall inside the ${period} window and pass you by. Enforced on-chain.`)
            )
          )
        }, throttlePeriod)
      )

      const $allocateExplainer = $column(spacing.default, style({ maxWidth: '340px' }))(
        $node(style({ color: palette.message }))(
          $text(
            `Each time this trader funds their fund, this share of your deposited ${symbol} follows, recomputed from your balance at that moment.`
          )
        ),
        switchMap(rate => {
          const fraction = formatFixed(4, rate)
          const follows = Math.round(1000 * fraction * 100) / 100
          const filled = Math.max(2, Math.round(160 * Math.min(1, fraction)))
          return $column(spacing.small)(
            $meterRow('You deposit', 160, `1,000 ${symbol}`),
            $meterRow(
              `Follows at ${Math.round(fraction * 10000) / 100}%`,
              filled,
              `${follows.toLocaleString('en-US')} ${symbol}`
            ),
            $node(style({ fontSize: text.xs, color: palette.foreground }))(
              $text('The rest stays free; nothing is locked ahead of time.')
            )
          )
        }, allocationRate)
      )

      // Allocate % bounds: bps with 4 decimals where parseBps(1) === 100%
      const maxAllocationRate = parseBps(1)
      const allocationValidation = map(
        rate => (rate <= 0n || rate > maxAllocationRate ? 'Enter a value between 1% and 100%' : null),
        allocationRate
      )

      return [
        $column(spacing.default, style({ maxWidth: '350px' }))(
          $row(spacing.small, style({ alignItems: 'center' }))(
            $node(style({ fontWeight: '500', color: palette.message }))($text(`Follow this trader with your ${symbol}`)),
            $infoTooltip(
              `This funds your own position, not the trader. Each time this trader funds their fund, a share of your deposited ${symbol} follows alongside them by the rules below. Funds move only at that moment, never before.`,
              palette.foreground,
              '15px'
            )
          ),

          $FieldLabeled({
            label: $fieldLabel('Allocate %', $allocateExplainer),
            value: map(x => (x ? `${Math.round(formatFixed(4, x) * 100 * 100) / 100}` : ''), allocationRate),
            placeholder: `${formatFixed(4, defaultDraft.allocationRate) * 100}`,
            labelWidth: 150,
            validation: allocationValidation,
            hint: `Share of your ${symbol} per funding request`
          })({
            change: inputAllocationRateTether(
              map(x => {
                const n = Number(String(x).trim())
                if (!Number.isFinite(n) || n <= 0) return 0n
                const rate = parseBps(n / 100)
                return rate > maxAllocationRate ? maxAllocationRate : rate
              })
            )
          }),

          $FieldLabeled({
            label: $fieldLabel('Cap vs trader %', $symmetryExplainer),
            labelWidth: 150,
            value: map(x => (x > 0n ? `${Math.round(formatFixed(4, x) * 10000) / 100}` : ''), symmetry),
            placeholder: 'off',
            hint: 'Commit at most this share of what the trader commits'
          })({
            change: inputSymmetryTether(
              map(x => {
                const n = Number(String(x).trim())
                return Number.isFinite(n) && n > 0 ? parseBps(n / 100) : 0n
              })
            )
          }),

          style({ margin: '10px 0' })(
            $labeledDivider(
              $Checkbox({ value: advancedEnabled, label: 'Advanced Rules' })({
                check: changeAdvancedTether()
              })
            )
          ),

          $row(
            switchMap(isEnabled => {
              if (!isEnabled) return empty

              return $column(spacing.default)(
                $FieldLabeled({
                  label: $fieldLabel('Max per round', $rateLimitExplainer),
                  labelWidth: 150,
                  value: map(x => (x > 0n ? `${formatFixed(decimals, x)}` : ''), rateLimit),
                  placeholder: 'no cap',
                  hint: `Hard cap per allocation, in ${symbol}`
                })({
                  change: inputRateLimitTether(
                    map(v => {
                      const amount = Number(String(v).trim())
                      return Number.isFinite(amount) && amount > 0 ? parseFixed(decimals, amount) : 0n
                    })
                  )
                }),

                $Dropdown({
                  $anchor: $FieldLabeled({
                    label: $fieldLabel('Throttle', $throttleExplainer),
                    value: map(o(Number, getDuration), throttlePeriod),
                    placeholder: getDuration(Number(defaultDraft.throttlePeriod)),
                    labelWidth: 150,
                    hint: 'Minimum time between allocations'
                  })({}),
                  $container: $row(style({ right: '0', position: 'relative' })),
                  $$option: map(tf => $node($text(getDuration(Number(tf))))),
                  optionList: [
                    IntervalTime.HR,
                    IntervalTime.HR2,
                    IntervalTime.HR6,
                    IntervalTime.HR12,
                    IntervalTime.DAY,
                    IntervalTime.WEEK
                  ]
                })({ select: changeThrottlePeriodTether(map(BigInt)) }),

                $FieldLabeled({
                  label: $fieldLabel('Freeze at %', $exitFreezeExplainer),
                  labelWidth: 150,
                  value: map(x => (x > 0n ? `${formatFixed(4, x) * 100}` : ''), exitFreeze),
                  placeholder: 'off',
                  hint: 'Fully freeze once this share of the pool is exiting'
                })({
                  change: inputExitFreezeTether(
                    map(x => {
                      const n = Number(String(x).trim())
                      return Number.isFinite(n) && n > 0 ? parseBps(n / 100) : 0n
                    })
                  )
                })
              )
            }, advancedEnabled)
          ),

          $row(style({ placeContent: 'space-between', alignItems: 'center' }))(
            $ButtonSecondary({
              $content: $text('Remove'),
              disabled: map(
                list =>
                  !isSubscribed && !list.some(x => getMasterMatchingKey(x.baseToken, x.master) === masterMatchingKey),
                draftMatchingRuleList
              )
            })({
              click: clickRemoveTether()
            }),
            $ButtonPrimaryOutline({
              $content: $text('Save'),
              disabled: map(
                ({ draft, validationMessage }) => !draft.allocationRate || validationMessage !== null,
                combine({ draft, validationMessage: allocationValidation })
              )
            })({ click: saveTether() })
          )
        ),

        {
          changeMatchRuleList: merge(
            sampleMap(
              params => {
                const modelIndex = params.draftMatchingRuleList.findIndex(
                  x => getMasterMatchingKey(x.baseToken, x.master) === masterMatchingKey
                )
                if (modelIndex > -1) {
                  params.draftMatchingRuleList[modelIndex] = {
                    ...params.draftMatchingRuleList[modelIndex],
                    ...params.draft
                  }
                  return [...params.draftMatchingRuleList]
                }
                return [
                  ...params.draftMatchingRuleList,
                  { masterMatchingKey, baseToken, master, name, ...params.draft } as ISubscribeRule
                ]
              },
              combine({ draftMatchingRuleList, draft }),
              save
            ),
            sampleMap(
              params => {
                if (!isSubscribed) {
                  return params.draftMatchingRuleList.filter(
                    x => getMasterMatchingKey(x.baseToken, x.master) !== masterMatchingKey
                  )
                }
                const modelIndex = params.draftMatchingRuleList.findIndex(
                  x => getMasterMatchingKey(x.baseToken, x.master) === masterMatchingKey
                )
                if (modelIndex > -1) {
                  params.draftMatchingRuleList[modelIndex] = {
                    ...params.draftMatchingRuleList[modelIndex],
                    ...RULE_REVOKED
                  }
                  return [...params.draftMatchingRuleList]
                }
                return [
                  ...params.draftMatchingRuleList,
                  { masterMatchingKey, baseToken, master, name, ...RULE_REVOKED } as ISubscribeRule
                ]
              },
              combine({ draftMatchingRuleList, draft }),
              clickRemove
            )
          )
        }
      ]
    }
  )
