import { HUB_CANONICAL_TOKEN, HUB_CHAIN_ID } from '@puppet/contracts/const'
import { SESSION_TTL_MS } from '@puppet/sdk/account'
import type { IMandateDraft } from '@puppet/sdk/client'
import { PRECISION } from '@puppet/sdk/const'
import { getTokenDescription, getUnixTimestamp, readableDate, readablePercentage } from '@puppet/sdk/core'
import type { IMandateRow } from '@puppet/sdk/schema'
import { combine, constant, filter, filterNull, type IStream, just, map, merge, op, reduce, sampleMap, start, switchMap, take } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, type I$Node, type I$Slottable, type INode, nodeEvent, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Address } from 'viem'
import {
  $ButtonPrimary,
  $ButtonSecondary,
  $Dropdown,
  $defaultDropdownContainer,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $FieldLabeled,
  $infoTooltip,
  $labelDisplay,
  $labeledDivider,
  $popoverCaret,
  keyActivate,
  text
} from '@/ui-components'
import { mandateTermsOf } from '../$MandatePosition.js'
import { $editorPercentSlider } from './editorUtils.js'

const COOLDOWN_OPTIONS = [0n, 3600n, 21_600n, 43_200n, 86_400n, 604_800n]
const DEFAULT_COOLDOWN = 21_600n
const EXPIRY_OPTIONS = [604_800n, 2_592_000n, 7_776_000n, 31_536_000n, 63_072_000n]
const DEFAULT_EXPIRY = 7_776_000n
const DEFAULT_ALLOCATION_RATE = 2_500n
const DEFAULT_SKIN = 10_000n
const DEFAULT_EXIT_CAP = 5_000n
const RATE = Number(PRECISION.basisPoints)

const EXAMPLE_MATCHABLE = 100
const EXAMPLE_MASTER = 100
const EXAMPLE_WINDOW_HOURS = 192
const EXAMPLE_OPEN_HOURS = [0, 2, 10, 40, 56, 110, 176]
const roundSymbols = Object.values(HUB_CANONICAL_TOKEN).map(token => getTokenDescription(HUB_CHAIN_ID, token).symbol).join(', ')

const ratePercent = (v: number): string => readablePercentage(BigInt(Math.round(v * RATE)))
const leverageLabel = (v: number): string => (v === 0 ? 'Uncapped' : `${Number(v.toPrecision(2))}x`)
const skinPosition = (v: number): number => (v === 0 ? 1 : Math.min(1, Math.max(0, (Math.log10(v) + 1) / 2)))
const exampleAmount = (n: number): string => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

const DAY = 86_400n
const DURATION_UNITS = [
  { seconds: 31_536_000n, label: 'year' },
  { seconds: 604_800n, label: 'week' },
  { seconds: 86_400n, label: 'day' },
  { seconds: 3_600n, label: 'hr' },
  { seconds: 60n, label: 'min' }
] as const
const UNIT_SECONDS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3_600, hr: 3_600, hrs: 3_600, hour: 3_600, hours: 3_600,
  d: 86_400, day: 86_400, days: 86_400,
  w: 604_800, wk: 604_800, week: 604_800, weeks: 604_800,
  y: 31_536_000, yr: 31_536_000, yrs: 31_536_000, year: 31_536_000, years: 31_536_000
}

const readableDuration = (period: bigint): string => {
  if (period === 0n) return 'None'
  const unit = DURATION_UNITS.find(u => period % u.seconds === 0n)
  if (unit === undefined) return `${period} secs`
  const count = period / unit.seconds
  return `${count} ${unit.label}${count === 1n ? '' : 's'}`
}

const parseDuration = (input: string): bigint | null => {
  const value = input.trim().toLowerCase()
  if (value === 'none' || value === '0') return 0n
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/)
  if (match === null) return null
  const seconds = UNIT_SECONDS[match[2]!]
  return seconds === undefined ? null : BigInt(Math.round(Number(match[1]) * seconds))
}

const $explainer = (lead: string, $body: I$Node): I$Node =>
  $column(spacing.default, style({ maxWidth: '340px', whiteSpace: 'normal' }))(
    $node(style({ fontSize: text.sm, color: palette.message, lineHeight: '1.4' }))($text(lead)),
    $body
  )

const $caption = (label: string | IStream<string>): I$Node => $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($text(label))

const $rowLabel = (label: string): I$Node =>
  $node(style({ fontSize: text.xs, color: palette.foreground, width: '112px', flexShrink: 0 }))($text(label))

const $meterRow = (label: string, fraction: number, amount: string): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $rowLabel(label),
    $node(style({ width: '140px', height: '8px', borderRadius: '4px', flexShrink: 0, overflow: 'hidden', backgroundColor: colorShade(palette.foreground, 25) }))(
      $node(style({ height: '100%', borderRadius: '4px', backgroundColor: palette.primary }), styleBehavior(just({ width: `${Math.min(100, Math.max(0, fraction * 100))}%` })))()
    ),
    $node(style({ fontSize: text.xs, color: palette.message, whiteSpace: 'nowrap', flex: 1, textAlign: 'right' }))($text(amount))
  )

const $timelineRow = (label: string, dots: readonly { at: number; on: boolean }[]): I$Node =>
  $row(spacing.small, style({ alignItems: 'center' }))(
    $rowLabel(label),
    $node(style({ position: 'relative', width: '140px', height: '10px', flexShrink: 0 }))(
      $node(style({ position: 'absolute', top: '4px', left: '0', right: '0', height: '2px', borderRadius: '1px', backgroundColor: colorShade(palette.foreground, 25) }))(),
      ...dots.map(dot =>
        $node(
          style({ position: 'absolute', top: '0', width: '10px', height: '10px', marginLeft: '-5px', borderRadius: '50%' }),
          styleBehavior(just({ left: `${dot.at * 100}%`, backgroundColor: dot.on ? palette.primary : colorShade(palette.foreground, 40) }))
        )()
      )
    )
  )

export interface I$MandateEditor {
  master: Address
  existing: IMandateRow | undefined
  draft: IStream<IMandateDraft | null>
}

export const $MandateEditor = ({ master, existing, draft }: I$MandateEditor) =>
  component(
    (
      [changeAllocation, changeAllocationTether]: IBehavior<number>,
      [changeSkin, changeSkinTether]: IBehavior<number>,
      [changeExitCap, changeExitCapTether]: IBehavior<number>,
      [selectCooldown, selectCooldownTether]: IBehavior<bigint>,
      [typeCooldown, typeCooldownTether]: IBehavior<string>,
      [selectExpiry, selectExpiryTether]: IBehavior<bigint>,
      [typeExpiry, typeExpiryTether]: IBehavior<string>,
      [clickAdd, clickAddTether]: IBehavior<PointerEvent>,
      [clickEnd, clickEndTether]: IBehavior<PointerEvent>,
      [toggleAdvanced, toggleAdvancedTether]: IBehavior<INode, PointerEvent>
    ) => {
      const nowSec = getUnixTimestamp()
      const until = existing === undefined ? null : mandateTermsOf(existing).until
      const active = until !== null && until > BigInt(nowSec) ? existing : undefined
      const drafted = op(draft, take(1), filterNull, map(d => d.mandate), state())
      const allocation: IStream<number> = state(
        Number(active?.allocationRate ?? DEFAULT_ALLOCATION_RATE) / RATE,
        merge(changeAllocation, map(m => Number(m.allocationRate) / RATE, drafted))
      )
      const skin: IStream<number> = state(Number(active?.skin ?? DEFAULT_SKIN) / RATE, merge(changeSkin, map(m => Number(m.skin) / RATE, drafted)))
      const exitCap: IStream<number> = state(Number(active?.exitCap ?? DEFAULT_EXIT_CAP) / RATE, merge(changeExitCap, map(m => Number(m.exitCap) / RATE, drafted)))
      const initialCooldown = active?.cooldownPeriod ?? DEFAULT_COOLDOWN
      const cooldown: IStream<bigint | null> = state(
        initialCooldown as bigint | null,
        merge(selectCooldown, map(parseDuration, typeCooldown), map(m => m.cooldownPeriod, drafted))
      )
      const cooldownText: IStream<string> = start(readableDuration(initialCooldown), merge(map(readableDuration, selectCooldown), map(m => readableDuration(m.cooldownPeriod), drafted)))
      const cooldownError: IStream<string | null> = merge(
        map(text => (parseDuration(text) === null ? 'Type a duration like 30m, 6h or 2d' : null), typeCooldown),
        map(() => null, selectCooldown)
      )
      const parseExpiry = (input: string): bigint | null => {
        const period = parseDuration(input)
        return period === null || period === 0n ? null : period
      }
      const draftedExpiry: IStream<bigint> = op(
        drafted,
        map(m => m.expiry - BigInt(getUnixTimestamp())),
        filter(left => left > 0n),
        map(left => (left < DAY ? DAY : ((left + DAY / 2n) / DAY) * DAY))
      )
      const expiryIn: IStream<bigint | null> = state(DEFAULT_EXPIRY as bigint | null, merge(selectExpiry, map(parseExpiry, typeExpiry), draftedExpiry))
      const expiryText: IStream<string> = start(readableDuration(DEFAULT_EXPIRY), merge(map(readableDuration, selectExpiry), map(readableDuration, draftedExpiry)))
      const expiryError: IStream<string | null> = merge(
        map(text => (parseExpiry(text) === null ? 'Type a duration like 30d, 12w or 1y' : null), typeExpiry),
        map(() => null, selectExpiry)
      )
      const expiryEdited: IStream<boolean> = state(false, constant(true, merge(selectExpiry, typeExpiry)))
      const advanced: IStream<boolean> = state(false, reduce((open: boolean) => !open, false, toggleAdvanced))
      const terms = combine({ allocation, skin, exitCap, cooldown, expiryIn })

      const toDraft = (p: { allocation: number; skin: number; exitCap: number; cooldown: bigint; expiryIn: bigint }): IMandateDraft => ({
        kind: 'mandate',
        id: `mandate:${master}`,
        mandate: {
          master,
          skin: BigInt(Math.round(p.skin * RATE)),
          allocationRate: BigInt(Math.round(p.allocation * RATE)),
          exitCap: BigInt(Math.round(p.exitCap * RATE)),
          cooldownPeriod: p.cooldown,
          expiry: BigInt(getUnixTimestamp()) + p.expiryIn
        }
      })

      const $rateExplainer = $explainer(
        'The most each round takes of your deposit. Skin caps how much of the fund you can hold.',
        switchMap(
          rate =>
            $column(spacing.small)(
              $meterRow('Your deposit', 1, exampleAmount(EXAMPLE_MATCHABLE)),
              $meterRow(`Round 1 at ${ratePercent(rate)}`, rate, exampleAmount(EXAMPLE_MATCHABLE * rate)),
              $meterRow('Round 2', rate * (1 - rate), exampleAmount(EXAMPLE_MATCHABLE * rate * (1 - rate))),
              $meterRow('Round 3', rate * (1 - rate) ** 2, exampleAmount(EXAMPLE_MATCHABLE * rate * (1 - rate) ** 2)),
              $caption(`Your deposit is your ${roundSymbols} on the hub: the most any fund can draw on, shared by every fund you mandate. Native ETH does not count.`),
              $caption(
                "A share, not an amount: rounds shrink as your balance does and never take all of it, where a fixed amount takes a bigger bite after every loss. A lower rate spreads your balance over more of the master's rounds."
              )
            ),
          allocation
        )
      )

      const $skinExplainer = $explainer(
        "Your cap in this fund, compared with the master's own stake.",
        switchMap(leverage => {
          if (leverage === 0) return $caption("Uncapped: you can hold any amount of this fund, whatever the master's own stake.")
          const cap = EXAMPLE_MASTER * leverage
          const scale = Math.max(EXAMPLE_MASTER, cap)
          return $column(spacing.small)(
            $meterRow('Master', EXAMPLE_MASTER / scale, exampleAmount(EXAMPLE_MASTER)),
            $meterRow('You', cap / scale, exampleAmount(cap)),
            $caption(
              `You can hold up to ${leverageLabel(leverage)} the master's stake. The master's own money is in the same fund at the same price, so it rises and falls with yours.`
            )
          )
        }, skin)
      )

      const $exitCapExplainer = $explainer(
        'Allocates less as puppets queue to exit, and nothing once the queue reaches this share.',
        switchMap(p => {
          const round = EXAMPLE_MATCHABLE * p.allocation
          return $column(spacing.small)(
            $meterRow('Nobody leaving', round / EXAMPLE_MATCHABLE, exampleAmount(round)),
            $meterRow(`${ratePercent(p.exitCap / 2)} leaving`, round / 2 / EXAMPLE_MATCHABLE, exampleAmount(round / 2)),
            $meterRow(`${ratePercent(p.exitCap)} leaving`, 0, exampleAmount(0)),
            $caption('Protects you from joining a fund its puppets are rushing out of.')
          )
        }, combine({ exitCap, allocation }))
      )

      const $cooldownExplainer = $explainer(
        "After a round you join, you sit out this fund's rounds until the cooldown passes.",
        switchMap((period: bigint) => {
          const hours = Number(period) / 3600
          let lastMatched: number | null = null
          const dots = EXAMPLE_OPEN_HOURS.map(hour => {
            const on = lastMatched === null || hour - lastMatched >= hours
            if (on) lastMatched = hour
            return { at: hour / EXAMPLE_WINDOW_HOURS, on }
          })
          return $column(spacing.small)(
            $timelineRow('Master allocates', dots.map(dot => ({ at: dot.at, on: true }))),
            $timelineRow('You join', dots),
            $caption(
              period === 0n
                ? 'No cooldown: you can join every round this master opens.'
                : `With ${readableDuration(period)} between your rounds, grey rounds go ahead without you.`
            ),
            ...(period === 0n
              ? []
              : [$caption('Rounds you sit out are entries you miss, good and bad. If the master adds at a low while you wait, their average entry ends below yours.')])
          )
        }, filter((period): period is bigint => period !== null, cooldown))
      )

      const $sliderField = (
        label: string,
        $explainer: I$Slottable,
        $value: I$Slottable,
        $slider: I$Node,
        hint: string,
        validation: IStream<string | null>
      ): I$Node =>
        $column(spacing.small, style({ width: '100%' }))(
          $row(spacing.small, style({ width: '100%' }))(
            $labelDisplay(style({ width: '128px', minWidth: '128px' }))(
              $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($text(label), $infoTooltip($explainer, palette.foreground))
            ),
            $row(spacing.small, style({ flex: 1, minWidth: '0', alignItems: 'center', height: '48px', padding: '0 10px', backgroundColor: palette.background }))(
              $node(style({ display: 'flex', flex: 1, minWidth: '0' }))($slider),
              $node(style({ fontWeight: '600', fontSize: text.sm, minWidth: '56px', textAlign: 'right' }))($value)
            )
          ),
          $node(style({ fontSize: text.xs, lineHeight: '1.5' }))(
            switchMap(error => $node(style({ color: error === null ? palette.foreground : palette.negative }))($text(error ?? hint)), validation)
          )
        )

      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $sliderField(
            'Skin',
            $skinExplainer,
            $node(styleBehavior(map(s => ({ color: `color-mix(in srgb, ${palette.negative} ${Math.round(skinPosition(s) * 100)}%, ${palette.positive})` }), skin)))(
              $text(map(leverageLabel, skin))
            ),
            $editorPercentSlider({
              value: map(skinPosition, skin),
              disabled: just(false),
              error: just(false),
              ariaLabel: 'skin leverage',
              color: just('transparent'),
              trackColor: just(`linear-gradient(to right, ${palette.positive}, ${palette.negative})`)
            })({
              change: changeSkinTether(map(t => (t >= 1 ? 0 : Number((10 ** (2 * t - 1)).toPrecision(2)))))
            }),
            "Your cap, as a multiple of the master's own stake",
            just(null)
          ),
          $sliderField(
            'Rate',
            $rateExplainer,
            $text(map(ratePercent, allocation)),
            $editorPercentSlider({ value: allocation, disabled: just(false), error: map(a => a >= 1 || Math.round(a * RATE) === 0, allocation), ariaLabel: 'allocation rate' })({
              change: changeAllocationTether()
            }),
            'The most of your deposit one round can take',
            map(
              a =>
                a >= 1
                  ? 'A mandate cannot take 100%: part of your deposit stays back to pay your sell fee.'
                  : Math.round(a * RATE) === 0
                    ? 'At 0% you join no round'
                    : null,
              allocation
            )
          ),
          $FieldLabeled({
            label: $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($text('Cooldown'), $infoTooltip($cooldownExplainer, palette.foreground)),
            labelWidth: 128,
            value: cooldownText,
            placeholder: 'Type a duration, e.g. 6h',
            hint: 'How long you sit out after joining a round',
            validation: cooldownError,
            $$field: $field =>
              $Dropdown<bigint>({
                $container: $defaultDropdownContainer(style({ display: 'flex', flex: 1, minWidth: '0' })),
                $anchor: $field,
                optionList: COOLDOWN_OPTIONS,
                $$option: map(period => $node($text(readableDuration(period))))
              })({ select: selectCooldownTether() })
          })({ change: typeCooldownTether() }),
          $node(style({ cursor: 'pointer' }), attr({ role: 'button', tabindex: '0' }), keyActivate(), toggleAdvancedTether(nodeEvent('click')))(
            $labeledDivider(
              $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, whiteSpace: 'nowrap' }))(
                $text('Advanced'),
                $node(style({ display: 'flex' }), styleBehavior(map(open => ({ transform: open ? 'rotate(180deg)' : 'none' }), advanced)))($popoverCaret())
              )
            )
          ),
          $node(style({ display: 'contents' }), styleBehavior(map(open => (open ? { display: 'contents' } : { display: 'none' }), advanced)))(
          $FieldLabeled({
            label: $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
              $text('Expiry'),
              $infoTooltip(
                'Ends at this date, or with the session that signed it. A change replaces the whole mandate.',
                palette.foreground
              )
            ),
            labelWidth: 128,
            value: expiryText,
            placeholder: 'Type a duration, e.g. 30d',
            hint: map(
              period =>
                period === null
                  ? ''
                  : `Allocating until ${readableDate(getUnixTimestamp() + Math.min(Number(period), SESSION_TTL_MS / 1000))} at the latest${active && until !== null ? `, currently until ${readableDate(Number(until))}` : ''}`,
              expiryIn
            ),
            validation: expiryError,
            $$field: $field =>
              $Dropdown<bigint>({
                $container: $defaultDropdownContainer(style({ display: 'flex', flex: 1, minWidth: '0' })),
                $anchor: $field,
                optionList: EXPIRY_OPTIONS,
                $$option: map(period => $node($text(readableDuration(period))))
              })({ select: selectExpiryTether() })
          })({ change: typeExpiryTether() }),
          $sliderField(
            'Exit cap',
            $exitCapExplainer,
            $text(map(ratePercent, exitCap)),
            $editorPercentSlider({ value: exitCap, disabled: just(false), error: map(c => c === 0, exitCap), ariaLabel: 'exit cap' })({
              change: changeExitCapTether()
            }),
            'Sit out once this share of the fund is queued to exit',
            map(c => (c === 0 ? 'At 0% you sit out every round' : null), exitCap)
          )
          ),
          $row(spacing.small, style({ justifyContent: 'flex-end', alignItems: 'center' }))(
            ...(active === undefined ? [] : [$ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('End mandate') })({ click: clickEndTether() })]),
            $ButtonPrimary({
              $container: $defaultMiniButtonPrimary,
              disabled: map(p => {
                const saved = p.draft === null ? active : p.draft.mandate
                return (
                  p.cooldown === null ||
                  p.expiryIn === null ||
                  p.allocation >= 1 ||
                  Math.round(p.allocation * RATE) === 0 ||
                  p.exitCap === 0 ||
                  (saved !== undefined &&
                    !p.edited &&
                    BigInt(Math.round(p.skin * RATE)) === saved.skin &&
                    BigInt(Math.round(p.allocation * RATE)) === saved.allocationRate &&
                    BigInt(Math.round(p.exitCap * RATE)) === saved.exitCap &&
                    p.cooldown === saved.cooldownPeriod)
                )
              }, combine({ cooldown, expiryIn, allocation, skin, exitCap, edited: expiryEdited, draft })),
              $content: $text(map(d => (d !== null || active !== undefined ? 'Save' : 'Allocate to this fund'), start(null, draft)))
            })({ click: clickAddTether() })
          )
        ),
        {
          changeMandateDraft: merge(
            op(
              sampleMap(p => p, terms, clickAdd),
              filter(
                (p): p is { allocation: number; skin: number; exitCap: number; cooldown: bigint; expiryIn: bigint } =>
                  p.cooldown !== null && p.expiryIn !== null && p.allocation < 1 && Math.round(p.allocation * RATE) > 0 && p.exitCap > 0
              ),
              map(toDraft)
            ),
            ...(active === undefined
              ? []
              : [
                  op(
                    clickEnd,
                    map(
                      (): IMandateDraft => ({
                        kind: 'mandate',
                        id: `mandate:${master}`,
                        mandate: { master, skin: active.skin, allocationRate: active.allocationRate, exitCap: active.exitCap, cooldownPeriod: active.cooldownPeriod, expiry: 0n }
                      })
                    )
                  )
                ])
          )
        }
      ]
    }
  )
