import {
  continueWith,
  fromPromise,
  type IOps,
  type IStream,
  switchMap,
  wait
} from 'aelea/stream'

export interface IRunPeriodically<T> {
  actionOp: IOps<number, Promise<T>>
  interval?: number
  startImmediate?: boolean
}

export const periodicRun = <T>({
  actionOp,
  interval = 1000,
  startImmediate = true
}: IRunPeriodically<T>): IStream<T> => {
  const run = actionOp(wait(startImmediate ? 0 : interval))
  const awaitExecution = switchMap(fromPromise, run)
  const runArgs = { actionOp, interval, startImmediate: false }
  return continueWith(() => periodicRun<T>(runArgs), awaitExecution)
}
