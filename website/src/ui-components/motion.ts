import { combineMap, continueWith, fromIterable, just } from 'aelea/stream'
import { type I$Slottable, motion, styleInline } from 'aelea/ui'

const FADE_MOTION = { stiffness: 800, damping: 80 }

export function fadeIn($content: I$Slottable) {
  const opacity = motion(FADE_MOTION, fromIterable([0, 100]))
  const translate = motion(FADE_MOTION, fromIterable([15, 0]))

  const animation = combineMap((o, t) => ({ opacity: `${o}%`, transform: `translate(0, ${t}px)` }), opacity, translate)

  // Clear inline styles after settle so subsequent CSS rules can take over;
  // without this, transform/opacity remain pinned to the final animated value.
  return styleInline(
    continueWith(() => just({ opacity: '', transform: '' }), animation),
    $content
  )
}
