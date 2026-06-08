/**
 * Registry of avatar kinds. Each kind is its own self-contained abstraction
 * (own file in this directory, own canvas/palette/layers) built on the generic
 * engine in ../avatarEngine.js. Kinds never share option pools.
 *
 * Re-export concrete kinds here as they are added, and list them in KINDS so
 * callers can enumerate/look-up the registered kinds.
 */
import type { IKind } from '../avatarEngine.js'
import { monkey } from './monkey.js'

export { monkey } from './monkey.js'

/** All registered kinds, keyed by kind.name. */
export const KINDS: Record<string, IKind> = {
  [monkey.name]: monkey
}
