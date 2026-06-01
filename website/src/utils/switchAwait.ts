import type { IStream } from 'aelea/stream'
import { stream } from 'aelea/stream-extended'

export type SwitchAwaitReason = 'superseded' | 'timeout' | 'disposed' | 'value-ended' | 'sampler-ended'

export class SwitchAwaitError extends Error {
  readonly reason: SwitchAwaitReason
  constructor(reason: SwitchAwaitReason, message: string) {
    super(message)
    this.name = 'SwitchAwaitError'
    this.reason = reason
  }
}

export function switchAwait<V, S, R>(
  predicate: (value: V, sample: S) => R | null,
  valueSource: IStream<V>,
  sampler: IStream<S>,
  timeoutMs: number
): IStream<Promise<R>> {
  return stream<Promise<R>>((sink, scheduler) => {
    type Pending = {
      sample: S
      resolve: (r: R) => void
      reject: (e: unknown) => void
      timer: ReturnType<typeof setTimeout>
    }

    let latestValue: { value: V } | null = null
    let pending: Pending | null = null

    const cancelPending = (errFn: () => unknown) => {
      if (!pending) return
      clearTimeout(pending.timer)
      pending.reject(errFn())
      pending = null
    }

    const valueSub = valueSource.run(
      {
        event(_t, value) {
          latestValue = { value }
          if (!pending) return
          let result: R | null
          try {
            result = predicate(value, pending.sample)
          } catch (err) {
            cancelPending(() => err)
            return
          }
          if (result === null) return
          clearTimeout(pending.timer)
          pending.resolve(result)
          pending = null
        },
        error(t, err) {
          sink.error(t, err)
        },
        end(t) {
          cancelPending(() => new SwitchAwaitError('value-ended', 'value source ended before sample satisfied'))
          sink.end(t)
        }
      },
      scheduler
    )

    const samplerSub = sampler.run(
      {
        event(t, sample) {
          cancelPending(() => new SwitchAwaitError('superseded', 'newer sample superseded pending await'))

          if (latestValue) {
            let result: R | null
            try {
              result = predicate(latestValue.value, sample)
            } catch (err) {
              sink.error(t, err)
              return
            }
            if (result !== null) {
              sink.event(t, Promise.resolve(result))
              return
            }
          }

          let resolve!: (r: R) => void
          let reject!: (e: unknown) => void
          const promise = new Promise<R>((res, rej) => {
            resolve = res
            reject = rej
          })

          const localPending: Pending = {
            sample,
            resolve,
            reject,
            timer: setTimeout(() => {
              if (pending !== localPending) return
              pending = null
              reject(new SwitchAwaitError('timeout', `await timed out after ${timeoutMs}ms`))
            }, timeoutMs)
          }
          pending = localPending
          sink.event(t, promise)
        },
        error(t, err) {
          sink.error(t, err)
        },
        end(t) {
          cancelPending(() => new SwitchAwaitError('sampler-ended', 'sampler ended before pending resolved'))
          sink.end(t)
        }
      },
      scheduler
    )

    return {
      [Symbol.dispose]() {
        cancelPending(() => new SwitchAwaitError('disposed', 'switchAwait disposed'))
        valueSub[Symbol.dispose]()
        samplerSub[Symbol.dispose]()
      }
    }
  })
}
