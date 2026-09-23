class AwaitTimeoutError extends Error {}

interface IAwaitOptions {
  timeoutMs: number
  pollMs?: number
  maxPollMs?: number
  timeoutMessage?: string
  maxConsecutiveErrors?: number
}

export async function awaitWhile<T>(
  { timeoutMs, pollMs = 250, maxPollMs = pollMs, timeoutMessage, maxConsecutiveErrors = 10 }: IAwaitOptions,
  probe: () => Promise<T | undefined>
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let delay = pollMs
  let consecutiveErrors = 0
  let everSucceeded = false
  let lastError: unknown
  for (;;) {
    try {
      const value = await probe()
      everSucceeded = true
      consecutiveErrors = 0
      if (value !== undefined) return value
    } catch (err) {
      lastError = err
      consecutiveErrors += 1
      if (!everSucceeded && consecutiveErrors >= maxConsecutiveErrors) throw err
    }
    if (Date.now() >= deadline) {
      const base = timeoutMessage ?? `awaitWhile: condition not met within ${timeoutMs}ms`
      throw new AwaitTimeoutError(
        lastError === undefined
          ? base
          : `${base}; last probe error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      )
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, maxPollMs)
  }
}
