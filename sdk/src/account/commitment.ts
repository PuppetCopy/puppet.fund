import { accountCallEvent } from '@puppet/contracts/events'
import type { AbiParameter } from 'viem'

export const CALL_LIST_PARAM: AbiParameter = (() => {
  const param = accountCallEvent.inputs.find(i => i.name === 'callList')
  if (!param) throw new Error('accountCallEvent lost its callList input; regenerate the contracts manifest')
  return param
})()
