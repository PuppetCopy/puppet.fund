import { HUB_CHAIN_ID, PRECISION } from '@puppet/contracts/const'
import { getTokenDescription, getUnixTimestamp, readableDate, readablePercentage } from '@puppet/sdk/core'
import type { ChainId } from '@puppet/sdk/const'
import type { IMandateRow } from '@puppet/sdk/schema'
import { bondTokenOf, type ITokenRegistryMap } from '@puppet/sdk/state'
import { combine, filter, type IStream, just, map, merge, op, sampleMap, start, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, type I$Node, type I$Slottable, style, styleBehavior } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, type Hex, hexToString } from 'viem'
import {
  $ButtonPrimary,
  $ButtonSecondary,
  $Dropdown,
  $DropMultiSelect,
  $defaultDropdownContainer,
  $defaultDropMultiSelectAnchor,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $FieldLabeled,
  $infoTooltip,
  $labelDisplay,
  text
} from '@/ui-components'
import { chainName } from '../../common/$chain.js'
import { $tokenProfile } from '../../common/$common.js'
import type { IMandateDraft } from './draft.js'
import { $editorPercentSlider } from './editorUtils.js'

const COOLDOWN_OPTIONS = [0n, 3600n, 21_600n, 43_200n, 86_400n, 604_800n]
const DEFAULT_COOLDOWN = 21_600n
const EXPIRY_OPTIONS = [604_800n, 2_592_000n, 7_776_000n, 31_536_000n]
const DEFAULT_EXPIRY = 2_592_000n
const DEFAULT_SKIN = 5_000n
const RATE = Number(PRECISION.basisPoints)

const EXAMPLE_MATCHABLE = 1_000
const EXAMPLE_COLLATERAL = 400
const EXAMPLE_WINDOW_HOURS = 192
const EXAMPLE_OPEN_HOURS = [0, 2, 10, 40, 56, 110, 176]
const bondSymbol = getTokenDescription(HUB_CHAIN_ID, bondTokenOf(HUB_CHAIN_ID)).symbol

const ratePercent = (v: number): string => readablePercentage(BigInt(Math.round(v * RATE)))
const exampleAmount = (n: number): string => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${bondSymbol}`

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

const $caption = (label: string): I$Node => $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4' }))($text(label))

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
  registry: ITokenRegistryMap
  master: Address
  existing: IMandateRow | undefined
  draft: IStream<IMandateDraft | null>
}

export const $MandateEditor = ({ registry, master, existing, draft }: I$MandateEditor) =>
  component(
    (
      [changeAllocation, changeAllocationTether]: IBehavior<number>,
      [changeSkin, changeSkinTether]: IBehavior<number>,
      [selectCooldown, selectCooldownTether]: IBehavior<bigint>,
      [typeCooldown, typeCooldownTether]: IBehavior<string>,
      [selectExpiry, selectExpiryTether]: IBehavior<bigint>,
      [typeExpiry, typeExpiryTether]: IBehavior<string>,
      [selectTokens, selectTokensTether]: IBehavior<Hex[]>,
      [clickAdd, clickAddTether]: IBehavior<PointerEvent>,
      [clickLeave, clickLeaveTether]: IBehavior<PointerEvent>
    ) => {
      const nowSec = getUnixTimestamp()
      const active = existing !== undefined && existing.expiry > BigInt(nowSec) ? existing : undefined
      const assets = new Map<Hex, { chainId: ChainId; token: Address }>()
      for (const [chainId, chainMap] of registry) {
        for (const info of chainMap.values()) {
          if (!assets.has(info.tokenId) || chainId === HUB_CHAIN_ID) assets.set(info.tokenId, { chainId, token: info.token })
        }
      }
      const $asset = (id: Hex, size: number): I$Node => {
        const asset = assets.get(id)
        return asset === undefined ? $node($text(hexToString(id).replace(/\0+$/, ''))) : $tokenProfile(asset.chainId, asset.token, size)
      }
      const coversEveryToken = (list: readonly Hex[]): boolean => [...assets.keys()].every(id => list.includes(id))
      const seedTokens: Hex[] = active === undefined || coversEveryToken(active.tokenIdList) ? [] : [...active.tokenIdList]

      const allocation: IStream<number> = state(active ? Number(active.allocationRate) / RATE : 0.25, changeAllocation)
      const skin: IStream<number> = state(Number(active?.skin ?? DEFAULT_SKIN) / RATE, changeSkin)
      const initialCooldown = active?.cooldownPeriod ?? DEFAULT_COOLDOWN
      const cooldown: IStream<bigint | null> = state(initialCooldown as bigint | null, merge(selectCooldown, map(parseDuration, typeCooldown)))
      const cooldownText: IStream<string> = start(readableDuration(initialCooldown), map(readableDuration, selectCooldown))
      const cooldownError: IStream<string | null> = merge(
        map(text => (parseDuration(text) === null ? 'Type a duration like 30m, 6h or 2d' : null), typeCooldown),
        map(() => null, selectCooldown)
      )
      const parseExpiry = (input: string): bigint | null => {
        const period = parseDuration(input)
        return period === null || period === 0n ? null : period
      }
      const expiryIn: IStream<bigint | null> = state(DEFAULT_EXPIRY as bigint | null, merge(selectExpiry, map(parseExpiry, typeExpiry)))
      const expiryText: IStream<string> = start(readableDuration(DEFAULT_EXPIRY), map(readableDuration, selectExpiry))
      const expiryError: IStream<string | null> = merge(
        map(text => (parseExpiry(text) === null ? 'Type a duration like 30d, 12w or 1y' : null), typeExpiry),
        map(() => null, selectExpiry)
      )
      const selected: IStream<Hex[]> = state(seedTokens, selectTokens)
      const terms = combine({ allocation, skin, cooldown, expiryIn, selected })

      const toDraft = (p: { allocation: number; skin: number; cooldown: bigint; expiryIn: bigint; selected: readonly Hex[] } | null): IMandateDraft => ({
        kind: 'mandate',
        id: `mandate:${master}`,
        bond: 0n,
        mandate: {
          master,
          skin: p === null ? 0n : BigInt(Math.round(p.skin * RATE)),
          allocationRate: p === null ? 0n : BigInt(Math.round(p.allocation * RATE)),
          cooldownPeriod: p === null ? 0n : p.cooldown,
          expiry: p === null ? 0n : BigInt(getUnixTimestamp()) + p.expiryIn,
          tokenIdList: p === null ? [] : [...(p.selected.length === 0 ? assets.keys() : p.selected)].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
        }
      })

      const $shareExplainer = $explainer(
        'Each time this master opens a cycle by trading, at most this share of your matchable bond backs it.',
        switchMap(
          rate =>
            $column(spacing.small)(
              $meterRow('Matchable bond', 1, exampleAmount(EXAMPLE_MATCHABLE)),
              $meterRow(`Per match at ${ratePercent(rate)}`, rate, exampleAmount(EXAMPLE_MATCHABLE * rate)),
              $caption('Matchable is your bond not already backing an open cycle, shared by every master you back.')
            ),
          allocation
        )
      )

      const $skinExplainer = $explainer(
        'Your backing never exceeds this share of what the master puts up, so the master always has its own value next to yours.',
        switchMap(p => {
          const skinCap = EXAMPLE_COLLATERAL * p.skin
          const shareCap = EXAMPLE_MATCHABLE * p.allocation
          const backed = Math.min(skinCap, shareCap)
          return $column(spacing.small)(
            $meterRow('Master puts up', EXAMPLE_COLLATERAL / EXAMPLE_MATCHABLE, exampleAmount(EXAMPLE_COLLATERAL)),
            $meterRow(`Skin cap at ${ratePercent(p.skin)}`, skinCap / EXAMPLE_MATCHABLE, exampleAmount(skinCap)),
            $meterRow(`Share cap at ${ratePercent(p.allocation)}`, shareCap / EXAMPLE_MATCHABLE, exampleAmount(shareCap)),
            $meterRow('You back', backed / EXAMPLE_MATCHABLE, exampleAmount(backed)),
            $caption(
              `${skinCap <= shareCap ? 'Your skin cap binds here.' : 'Your share cap binds here.'} The master also limits total backing to its own skin; when backers ask for more, every stake scales down pro-rata.`
            )
          )
        }, combine({ skin, allocation }))
      )

      const $cooldownExplainer = $explainer(
        "After the attestor matches you into one of this master's cycles, it skips you until the cooldown has passed.",
        switchMap((period: bigint) => {
          const hours = Number(period) / 3600
          let lastMatched: number | null = null
          const dots = EXAMPLE_OPEN_HOURS.map(hour => {
            const on = lastMatched === null || hour - lastMatched >= hours
            if (on) lastMatched = hour
            return { at: hour / EXAMPLE_WINDOW_HOURS, on }
          })
          return $column(spacing.small)(
            $timelineRow('Master opens', dots.map(dot => ({ at: dot.at, on: true }))),
            $timelineRow('You are matched', dots),
            $caption(
              period === 0n
                ? 'No cooldown: you can be matched into every cycle this master opens.'
                : `With ${readableDuration(period)} between matches, the grey cycles open without you. The example spans 8 days.`
            )
          )
        }, filter((period): period is bigint => period !== null, cooldown))
      )

      const $term = (label: string, hint: string | I$Slottable, value: IStream<string>): I$Node =>
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', fontSize: text.sm }))(
          $row(spacing.tiny, style({ alignItems: 'center', color: palette.foreground }))($text(label), $infoTooltip(hint, palette.foreground)),
          $node(style({ fontWeight: '600' }))($text(value))
        )

      return [
        $column(spacing.default, style({ width: '394px', maxWidth: '100%' }))(
          $column(spacing.small)(
            $term('Share of your matchable bond per match', $shareExplainer, map(ratePercent, allocation)),
            $editorPercentSlider({ value: allocation, disabled: just(false), error: just(false), ariaLabel: 'allocation rate' })({
              change: changeAllocationTether()
            })
          ),
          $column(spacing.small)(
            $term('Skin you require', $skinExplainer, map(ratePercent, skin)),
            $editorPercentSlider({ value: skin, disabled: just(false), error: just(false), ariaLabel: 'skin ratio' })({
              change: changeSkinTether()
            })
          ),
          $column(spacing.small)(
            $row(spacing.small, style({ width: '100%' }))(
              $labelDisplay(style({ width: '128px' }))(
                $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
                  $text('Tokens'),
                  $infoTooltip('The tokens this master may trade you into. A cycle can only match you when the master operates in one of them; Any token covers every token listed today.', palette.foreground)
                )
              ),
              $DropMultiSelect<Hex>({
                $container: $defaultDropdownContainer(style({ display: 'flex', flex: 1, minWidth: '0' })),
                $anchorContainer: $defaultDropMultiSelectAnchor(
                  style({ minHeight: '48px', padding: '0 22px 0 10px', backgroundColor: palette.background, borderBottom: `2px solid ${palette.message}` })
                ),
                value: selected,
                optionList: [...assets.keys()],
                $noneSelected: $node(style({ color: colorShade(palette.foreground, 80) }))($text('Any token')),
                $$selectedOption: map(id => $asset(id, 20)),
                $$option: map(id => $asset(id, 24))
              })({ select: selectTokensTether() })
            ),
            $node(style({ minHeight: '1rem', width: '100%' }))()
          ),
          $Dropdown<bigint>({
            $container: $defaultDropdownContainer(style({ display: 'flex', width: '100%' })),
            $anchor: $FieldLabeled({
              label: $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))($text('Cooldown'), $infoTooltip($cooldownExplainer, palette.foreground)),
              labelWidth: 128,
              value: cooldownText,
              placeholder: 'Type a duration, e.g. 6h',
              validation: cooldownError
            })({ change: typeCooldownTether() }),
            optionList: COOLDOWN_OPTIONS,
            $$option: map(period => $node($text(readableDuration(period))))
          })({ select: selectCooldownTether() }),
          $Dropdown<bigint>({
            $container: $defaultDropdownContainer(style({ display: 'flex', width: '100%' })),
            $anchor: $FieldLabeled({
              label: $row(spacing.tiny, style({ alignItems: 'center', whiteSpace: 'nowrap' }))(
                $text('Backing until'),
                $infoTooltip('The mandate stops matching after this date; sign it again to extend it.', palette.foreground)
              ),
              labelWidth: 128,
              value: expiryText,
              placeholder: 'Type a duration, e.g. 30d',
              hint: map(
                period =>
                  period === null
                    ? ''
                    : `Until ${readableDate(getUnixTimestamp() + Number(period))}${active ? `, currently until ${readableDate(Number(active.expiry))}` : ''}`,
                expiryIn
              ),
              validation: expiryError
            })({ change: typeExpiryTether() }),
            optionList: EXPIRY_OPTIONS,
            $$option: map(period => $node($text(readableDuration(period))))
          })({ select: selectExpiryTether() }),
          $node(style({ fontSize: text.xs, color: palette.foreground }))(
            $text(
              `One broadcast on ${chainName(HUB_CHAIN_ID)} carries the whole mandate: it is chainless and binds wherever this master operates. Re-broadcasting replaces it; leaving is the same broadcast with an expiry of zero.`
            )
          ),
          $row(spacing.small, style({ justifyContent: 'flex-end', alignItems: 'center' }))(
            ...(active
              ? [$ButtonSecondary({ $container: $defaultMiniButtonSecondary, $content: $text('Leave') })({ click: clickLeaveTether() })]
              : []),
            $ButtonPrimary({
              $container: $defaultMiniButtonPrimary,
              disabled: map(p => p.cooldown === null || p.expiryIn === null, combine({ cooldown, expiryIn })),
              $content: $text(map(d => (d ? 'Update in cart' : active ? 'Change' : 'Back this trader'), start(null, draft)))
            })({ click: clickAddTether() })
          )
        ),
        {
          changeMandateDraft: merge(
            op(
              sampleMap(p => p, terms, clickAdd),
              filter((p): p is { allocation: number; skin: number; cooldown: bigint; expiryIn: bigint; selected: Hex[] } => p.cooldown !== null && p.expiryIn !== null),
              map(toDraft)
            ),
            map(() => toDraft(null), clickLeave)
          )
        }
      ]
    }
  )
