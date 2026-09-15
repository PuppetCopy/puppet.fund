import {
  combine,
  constant,
  type IOps,
  type IStream,
  just,
  map,
  merge,
  o,
  sampleMap,
  switchLatest,
  switchMap,
  tap,
  toStream
} from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import {
  $text,
  attr,
  attrBehavior,
  component,
  effectRun,
  type I$Node,
  type INode,
  type INodeCompose,
  nodeEvent,
  style,
  stylePseudo
} from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import {
  $caretDown,
  $Dropdown,
  $defaultDropdownContainer,
  $icon,
  $infoLabel,
  dropAnchorKeyNav,
  keyActivate,
  listboxKeyNav
} from '@/ui-components'
import {
  $defaultDropListContainer as $aeleaDropListContainer,
  $defaultOptionContainer as $aeleaOptionContainer
} from './$Dropdown.js'

export const $defaultDropMultiSelectOption = $row(
  spacing.small,
  style({
    overflow: 'hidden',
    border: `1px solid ${palette.message}`,
    alignItems: 'center',
    padding: '4px 8px',
    width: '100%'
  }),
  stylePseudo(':hover', { backgroundColor: palette.horizon })
)
export const $defaultOptionContainer = $row(
  style({
    backgroundColor: palette.primary,
    color: 'white',
    fill: 'white',
    padding: '4px 10px',
    cursor: 'pointer',
    alignItems: 'center',
    borderRadius: '22px'
  })
)

export interface I$DropMultiSelect<T> {
  value: IStream<T[]>
  optionList: IStream<T[]> | T[]

  getId?: (item: T) => string | number
  $noneSelected?: I$Node
  $$selectedOption?: IOps<T, I$Node>
  $$option?: IOps<T, I$Node>
  $container?: INodeCompose
  $anchorContainer?: INodeCompose
  $dropListContainer?: INodeCompose
  $optionContainer?: INodeCompose

  validation?: IOps<T, string | null>
}

export const $defaultNoneSelected = $infoLabel(
  style({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '10px 0 10px 12px'
  })
)
export const $defaultDropMultiSelectAnchor = $row(
  style({ display: 'flex', flexDirection: 'row', position: 'relative', gap: '8px', alignItems: 'center', flex: 1, minWidth: '0', paddingRight: '20px' })
)

export const $DropMultiSelect = <T>({
  value,
  optionList,

  getId,
  $noneSelected = $defaultNoneSelected($text('None selected')),
  $$selectedOption = map(item => $defaultDropMultiSelectOption($text(String(item)))),
  $$option = map(item => $defaultDropMultiSelectOption($text(String(item)))),
  $container = $defaultDropdownContainer,
  $anchorContainer = $defaultDropMultiSelectAnchor,
  $dropListContainer,
  $optionContainer = $defaultOptionContainer,
  validation = constant(null)
}: I$DropMultiSelect<T>) =>
  component(
    (
      [select, selectTether]: IBehavior<T>,
      [pluck, pluckTether]: IBehavior<INode, T>,
      [isOpen, isOpenTether]: IBehavior<boolean>
    ) => {
      let anchorEl: HTMLElement | null = null
      let listEl: HTMLElement | null = null
      const closeAndFocus = () => {
        anchorEl?.click()
        anchorEl?.focus()
      }
      const findIdx = (seed: T[], next: T) =>
        getId ? seed.findIndex(item => getId(item) === getId(next)) : seed.indexOf(next)
      return [
        $Dropdown({
          $anchor: $anchorContainer(
            attr({ role: 'button', tabindex: '0', 'aria-haspopup': 'listbox' }),
            attrBehavior(map((open: boolean) => ({ 'aria-expanded': open ? 'true' : 'false' }), isOpen)),
            effectRun((el: unknown) => {
              anchorEl = el as HTMLElement
            }),
            dropAnchorKeyNav(() => listEl)
          )(
            switchMap(valueList => {
              if (!valueList.length) {
                return $noneSelected
              }

              return $row(
                spacing.tiny,
                style({ alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: '0', padding: '8px 0' })
              )(
                ...valueList.map(token =>
                  $optionContainer(
                    attr({ role: 'button', tabindex: '0', 'aria-label': `Remove ${String(token)}` }),
                    keyActivate(),
                    pluckTether(
                      nodeEvent('click'),
                      tap(ev => {
                        ev.preventDefault()
                        ev.stopPropagation()
                      }),
                      constant(token)
                    )
                  )(switchLatest($$selectedOption(just(token))))
                )
              )
            }, value),

            $icon({
              $content: $caretDown,
              width: '10px',
              viewBox: '0 0 32 32',
              fill: palette.foreground,
              svgOps: style({ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' })
            })
          ),
          optionList: map(p => p.options.filter(option => findIdx(p.value, option) === -1), combine({ options: toStream(optionList), value })),
          $$option,
          $container,
          $dropListContainer: ($dropListContainer ?? $aeleaDropListContainer)(
            attr({ role: 'listbox', tabindex: '-1' }),
            effectRun((el: unknown) => {
              listEl = el as HTMLElement
            }),
            listboxKeyNav(closeAndFocus, () => anchorEl)
          ),
          $optionContainer: $aeleaOptionContainer(attr({ role: 'option', tabindex: '0' }), keyActivate())
        })({
          select: selectTether(),
          isOpen: isOpenTether()
        }),
        {
          select: merge(
            sampleMap(
              (seed, next) => {
                const i = findIdx(seed, next)
                return i === -1 ? [...seed, next] : seed.filter((_, x) => x !== i)
              },
              value,
              select
            ),
            sampleMap(
              (seed, next) => {
                const i = findIdx(seed, next)
                return i === -1 ? seed : seed.filter((_, x) => x !== i)
              },
              value,
              pluck
            )
          )
        }
      ]
    }
  )
