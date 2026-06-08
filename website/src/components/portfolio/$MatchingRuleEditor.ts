import { type IRuleBody, RULE_REVOKED } from '@puppet/sdk/attestation'
import { IntervalTime } from '@puppet/sdk/const'
import { formatFixed, getDuration, getMasterMatchingKey, parseBps, parseFixed } from '@puppet/sdk/core'
import { getTokenDescription } from '@puppet/sdk/gmx'
import {
  combine,
  empty,
  type IStream,
  just,
  map,
  merge,
  o,
  sampleMap,
  start,
  switchMap,
  toStream,
  zipMap
} from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import type { Address, Hex } from 'viem'
import { $ButtonSecondary, $Checkbox, $Dropdown, $FieldLabeled } from '@/ui-components'
import { uiStorage } from '@/ui-storage'
import { localStoreSchema } from '../../app/localStoreSchema.js'
import { $labeledDivider } from '../../common/elements/$common.js'
import type { ISubscribeRule } from '../../io/indexer/query.js'

export type { ISubscribeRule }

export type I$MatchingRuleEditor = {
  model?: ISubscribeRule
  masterMatchingKey: Hex
  baseToken: Address
  master: Address
  draftMatchingRuleList: IStream<ISubscribeRule[]>
}

type InputStateParams<T> = { [P in keyof T]: IStream<T[P]> | T[P] }

function combineForm<A, K extends keyof A = keyof A>(state: InputStateParams<A>, defaultState: A): IStream<A> {
  const entries = Object.entries(state) as [keyof A, IStream<A[K]> | A[K]][]
  if (entries.length === 0) return just({} as A)
  const streams = entries.map(([key, stream]) => start(defaultState[key], toStream(stream)))
  return zipMap(
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

      const { model, masterMatchingKey, draftMatchingRuleList, baseToken, master } = config
      const decimals = getTokenDescription(baseToken).decimals

      const defaultDraft: IRuleBody = {
        throttlePeriod: BigInt(IntervalTime.HR),
        rateLimit: 0n,
        exitFreeze: 0n,
        allocationRate: 1000n,
        symmetry: 0n
      }

      const allocationRate = model ? start(model.allocationRate, inputAllocationRate) : inputAllocationRate
      const rateLimit = model ? start(model.rateLimit, inputRateLimit) : inputRateLimit
      const throttlePeriod = model ? start(model.throttlePeriod, changeThrottlePeriod) : changeThrottlePeriod
      const symmetry = model ? start(model.symmetry, changeSymmetry) : changeSymmetry
      const exitFreeze = model ? start(model.exitFreeze, inputExitFreeze) : inputExitFreeze

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
          $text('These rules apply whenever this master opens and maintains a position'),

          $FieldLabeled({
            label: 'Allocate %',
            value: map(x => (x ? `${Math.round(formatFixed(4, x) * 100 * 100) / 100}` : ''), allocationRate),
            placeholder: `${formatFixed(4, defaultDraft.allocationRate) * 100}`,
            labelWidth: 150,
            validation: allocationValidation,
            hint: '% of your deposited balance committed each match. Lower values reduce risk and allow greater monitoring'
          })({
            change: inputAllocationRateTether(
              map(x => {
                const rate = parseBps(Number(x) / 100)
                return rate > maxAllocationRate ? maxAllocationRate : rate
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
                  label: 'Per-round cap',
                  labelWidth: 150,
                  value: map(x => (x > 0n ? `${formatFixed(decimals, x)}` : ''), rateLimit),
                  placeholder: 'no cap',
                  hint: 'Hard cap on the amount committed per match, in token units. Empty means no cap.'
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
                    hint: 'Ignore matches that are too close to each other in time'
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
                  hint: 'Scale down new matches as this master’s redeem queue exceeds this % of the pool. Empty disables it.'
                })({
                  change: inputExitFreezeTether(map(x => parseBps(Number(x) / 100)))
                }),

                $Checkbox({
                  value: map(x => x > 0n, symmetry),
                  label: 'Commit no more than the master does'
                })({ check: changeSymmetryTether(map(checked => (checked ? 1n : 0n))) })
              )
            }, advancedEnabled)
          ),

          $node(),

          $row(style({ placeContent: 'space-between', alignItems: 'center' }))(
            $ButtonSecondary({ $content: $text('Remove'), disabled: just(!isSubscribed) })({
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
                  { masterMatchingKey, baseToken, master, ...params.draft } as ISubscribeRule
                ]
              },
              combine({ draftMatchingRuleList, draft }),
              save
            ),
            sampleMap(
              params => {
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
                  { masterMatchingKey, baseToken, master, ...RULE_REVOKED } as ISubscribeRule
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
