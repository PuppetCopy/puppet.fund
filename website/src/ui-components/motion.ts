import { combineMap, continueWith, fromIterable, just } from 'aelea/stream'
import { type I$Slottable, motion, styleBehavior } from 'aelea/ui'

const FADE_MOTION = { stiffness: 800, damping: 80 }

function fade($content: I$Slottable, axis: 'x' | 'y', from: number) {
  const opacity = motion(FADE_MOTION, fromIterable([0, 100]))
  const translate = motion(FADE_MOTION, fromIterable([from, 0]))

  const animation = combineMap(
    (o, t) => ({
      opacity: `${o}%`,
      transform: axis === 'x' ? `translate(${t}px, 0)` : `translate(0, ${t}px)`
    }),
    opacity,
    translate
  )

  return styleBehavior(
    continueWith(() => just({ opacity: '', transform: '' }), animation),
    $content
  )
}

export function fadeIn($content: I$Slottable) {
  return fade($content, 'y', 15)
}

export function fadeInX($content: I$Slottable, from: number) {
  return fade($content, 'x', from)
}
