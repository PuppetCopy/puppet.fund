import { routerproxyAbi } from '@puppet/contracts/abi'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import TOKEN, { TOKEN_BRIDGES, TOKEN_CHAIN_ID } from '@puppet/contracts/token'
import {
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddressEqual,
  type PublicClient,
  size,
  slice,
  toFunctionSelector,
  toFunctionSignature
} from 'viem'
import { IMPLEMENTATION_SLOT } from '../const/common.js'

const CONTRACT_LIST = [
  ...Object.entries(DEPLOYMENTS as Record<string, { address: Address; abi: Abi }>).map(([key, entry]) => ({
    name: key.slice(0, key.indexOf(':')),
    chainId: Number(key.slice(key.indexOf(':') + 1)),
    address: entry.address,
    abi: entry.abi
  })),
  ...Object.entries(TOKEN as Record<string, { address: Address; abi: Abi }>).map(([name, entry]) => ({
    name,
    chainId: TOKEN_CHAIN_ID as number,
    address: entry.address,
    abi: entry.abi
  }))
]

const contractAt = (chainId: number, address: Address) =>
  CONTRACT_LIST.find(contract => contract.chainId === chainId && isAddressEqual(contract.address, address)) ?? null

const functionOf = (abi: Abi, data: Hex) =>
  size(data) < 4
    ? null
    : (abi.find((item): item is AbiFunction => item.type === 'function' && toFunctionSelector(item) === slice(data, 0, 4)) ?? null)

const argsOf = (chainId: number, abi: Abi, inputs: readonly AbiParameter[], values: readonly unknown[]) =>
  inputs.map((input, i) => {
    const value = values[i]
    const granted = input.type === 'bytes4' ? functionOf(abi, value as Hex) : null
    return {
      name: (input.name ?? '').replace(/^_+/, ''),
      type: input.type,
      value,
      label:
        input.type === 'address'
          ? (contractAt(chainId, value as Address)?.name ?? null)
          : granted === null
            ? null
            : toFunctionSignature(granted)
    }
  })

const decodeCall = (chainId: number, target: Address, value: bigint, gasLimit: bigint | null, data: Hex) => {
  const contract = contractAt(chainId, target)
  const abi: Abi | null = contract === null ? null : [...contract.abi, ...routerproxyAbi]
  const fn = abi === null ? null : functionOf(abi, data)
  return {
    chainId,
    target,
    name: contract?.name ?? null,
    value,
    gasLimit,
    data,
    fn:
      abi === null || fn === null
        ? null
        : {
            name: fn.name,
            signature: toFunctionSignature(fn),
            args: argsOf(chainId, abi, fn.inputs, decodeFunctionData({ abi: [fn], data }).args ?? [])
          }
  }
}

export type IProposalCall = ReturnType<typeof decodeCall>

export const decodeProposal = (targets: readonly Address[], values: readonly bigint[], calldatas: readonly Hex[]) => {
  if (values.length !== targets.length || calldatas.length !== targets.length) {
    throw new Error(`a proposal of ${targets.length} targets carries ${values.length} values and ${calldatas.length} calldatas`)
  }
  return targets.map((target, i) => {
    const bridge = Object.entries(TOKEN_BRIDGES as Record<string, { address: Address; abi: Abi }>).find(([, pinned]) =>
      isAddressEqual(pinned.address, target)
    )
    if (bridge === undefined) return { kind: 'call' as const, call: decodeCall(TOKEN_CHAIN_ID, target, values[i], null, calldatas[i]) }
    const chainId = Number(bridge[0])
    const fn = functionOf(bridge[1].abi, calldatas[i])
    if (fn === null) throw new Error(`the call to ${target}, the chain ${chainId} bridge, matches none of its functions`)
    const args = decodeFunctionData({ abi: [fn], data: calldatas[i] }).args ?? []
    const receiverAt = fn.inputs.findIndex(input => input.name === '_to' || input.name === '_receiver')
    const messageAt = fn.inputs.findIndex(input => input.type === 'bytes')
    if (receiverAt === -1 || messageAt === -1) throw new Error(`${fn.name} on the chain ${chainId} bridge names no receiver or message`)
    const receiver = args[receiverAt] as Address
    const message = args[messageAt] as Hex
    const account = CONTRACT_LIST.find(contract => contract.chainId === chainId && contract.name === 'GovernorAccount')
    if (account === undefined) throw new Error(`the manifest names no GovernorAccount on chain ${chainId}; regenerate @puppet/contracts`)
    const execute = account.abi.find((item): item is AbiFunction => item.type === 'function' && item.name === 'execute')
    if (execute === undefined) throw new Error(`the GovernorAccount ABI on chain ${chainId} has no execute`)
    const batch = isAddressEqual(receiver, account.address)
      ? size(message) >= 4 && slice(message, 0, 4) === toFunctionSelector(execute)
        ? (decodeFunctionData({ abi: [execute], data: message }).args ?? [])
        : decodeAbiParameters(execute.inputs, message)
      : null
    return {
      kind: 'bridged' as const,
      chainId,
      bridge: {
        target,
        value: values[i],
        data: calldatas[i],
        fn: { name: fn.name, signature: toFunctionSignature(fn), args: argsOf(chainId, bridge[1].abi, fn.inputs, args) }
      },
      batch:
        batch === null
          ? null
          : {
              deadline: batch[0] as bigint,
              callList: (batch[1] as readonly { target: Address; value: bigint; gasLimit: bigint; callData: Hex }[]).map(call =>
                decodeCall(chainId, call.target, call.value, call.gasLimit, call.callData)
              )
            }
    }
  })
}

export type IProposalAction = ReturnType<typeof decodeProposal>[number]

export const readCallState = async (client: PublicClient, call: IProposalCall): Promise<Hex | null> => {
  if (call.fn === null) return null
  if (call.fn.name === 'upgrade') {
    const slot = await client.getStorageAt({ address: call.target, slot: IMPLEMENTATION_SLOT })
    if (slot === undefined) throw new Error(`chain ${call.chainId} answered no ERC-1967 slot for ${call.target}`)
    return getAddress(slice(slot, 12))
  }
  const contract = contractAt(call.chainId, call.target)
  if (contract === null) throw new Error(`${call.target} on chain ${call.chainId} left the manifest after decoding`)
  if (call.fn.name === 'approve' && contract.name === 'Release') {
    return (await client.readContract({ address: call.target, abi: contract.abi, functionName: 'current' })) as Hex
  }
  if (call.fn.name === 'setImplementation') {
    return (await client.readContract({ address: call.target, abi: contract.abi, functionName: 'implementation' })) as Address
  }
  if (call.fn.name === 'setAccess') {
    const { data } = await client.call({ to: call.target, data: encodeFunctionData({ abi: contract.abi, functionName: 'authMap', args: [call.fn.args[0]?.value] }) })
    if (data !== undefined && data !== '0x') return decodeFunctionResult({ abi: contract.abi, functionName: 'authMap', data }) as Hex
    const slot = await client.getStorageAt({ address: call.target, slot: IMPLEMENTATION_SLOT })
    if (slot === undefined || BigInt(slot) !== 0n) throw new Error(`${call.target} on chain ${call.chainId} answered authMap with no data`)
    return '0x00000000'
  }
  return null
}
