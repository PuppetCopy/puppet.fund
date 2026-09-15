import { PROTOCOL } from '@puppet/contracts/const'
import { predictDepositRoute } from '@puppet/sdk/account'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { registeredTokenAddresses } from '@puppet/sdk/state'
import { assertOperateSignable, screenOperate, withProtocolReferral } from '@puppet/sdk/venue'
import { getAddress, type Hex } from 'viem'
import context, { getPrice } from '../../../io/context.js'
import { fetchBooks } from '../../../io/datastore/reads.js'
import { tradeViews } from '../../../io/datastore/trading.js'
import { readTokenBalance } from '../../../io/onchain/account.js'
import type { IBodyKeys, IConnectedWallet, IRootState } from '../../../wallet/index.js'
import type { IDappTransaction } from '../../../wallet/walletLink.js'
import { OPEN_CYCLE_SKIN } from '../$TradeEditors.js'
import { publicClientForChain } from './_shared.js'
import { type IAttestation, runOperateStep } from './steps.js'

export async function passthroughOperate(
  wallet: IConnectedWallet,
  root: IRootState,
  bodyKeys: IBodyKeys | null,
  chainId: number,
  tx: IDappTransaction
): Promise<IAttestation> {
  if (tx.to === undefined) throw new Error('Contract creation is not supported from a Puppet account.')
  const spoke = chainId as ChainId
  const account = root.account
  const views = await tradeViews((await fetchBooks({ master: account })).filter(b => Number(b.chainId) === chainId))
  const running = views.find(v => v.book.cycle > v.settledCycle)
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
      releaseTargets: [predictDepositRoute(wallet.address)],
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
  const holdings = await Promise.all(
    registered.map(async token => {
        const balance = await readTokenBalance(account, spoke, token, 0)
        return { token, value: balance === 0n ? 0n : balance * (await getPrice(spoke, token)).price }
      })
  )
  const richest = holdings.reduce((best, h) => (h.value > best.value ? h : best))
  if (richest.value === 0n) {
    throw new Error(`Your account on chain ${chainId} holds no registered token to pay the relay fee with; deposit into it first.`)
  }
  return runOperateStep(
    {
      kind: 'operate',
      id: `operate:${chainId}`,
      chainId: spoke,
      token: running === undefined ? richest.token : getAddress(running.book.token),
      skin: running === undefined ? OPEN_CYCLE_SKIN : running.book.skin,
      feeToken: richest.token,
      callList: [{ target, value, gasLimit, callData }]
    },
    { tokenRegistry, wallet, root, createAccount: () => Promise.resolve(root), bodyKeys, chainLiveness }
  )
}
