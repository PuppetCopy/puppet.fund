import type { IStream } from 'aelea/stream'
import { stream } from 'aelea/stream-extended'
import type { PublicClient } from 'viem'
import { getGasPrice, watchBlockNumber } from 'viem/actions'

export function createGasPriceSource(client: PublicClient, interval: number): IStream<bigint> {
  return stream<bigint>((sink, scheduler) => {
    const unwatch = watchBlockNumber(client, {
      emitOnBegin: true,
      pollingInterval: interval,
      onBlockNumber: async () => {
        try {
          sink.event(scheduler.time(), await getGasPrice(client))
        } catch (err) {
          sink.error(scheduler.time(), err)
        }
      },
      onError: err => sink.error(scheduler.time(), err)
    } as Parameters<typeof watchBlockNumber>[1])
    return {
      [Symbol.dispose]() {
        unwatch()
      }
    }
  })
}
