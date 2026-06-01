import type { IScheduler, ISink, IStream } from 'aelea/stream'
import { propagateRunEventTask } from 'aelea/stream'
import { stream } from 'aelea/stream-extended'

export interface ISubject<T> {
  stream: IStream<T>
  push(value: T): void
}
type Subscriber<T> = { sink: ISink<T>; scheduler: IScheduler }

export function subject<T>(): ISubject<T> {
  const subscribers = new Set<Subscriber<T>>()
  const emit = (time: number, sink: ISink<T>, value: T): void => {
    sink.event(time, value)
  }
  return {
    stream: stream((sink, scheduler) => {
      const entry: Subscriber<T> = { sink, scheduler }
      subscribers.add(entry)
      return { [Symbol.dispose]: () => subscribers.delete(entry) }
    }),
    push: value => {
      for (const { sink, scheduler } of [...subscribers]) {
        scheduler.asap(propagateRunEventTask(sink, emit, value))
      }
    }
  }
}
