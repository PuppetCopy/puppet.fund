import { PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { registeredTokenAddresses } from '@puppet/sdk/state'
import { assertOperateSignable, decodeErc20, screenOperate, withCappedAllowance, withProtocolReferral } from '@puppet/sdk/venue'
import { type Address, getAddress, type Hex } from 'viem'
import context, { getPrice } from '../../../io/context.js'
import { readTokenBalance } from '../../../io/onchain/account.js'
import type { IRootState, IWalletPair } from '../../../wallet/index.js'
import type { IDappTransaction } from '../../../wallet/walletLink.js'
import { publicClientForChain } from './_shared.js'
import { type IAttestation, runOperateStep } from './steps.js'

export async function prepareDappTransaction(chainId: number, account: Address, tx: IDappTransaction): Promise<IDappTransaction> {
  if (tx.to === undefined || tx.data === undefined || decodeErc20(tx.data as Hex)?.functionName !== 'approve') return tx
  const fundBalance = await readTokenBalance(account, chainId as ChainId, getAddress(tx.to), 0)
  const capped = withCappedAllowance(chainId as ChainId, tx.data as Hex, fundBalance)
  return capped === tx.data ? tx : { ...tx, data: capped }
}

export async function passthroughOperate(
  pair: IWalletPair,
  root: IRootState,
  chainId: number,
  tx: IDappTransaction
): Promise<IAttestation> {
  if (tx.to === undefined) throw new Error('Contract creation is not supported from a Puppet account.')
  if (pair.wallet === null) throw new Error('Connect your wallet before trading through a linked dApp.')
  if (root.fund === null) throw new Error('Open a fund before trading through a linked dApp; the trade runs through the fund.')
  if (pair.keys === null) throw new Error('This build carries no key service, so nothing can be signed for the fund.')
  await pair.keys.restoreFund(pair.wallet, root.fund)
  const spoke = chainId as ChainId
  const account = root.fund.account
  const target = getAddress(tx.to)
  const value = tx.value === undefined ? 0n : BigInt(tx.value)
  const callData = withProtocolReferral(target, (tx.data ?? '0x') as Hex)
  const [tokenRegistry, chainLiveness] = await Promise.all([context.getTokenRegistry(), context.getChainLiveness()])
  const registered = registeredTokenAddresses(tokenRegistry, spoke)
  assertOperateSignable(
    screenOperate({
      chainId: spoke,
      callList: [{ target, value, gasLimit: tx.gas === undefined ? 0n : BigInt(tx.gas), callData }],
      account,
      registeredTokens: registered
    })
  )
  if (value > 0n) {
    const nativeBalance = await readTokenBalance(account, spoke, PROTOCOL.nativeToken, 0)
    if (value > nativeBalance) {
      const native = getTokenDescription(spoke, PROTOCOL.nativeToken)
      throw new Error(
        `This order sends ${readableTokenAmountLabel(native, value)} from your account, which holds ${readableTokenAmountLabel(native, nativeBalance)} on chain ${chainId}. Deposit more into the account first.`
      )
    }
  }
  const gasLimit =
    tx.gas === undefined
      ? ((await publicClientForChain(chainId).estimateGas({ account, to: target, value, data: callData })) * 12n) / 10n
      : BigInt(tx.gas)
  const funded = await Promise.all(
    registered.map(async token => {
      const fundBalance = await readTokenBalance(account, spoke, token, 0)
      return { token, value: fundBalance === 0n ? 0n : fundBalance * (await getPrice(spoke, token)).price }
    })
  )
  const richest = funded.reduce((best, h) => (h.value > best.value ? h : best))
  if (richest.value === 0n) {
    throw new Error(`Your fund on chain ${chainId} holds no registered token to pay the relay fee with; fund a round or bring funds here first.`)
  }
  return runOperateStep(
    {
      kind: 'operate',
      id: `operate:${chainId}`,
      chainId: spoke,
      feeToken: richest.token,
      callList: [{ target, value, gasLimit, callData }]
    },
    { tokenRegistry, wallet: pair.wallet, root, loadRoot: () => Promise.resolve(root), keys: pair.keys, chainLiveness }
  )
}
