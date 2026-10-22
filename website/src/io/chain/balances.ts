import { PROTOCOL } from '@puppet/contracts/const'
import { CHAIN_MAP, type ChainId } from '@puppet/sdk/const'
import { type IStream, just, map, op, switchMap } from 'aelea/stream'
import { state } from 'aelea/stream-extended'
import { type Address, erc20Abi, isAddressEqual, parseAbi } from 'viem'
import { localFirst } from '../datastore/reads.js'
import { localViewCall, viewCall } from '../onchain/viewRead.js'

export type IBalanceRead = bigint | { error: unknown }

export interface IWalletBalance {
  stored: () => Promise<bigint | null>
  shown: IStream<Promise<bigint>>
  fresh: IStream<Promise<bigint>>
}

const MULTICALL3_ABI = parseAbi(['function getEthBalance(address addr) view returns (uint256 balance)'])
const NEVER = new Promise<never>(() => {})

export function walletBalanceOf(owner: Address, chainId: ChainId, token: Address): IWalletBalance {
  const multicall3 = CHAIN_MAP[chainId].contracts?.multicall3?.address
  if (multicall3 === undefined) throw new Error(`chain ${chainId} names no Multicall3, so its native balance cannot be read`)
  const native = isAddressEqual(token, PROTOCOL.nativeToken)
  const stored = (): Promise<bigint | null> =>
    native
      ? localViewCall({ chainId, address: multicall3, abi: MULTICALL3_ABI, functionName: 'getEthBalance', args: [owner] })
      : localViewCall({ chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  const reads = op(
    just(null),
    map(() => {
      const known = stored()
      const latest = native
        ? viewCall({ chainId, address: multicall3, abi: MULTICALL3_ABI, functionName: 'getEthBalance', args: [owner], maxAge: 0 })
        : viewCall({ chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], maxAge: 0 })
      return { known, latest }
    }),
    state()
  )
  return {
    stored,
    shown: op(
      reads,
      switchMap(read =>
        localFirst(
          () => read.known.then(held => (held === null ? NEVER : held)),
          () => read.latest
        )
      )
    ),
    fresh: map(read => read.latest, reads)
  }
}
