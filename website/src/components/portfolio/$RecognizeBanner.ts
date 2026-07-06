import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import DEPLOYMENTS from '@puppet/contracts/deployments'
import { getChainTokenDescription, readableTokenAmount } from '@puppet/sdk/core'
import { type ITokenRegistryMap, tokenInfoFor } from '@puppet/sdk/state'
import { empty, fromPromise, type IStream, map, op, sampleMap, switchLatest } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, component, style } from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { type Address, erc20Abi, getAddress, } from 'viem'
import { readContract } from 'viem/actions'
import { $ButtonSecondary, text } from '@/ui-components'
import { homePublicClient } from '../../wallet/index.js'
import type { IRecognizeFundDraft } from './draft.js'

const FUND_ACCOUNT_ABI = DEPLOYMENTS[`FundAccount:${HUB_CHAIN_ID}`].abi

export interface I$RecognizeBanner {
  master: Address
  masterAccount: Address
  baseToken: Address
  tokenRegistry: ITokenRegistryMap
}

// A closed position's collateral + pnl returns to the fund account as a raw ERC-20 transfer (no signed-domain event),
// so it sits as balanceOf(fund) above the co-signed signedBalanceOf until a recognize operate credits it. That gap is
// the recognizable surplus; reading it on-chain is the only way to see it (the ingest's recorded balance never moved).
async function readSurplus(fund: Address, baseToken: Address): Promise<bigint> {
  try {
    const [held, signed] = await Promise.all([
      readContract(homePublicClient, { address: baseToken, abi: erc20Abi, functionName: 'balanceOf', args: [fund] }),
      readContract(homePublicClient, {
        address: fund,
        abi: FUND_ACCOUNT_ABI,
        functionName: 'signedBalanceOf',
        args: [baseToken]
      })
    ])
    return held > signed ? held - signed : 0n
  } catch {
    return 0n
  }
}

export const $RecognizeBanner = ({ master, masterAccount, baseToken, tokenRegistry }: I$RecognizeBanner) =>
  component(([clickRecognize, clickRecognizeTether]: IBehavior<PointerEvent>) => {
    const desc = getChainTokenDescription(HUB_CHAIN_ID, tokenInfoFor(tokenRegistry, HUB_CHAIN_ID, baseToken).token)
    const surplus: IStream<bigint> = op(
      fromPromise(readSurplus(getAddress(masterAccount), getAddress(baseToken))),
      state(0n)
    )

    const draft: IStream<IRecognizeFundDraft> = sampleMap(
      (amount): IRecognizeFundDraft => ({
        kind: 'recognizeFund',
        id: `recognize:${masterAccount}`,
        account: masterAccount,
        title: 'Recognize',
        alert: null,
        master,
        masterAccount,
        baseToken,
        surplus: amount
      }),
      surplus,
      clickRecognize
    )

    return [
      switchLatest(
        map(
          amount =>
            amount === 0n
              ? empty
              : $row(
                  spacing.small,
                  style({
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${palette.foreground}`
                  })
                )(
                  $column(style({ gap: '2px', minWidth: '0' }))(
                    $node(style({ color: palette.message, fontWeight: '600', fontSize: text.sm }))(
                      $text(`${readableTokenAmount(desc, amount)} ${desc.symbol} to recognize`)
                    ),
                    $node(style({ color: palette.foreground, fontSize: text.xs }))(
                      $text('A closed position returned funds. Count them into your fund so they add to its value and can be redeemed.')
                    )
                  ),
                  $ButtonSecondary({ $content: $text('Recognize') })({ click: clickRecognizeTether() })
                ),
          surplus
        )
      ),
      { change: draft }
    ]
  })
