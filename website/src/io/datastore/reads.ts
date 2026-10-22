import { createClient, type IDigestClient } from '@puppet/sdk/datastore'
import * as schema from '@puppet/sdk/schema'
import { disposeBoth, fromPromise, type IStream, type ITime, just, map, merge, op, propagateRunTask, switchMap, tap } from 'aelea/stream'
import { multicast } from 'aelea/stream-extended'
import { ENDPOINTS } from '../../app/endpoints.js'

export const client = createClient({ storageUrl: ENDPOINTS.chronicle, schema, timeoutMs: 10_000 })

export const notLocal: Promise<never> = new Promise(() => {})

export const localReader: IDigestClient = {
  select: (table, opts) => client.cached(table, opts).then(rows => (rows === null ? notLocal : rows)),
  find: (table, where) => client.cached(table, { where, limit: 1 }).then(rows => (rows === null ? notLocal : rows[0])),
  cached: client.cached
}

const LOCAL_WINDOW_MS = 300

export const handoff = (known: Promise<unknown>, latest: Promise<unknown>): Promise<void> => {
  const after = (ms: number) => (): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
  return Promise.race([known.then(after(LOCAL_WINDOW_MS), after(LOCAL_WINDOW_MS)), latest.then(after(0), after(0))])
}

export const localFirst = <T>(local: () => Promise<T>, fresh: () => Promise<T>): IStream<Promise<T>> =>
  op(
    just(null),
    switchMap(() => {
      const known = local()
      const latest = fresh()
      return merge(
        just(known),
        op(
          fromPromise(handoff(known, latest)),
          map(() => latest)
        )
      )
    })
  )

export const answerState = <T>(source: IStream<Promise<T>>): IStream<Promise<T>> => {
  let kept: { order: number; promise: Promise<T>; rejected: boolean }[] = []
  let arrived = 0
  const shared = multicast(
    tap(promise => {
      const entry = { order: ++arrived, promise, rejected: false }
      kept = [...kept.filter(each => !each.rejected), entry]
      promise.then(
        () => {
          kept = kept.filter(each => each.order >= entry.order)
        },
        () => {
          entry.rejected = true
          if (entry.order !== arrived) kept = kept.filter(each => each !== entry)
        }
      )
    }, source)
  )
  return {
    run(sink, scheduler) {
      const upTo = arrived
      let held: { time: ITime; promise: Promise<T> }[] | null = []
      let ended: ITime | null = null
      const live = shared.run(
        {
          event: (time, promise) => (held === null ? sink.event(time, promise) : held.push({ time, promise })),
          error: (time, error) => sink.error(time, error),
          end: time => (held === null ? sink.end(time) : (ended = time))
        },
        scheduler
      )
      const replay = scheduler.asap(
        propagateRunTask(sink, (time, target) => {
          for (const entry of kept) if (entry.order <= upTo) target.event(time, entry.promise)
          const queued = held ?? []
          held = null
          for (const each of queued) target.event(each.time, each.promise)
          if (ended !== null) target.end(ended)
        })
      )
      return disposeBoth(replay, live)
    }
  }
}

export const localFirstQuery = <T>(read: (reader: IDigestClient) => Promise<T>): IStream<Promise<T>> =>
  localFirst(
    () => read(localReader),
    () => read(client)
  )
