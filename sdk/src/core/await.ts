export interface IAwaitOptions {
  timeoutMs: number
  pollMs?: number
  maxPollMs?: number
  timeoutMessage?: string
  maxConsecutiveErrors?: number
}

// Poll `probe` on an interval until it returns a defined value, then resolve with that value. `probe`
// returns undefined to signal "not ready, keep waiting"; it is checked immediately, before the first
// wait. pollMs is a fixed interval unless maxPollMs is given, which opts into exponential backoff up to
// that ceiling. Throws timeoutMessage once the deadline passes without a defined value.
// A probe THROW is treated as transient (one RPC blip mid-bridge-wait must not convert funds safely in
// flight into a user-facing failure): the wait continues until maxConsecutiveErrors consecutive throws,
// then the last error propagates. A successful probe resets the error budget.
export async function awaitWhile<T>(
  probe: () => Promise<T | undefined>,
  { timeoutMs, pollMs = 250, maxPollMs = pollMs, timeoutMessage, maxConsecutiveErrors = 10 }: IAwaitOptions
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let delay = pollMs
  let consecutiveErrors = 0
  for (;;) {
    try {
      const value = await probe()
      consecutiveErrors = 0
      if (value !== undefined) return value
    } catch (err) {
      consecutiveErrors += 1
      if (consecutiveErrors >= maxConsecutiveErrors) throw err
    }
    if (Date.now() >= deadline) {
      throw new Error(timeoutMessage ?? `awaitWhile: condition not met within ${timeoutMs}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, maxPollMs)
  }
}
