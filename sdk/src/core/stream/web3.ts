import { disposeWith, type IStream, propagateErrorEndTask } from 'aelea/stream'
import { stream } from 'aelea/stream-extended'
import type {
  Abi,
  ContractEventName,
  PublicClient,
  WatchContractEventOnLogsParameter,
  WatchContractEventParameters
} from 'viem'

export const watchContractEvent = <const abi extends Abi, eventName extends ContractEventName<abi>>(
  client: PublicClient,
  params: Omit<WatchContractEventParameters<abi, eventName>, 'onLogs' | 'onError'>
): IStream<WatchContractEventOnLogsParameter<abi, eventName, true>> => {
  return stream((sink, scheduler) => {
    try {
      const removeListenerFn = client.watchContractEvent({
        ...params,
        onLogs(logList) {
          const time = scheduler.time()
          sink.event(time, logList as any)
        },
        onError(err) {
          const time = scheduler.time()
          sink.error(time, err)
        }
      } as WatchContractEventParameters)

      return disposeWith(removeListenerFn)
    } catch (err) {
      return scheduler.asap(propagateErrorEndTask(sink, err))
    }
  })
}
