import type { IConnector } from './connector.js'

export async function runOperator(
  connector: IConnector,
  body: (signal: AbortSignal) => unknown | Promise<unknown>
): Promise<void> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  try {
    await body(controller.signal)
  } finally {
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
    connector.close()
  }
}
