import { type IRuleBody, RULE_REVOKED } from '@puppet/sdk/attestation'
import { IntervalTime } from '@puppet/sdk/const'
import { formatFixed, getDuration, getMasterMatchingKey, getRegisteredTokenDescription, parseBps, parseFixed } from '@puppet/sdk/core'
import {
  combine,
  combineMap,
  empty,
  type IStream,
  just,
  map,
  merge,
  o,
  sampleMap,
  start,
  switchMap,
  toStream
} from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import type { Address, Hex } from 'viem'
import { $ButtonSecondary, $Checkbox, $Dropdown, $FieldLabeled, $infoTooltip, $labeledDivider, text } from '@/ui-components'
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
      [changeSymmetry, changeSymmetryTether]: IBehavior<boolean, bigint>,
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
      const tokenDesc = getRegisteredTokenDescription(baseToken)
      const { decimals, symbol } = tokenDesc

      const $hint = (short: string, detail: string): I$Node =>
        $row(spacing.small, style({ alignItems: 'center' }))(
          $node(style({ color: palette.foreground, fontSize: text.xs }))($text(short)),
          $infoTooltip(detail, palette.foreground, '14px')
        )

      const defaultDraft: IRuleBody = {
        throttlePeriod: BigInt(IntervalTime.HR),
        rateLimit: 0n,
        exitFreeze: parseBps(1),
        allocationRate: 1000n,
        symmetry: 1n
      }

      const allocationRate = model ? start(model.allocationRate, inputAllocationRate) : inputAllocationRate
      const rateLimit = model ? start(model.rateLimit, inputRateLimit) : inputRateLimit
      const throttlePeriod = model ? start(model.throttlePeriod, changeThrottlePeriod) : changeThrottlePeriod
      const symmetry = start(model ? model.symmetry : defaultDraft.symmetry, changeSymmetry)
      const exitFreeze = start(model ? model.exitFreeze : defaultDraft.exitFreeze, inputExitFreeze)

      const draft = combineForm({ throttlePeriod, rateLimit, exitFreeze, allocationRate, symmetry }, defaultDraft)

      const isSubscribed = !!model && model.allocationRate > 0n

      // Allocate % bounds: bps with 4 decimals where parseBps(1) === 100%
      const maxAllocationRate = parseBps(1)
      const allocationValidation = map(
        rate => (rate <= 0n || rate > maxAllocationRate ? 'Enter a value between 1% and 100%' : null),
        allocationRate
      )

      return [
        $column(spacing.default, style({ maxWidth: '350px' }))(
          $row(spacing.small, style({ alignItems: 'center' }))(
            $node(style({ fontWeight: '500', color: palette.message }))($text(`Fund this trader with your ${symbol}`)),
            $infoTooltip(
              `Each time this trader funds their fund (a funding request), a share of your deposited ${symbol} is committed alongside them, by the rules below. Funds move only at that moment, never before.`,
              palette.foreground,
              '15px'
            )
          ),

          $FieldLabeled({
            label: 'Allocate %',
            value: map(x => (x ? `${Math.round(formatFixed(4, x) * 100 * 100) / 100}` : ''), allocationRate),
            placeholder: `${formatFixed(4, defaultDraft.allocationRate) * 100}`,
            labelWidth: 150,
            validation: allocationValidation,
            hint: $hint(
              `Share of your ${symbol} per funding request`,
              `The portion of your deposited ${symbol} committed each time this trader funds their fund, recomputed live from your balance. Lower means smaller allocations and more headroom; it never locks funds.`
            )
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

          $Checkbox({
            value: map(x => x > 0n, symmetry),
            label: 'Never commit more than the trader does'
          })({ check: changeSymmetryTether(map(checked => (checked ? 1n : 0n))) }),

          switchMap(
            adv =>
              adv
                ? empty
                : $row(spacing.small, style({ alignItems: 'center' }))(
                    $node(style({ fontSize: text.xs, color: palette.foreground }))($text('Throttle')),
                    $node(style({ fontSize: text.xs, color: palette.message }))(
                      $text(map(tp => getDuration(Number(tp)), throttlePeriod))
                    ),
                    $infoTooltip(
                      'Minimum time between allocations; allocations sooner than this are skipped. Adjust in Advanced Rules.',
                      palette.foreground,
                      '13px'
                    )
                  ),
            advancedEnabled
          ),

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
                  label: 'Per-round cap',
                  labelWidth: 150,
                  value: map(x => (x > 0n ? `${formatFixed(decimals, x)}` : ''), rateLimit),
                  placeholder: 'no cap',
                  hint: $hint(
                    `Max ${symbol} per allocation`,
                    `A hard ceiling on the amount committed in any single allocation, in ${symbol}, regardless of your allocate %. Leave empty for no cap. Enforced on-chain.`
                  )
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
                    label: 'Activity throttle',
                    value: map(o(Number, getDuration), throttlePeriod),
                    placeholder: getDuration(Number(defaultDraft.throttlePeriod)),
                    labelWidth: 150,
                    hint: $hint(
                      'Minimum time between allocations',
                      "Allocations that arrive sooner than this after your last one are skipped, so you don't allocate on every rapid adjustment. Enforced on-chain."
                    )
                  })({}),
                  $container: $row(style({ right: '0', position: 'relative' })),
                  $$option: map(tf => $node($text(getDuration(Number(tf))))),
                  optionList: [IntervalTime.HR, IntervalTime.HR2, IntervalTime.HR6, IntervalTime.DAY, IntervalTime.WEEK]
                })({ select: changeThrottlePeriodTether(map(BigInt)) }),

                $FieldLabeled({
                  label: 'Exit freeze %',
                  labelWidth: 150,
                  value: map(x => (x > 0n ? `${formatFixed(4, x) * 100}` : ''), exitFreeze),
                  placeholder: 'off',
                  hint: $hint(
                    'Ease off when puppets are exiting',
                    "Scales down, then stops, new allocations as this trader's redeem queue grows toward this share of the pool, so you don't pile into a fund people are leaving. Defaults to 100% — your allocation eases off in proportion to the queue (50% queued → 50% smaller). Lower it to freeze sooner; clear to disable."
                  )
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
            $ButtonSecondary({
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
