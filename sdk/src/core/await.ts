export interface IAwaitOptions {
  timeoutMs: number
  pollMs?: number
  maxPollMs?: number
  timeoutMessage?: string
}

// Poll `probe` on an interval until it returns a defined value, then resolve with that value. `probe`
// returns undefined to signal "not ready, keep waiting"; it is checked immediately, before the first
// wait. pollMs is a fixed interval unless maxPollMs is given, which opts into exponential backoff up to
// that ceiling. Throws timeoutMessage once the deadline passes without a defined value.
export async function awaitWhile<T>(
  probe: () => Promise<T | undefined>,
  { timeoutMs, pollMs = 250, maxPollMs = pollMs, timeoutMessage }: IAwaitOptions
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let delay = pollMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() >= deadline) {
      throw new Error(timeoutMessage ?? `awaitWhile: condition not met within ${timeoutMs}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, maxPollMs)
  }
}
