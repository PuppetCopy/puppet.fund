import { createDefaultScheduler, type IScheduler, type IStream } from 'aelea/stream'

export function awaitStreamMatch<T>(
  source: IStream<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  scheduler: IScheduler = createDefaultScheduler()
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let disposable: Disposable | null = null
    const timer = setTimeout(() => {
      disposable?.[Symbol.dispose]()
      reject(new Error(`awaitStreamMatch: no match within ${timeoutMs}ms`))
    }, timeoutMs)
    disposable = source.run(
      {
        event(_t, value) {
          if (!predicate(value)) return
          clearTimeout(timer)
          disposable?.[Symbol.dispose]()
          resolve(value)
        },
        error(_t, err) {
          clearTimeout(timer)
          disposable?.[Symbol.dispose]()
          reject(err)
        },
        end() {
          clearTimeout(timer)
          disposable?.[Symbol.dispose]()
          reject(new Error('awaitStreamMatch: source ended without match'))
        }
      },
      scheduler
    )
  })
}
