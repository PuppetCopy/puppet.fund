import type { IScheduler, ISink, IStream } from 'aelea/stream'
import { curry2, filter, fromPromise, map, periodic, start } from 'aelea/stream'
import { multicast, stream } from 'aelea/stream-extended'
import { countdownFn } from '../date.js'
import { getUnixTimestamp } from '../utils.js'

export const mapPromise = <T, R>(mapFn: (x: T) => R, prov: Promise<T>) => fromPromise(prov.then(mapFn))

export const everySec = map(getUnixTimestamp, start(null, periodic(1000)))

export const countdown = (targetDate: number) => {
  return map(now => countdownFn(targetDate, now), everySec)
}

export const ignoreAll = filter(() => false)

export interface IEndWithCurry {
  <T>(f: (value: T) => boolean, s: IStream<T>): IStream<T>
  <T>(f: (value: T) => boolean): (s: IStream<T>) => IStream<T>
}

export const endWith: IEndWithCurry = curry2(
  <T>(f: (value: T) => boolean, source: IStream<T>): IStream<T> =>
    stream((sink, scheduler) => {
      let ended = false
      const sourceDisposable = source.run(
        {
          event(time, data) {
            sink.event(time, data)

            try {
              if (f(data)) {
                sink.end(time)
                sourceDisposable[Symbol.dispose]() // Dispose source stream
                ended = true
              }
            } catch (error) {
              sink.error(time, error)
            }
          },
          error(time, err) {
            if (ended) return

            sink.error(time, err)
          },
          end(time) {
            if (ended) return

            sink.end(time)
          }
        },
        scheduler
      )
      return sourceDisposable
    })
)

export type Adapter<A> = [(event: A) => void, IStream<A>]

interface ISubscriber<T> {
  sink: ISink<T>
  scheduler: IScheduler
}

export const createAdapter = <T>(): Adapter<T> => {
  const subscriberList: ISubscriber<T>[] = []
  const fanOut = new FanoutPortStream(subscriberList)
  return [a => broadcast(subscriberList, a), multicast(fanOut)]
}

export class FanoutPortStream<T> implements IStream<T> {
  constructor(readonly subscriberList: ISubscriber<T>[]) {}

  run(sink: ISink<T>, scheduler: IScheduler): Disposable {
    const subscriberList = this.subscriberList
    const subscriber = { sink, scheduler }
    subscriberList.push(subscriber)

    return {
      [Symbol.dispose]() {
        const i = subscriberList.indexOf(subscriber)
        if (i >= 0) {
          subscriberList.splice(i, 1)
        }
      }
    }
  }
}

const broadcast = <T>(sinks: ISubscriber<T>[], a: T): void => {
  const subscriberList = sinks.slice()

  for (const subscriber of subscriberList) {
    tryEvent(a, subscriber)
  }
}

function tryEvent<T>(a: T, subscriber: ISubscriber<T>) {
  const time = subscriber.scheduler.time()
  try {
    subscriber.sink.event(time, a)
  } catch (e) {
    subscriber.sink.error(time, e as Error)
  }
}
