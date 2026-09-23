import type { IIAccount__Call } from '@puppet/contracts/types'
import { type Address, getAddress, } from 'viem'
import type { ChainId } from '../const/index.js'
import { decodeErc20 } from './erc20.js'
import type { IOperateStep } from './types.js'

interface ICallReader {
  readerId: string
  read(chainId: ChainId, call: IIAccount__Call, endsWithFee: boolean): IOperateStep[] | null
}

const erc20Reader: ICallReader = {
  readerId: 'erc20',
  read(_chainId, call, endsWithFee) {
    const token = getAddress(call.target)
    const erc20 = decodeErc20(call.callData)
    if (erc20?.functionName === 'approve') {
      const [spender, amount] = erc20.args as readonly [Address, bigint]
      return [{ kind: 'approve', token, spender: getAddress(spender), amount }]
    }
    if (erc20?.functionName === 'transfer') {
      const [to, amount] = erc20.args as readonly [Address, bigint]
      return endsWithFee ? [{ kind: 'fee', token, amount }] : [{ kind: 'release', token, to: getAddress(to), amount }]
    }
    return null
  }
}

const nativeReader: ICallReader = {
  readerId: 'native',
  read(_chainId, call) {
    if (call.callData !== '0x') return null
    return [{ kind: 'release', token: null, to: getAddress(call.target), amount: call.value }]
  }
}

export const READERS: readonly ICallReader[] = [nativeReader, erc20Reader]
