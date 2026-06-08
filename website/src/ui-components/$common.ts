import { HUB_CHAIN } from '@puppet/sdk/const'
import { getExplorerUrl, readableAddress, readableHash } from '@puppet/sdk/core'
import { type IOps, type IStream, isStream, map, nowWith, o } from 'aelea/stream'
import {
  $element,
  $node,
  $svg,
  $text,
  attr,
  effectProp,
  type I$Node,
  type I$Text,
  type IMutator,
  type INode,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import type { Chain } from 'viem/chains'

export const $elipsisTextWrapper = $node(
  style({ overflow: 'hidden', minHeight: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' })
)

export const $anchor = $element('a')(
  spacing.tiny,
  attr({ target: '_blank' }),
  stylePseudo(':hover', {
    color: `${colorShade(palette.primary, 50)}!important`,
    fill: colorShade(palette.primary, 50)
  }),
  style({
    cursor: 'pointer',
    color: palette.message,
    alignItems: 'center',
    display: 'inline-flex'
  })
)

export const $label = $element('label')(
  spacing.small,
  style({ color: palette.foreground, cursor: 'pointer', display: 'flex' })
)

export const $fromText = (text: string | I$Text): I$Text => (isStream(text) ? text : $text(text))

interface Icon {
  $content: I$Node
  size?: string
  width?: string
  height?: string
  viewBox?: string
  fill?: string | IStream<string>
  // When provided, the icon is exposed to assistive tech as an image with this accessible name.
  // When omitted, the icon is treated as decorative and hidden from AT (aria-hidden + focusable=false).
  label?: string
  svgOps?: IOps<INode<SVGSVGElement>, INode<SVGSVGElement>>
}

export const $icon = ({
  $content,
  size,
  width = size ?? '24px',
  height = size,
  viewBox = '0 0 32 32',
  fill = 'inherit',
  label,
  svgOps = o()
}: Icon) =>
  $svg('svg')(
    attr({ viewBox }),
    label !== undefined
      ? attr({ role: 'img', 'aria-label': label })
      : attr({ 'aria-hidden': 'true', focusable: 'false' }),
    style({ width, ...(height ? { height } : { aspectRatio: '1 / 1' }) }),
    isStream(fill) ? styleBehavior(map(f => ({ fill: f }), fill)) : style({ fill }),
    svgOps
  )($content)

// Keyboard activation for non-native interactive elements (div/role=button|menuitem|option).
// Treats Enter/Space (and any `extraKeys`) like a click so AT/keyboard users can trigger the
// element's existing click tether. Returns a pure mutator — no behavior wiring required.
export const keyActivate = (extraKeys: readonly string[] = []): IMutator =>
  effectProp(
    'onkeydown',
    nowWith(() => (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar' || extraKeys.includes(ev.key)) {
        ev.preventDefault()
        const target = ev.currentTarget as HTMLElement | null
        target?.click()
      }
    })
  )

// Keyboard handling for a listbox trigger (anchor) whose open/closed state is reflected on the
// element via aria-expanded. Enter/Space toggle the list (via the native click the open tether
// already listens to). ArrowDown/ArrowUp open it when closed, then move focus into the first /
// last [role=option] of the list found through `getList()` (so arrow keys never re-toggle a
// list that is already open).
export const dropAnchorKeyNav = (getList: () => HTMLElement | null): IMutator =>
  effectProp(
    'onkeydown',
    nowWith(() => (ev: KeyboardEvent) => {
      const anchor = ev.currentTarget as HTMLElement | null
      if (!anchor) return
      const isOpen = anchor.getAttribute('aria-expanded') === 'true'
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault()
        anchor.click()
        return
      }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
      ev.preventDefault()
      if (!isOpen) anchor.click()
      // The list mounts asynchronously after the open click, so defer the focus move.
      const focusOption = () => {
        const list = getList()
        if (!list) return
        const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
        if (options.length === 0) return
        ;(ev.key === 'ArrowUp' ? options[options.length - 1] : options[0])?.focus()
      }
      if (isOpen) focusOption()
      else requestAnimationFrame(focusOption)
    })
  )

// Roving-focus + Escape keyboard navigation for a role=listbox container. ArrowUp/ArrowDown
// (and Home/End) move focus between the [role=option] descendants; Escape calls `close` and
// returns focus to `getAnchor()`. `close` is optional for lists with no explicit close hook.
export const listboxKeyNav = (close?: () => void, getAnchor?: () => HTMLElement | null): IMutator =>
  effectProp(
    'onkeydown',
    nowWith(() => (ev: KeyboardEvent) => {
      const container = ev.currentTarget as HTMLElement | null
      if (!container) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        close?.()
        getAnchor?.()?.focus()
        return
      }
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return
      const options = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
      if (options.length === 0) return
      ev.preventDefault()
      const active = document.activeElement as HTMLElement | null
      const current = active ? options.indexOf(active) : -1
      let next: number
      if (ev.key === 'Home') next = 0
      else if (ev.key === 'End') next = options.length - 1
      else if (ev.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % options.length
      else next = current <= 0 ? options.length - 1 : current - 1
      options[next]?.focus()
    })
  )

export function $txHashRef(txHash: string, chain: Chain = HUB_CHAIN) {
  const href = `${getExplorerUrl(chain)}/tx/${txHash}`
  return $anchor(attr({ href }))($text(readableHash(txHash)))
}

export function $addressRef(addr: string, chain: Chain = HUB_CHAIN) {
  const href = `${getExplorerUrl(chain)}/address/${addr}`
  return $anchor(attr({ href }))($text(readableAddress(addr)))
}
