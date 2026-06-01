import {
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
  tap
} from 'aelea/stream'
import type { IBehavior } from 'aelea/stream-extended'
import { $text, component, type I$Node, type INode, type INodeCompose, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $caretDown, $Dropdown, $defaultDropdownContainer, $icon, $infoLabel, $xCross } from '@/ui-components'

// Array utility functions (previously from @most/prelude)
const append = <T>(item: T, array: T[]): T[] => [...array, item]
const remove = <T>(index: number, array: T[]): T[] => array.filter((_, i) => i !== index)

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
    paddingLeft: '4px',
    cursor: 'default',
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
export const $DropMultiSelect = <T>({
  value, //
  optionList,

  getId,
  $noneSelected = $defaultNoneSelected($text('None selected')),
  $$selectedOption = map(item => $defaultDropMultiSelectOption($text(String(item)))),
  $$option = map(item => $defaultDropMultiSelectOption($text(String(item)))),
  $container = $defaultDropdownContainer,
  $dropListContainer,
  $optionContainer = $defaultOptionContainer,
  validation = constant(null)
}: I$DropMultiSelect<T>) =>
  component(([select, selectTether]: IBehavior<T>, [pluck, pluckTether]: IBehavior<INode, T>) => {
    return [
      $Dropdown({
        $anchor: $row(
          style({ display: 'flex', flexDirection: 'row', position: 'relative', gap: '8px', alignItems: 'center' })
        )(
          switchMap(valueList => {
            if (!valueList.length) {
              return $noneSelected
            }

            return $row(
              spacing.tiny,
              style({ alignItems: 'center', paddingLeft: '6px' })
            )(
              ...valueList.map(token => {
                return $optionContainer(
                  switchLatest($$selectedOption(just(token))),
                  $icon({
                    $content: $xCross,
                    width: '28px',
                    svgOps: o(
                      style({ padding: '4px', cursor: 'pointer' }),
                      pluckTether(
                        nodeEvent('click'),
                        tap(x => x.preventDefault()),
                        constant(token)
                      )
                    ),
                    viewBox: '0 0 32 32'
                  })
                )
              })
            )
          }, value),

          $row(
            style({
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: `1px solid ${colorShade(palette.foreground, 15)}`
            })
          )(
            $icon({
              $content: $caretDown,
              width: '12px',
              svgOps: style({ minWidth: '12px' }),
              viewBox: '0 0 32 32'
            })
          )
        ),
        optionList,
        $$option,
        $container
      })({
        select: selectTether()
      }),
      {
        select: merge(
          sampleMap(
            (seed, next) => {
              const matchedIndex = getId ? seed.findIndex(item => getId(item) === getId(next)) : seed.indexOf(next)

              if (matchedIndex === -1) {
                return append(next, seed)
              }

              return remove(matchedIndex, seed)
            },
            value,
            select
          ),
          sampleMap(
            (seed, next) => {
              const matchedIndex = getId ? seed.findIndex(item => getId(item) === getId(next)) : seed.indexOf(next)

              if (matchedIndex !== -1) {
                return remove(matchedIndex, seed)
              }

              return seed
            },
            value,
            pluck
          )
        )
        // alert
      }
    ]
  })
