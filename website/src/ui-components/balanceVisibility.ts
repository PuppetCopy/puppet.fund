import { type IStream, map, nowWith, switchLatest } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { $node, $text, effectProp, type I$Node, style } from 'aelea/ui'
import { palette, text } from 'aelea/ui-components-theme'
import { subject } from '../utils/subject.js'

let currentHidden = false
const toggleSubject = subject<boolean>()

export const hideBalances: IStream<boolean> = state(false, toggleSubject.stream)

export const setHideBalances = (hidden: boolean): void => {
  currentHidden = hidden
  toggleSubject.push(hidden)
}

export const $balanceVisibilityToggle = (): I$Node =>
  $node(
    style({
      cursor: 'pointer',
      color: palette.foreground,
      fontSize: text.sm,
      whiteSpace: 'nowrap',
      userSelect: 'none'
    }),
    effectProp(
      'onclick',
      nowWith(() => () => setHideBalances(!currentHidden))
    )
  )(switchLatest(map(hidden => $text(hidden ? 'Show balances' : 'Hide balances'), hideBalances)))
