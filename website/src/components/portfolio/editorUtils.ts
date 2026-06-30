import { constant, type IStream, merge } from 'aelea/stream'
import { state } from 'aelea/stream-extended'

export const createFocusState = (focusEvt: IStream<unknown>, blurEvt: IStream<unknown>): IStream<boolean> =>
  state(false, merge(constant(true, focusEvt), constant(false, blurEvt)))
