import { HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { EMPTY_NAME, predictPuppetAccount, TOKEN_ID } from '@puppet/sdk/account'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type ISubaccountState, stubMasterState, stubSubaccountState } from '@puppet/sdk/state'
import { pixelAvatarName } from '@puppet/sdk/ui-components'
import {
  combine,
  constant,
  empty,
  filter,
  type IStream,
  map,
  nowWith,
  op,
  switchLatest,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $element,
  $node,
  $text,
  component,
  effectProp,
  type I$Node,
  type INode,
  nodeEvent,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { $column, $row, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, type Hex, isAddressEqual, toHex } from 'viem'
import {
  $ButtonToggle,
  $defaultButtonPrimary,
  $FieldLabeled,
  $icon,
  $puppeteer,
  $tokenLabelFromSummary,
  text
} from '@/ui-components'
import { $puppetLogo } from '../common/$icons.js'
import { $heading1 } from '../common/$text.js'
import { $card } from '../common/elements/$common.js'
import { $stubAccountDisplay } from '../components/$AccountProfile.js'
import { $MasterAccountEditor } from '../components/portfolio/$MasterAccountEditor.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  ICreateMasterDraft,
  IDepositDraft,
  IFulfillDraft,
  ISellDraft,
  IWithdrawDraft
} from '../components/portfolio/draft.js'
import * as context from '../io/context.js'
import { bindSession, type IConnectedWallet, refreshWallet } from '../wallet/index.js'
import { $body, $bulletList, $callout, $codeBlock, $linkButton, $stage } from './$onboarding.js'

type ITrack = 'puppet' | 'master'
type IMasterMode = 'human' | 'agent'

export interface I$HelloPage {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  subaccountList: IStream<Promise<ISubaccountState[]>>
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  activeMaster: IStream<Address | null>
}

export const $HelloPage = ({
  walletQuery,
  subaccountList,
  draftDepositList,
  draftWithdrawList,
  activeMaster
}: I$HelloPage) =>
  component(
    (
      [changeDraft, changeDraftTether]: IBehavior<IDepositDraft | IWithdrawDraft>,
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft | ICreateMasterDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IFulfillDraft>,
      [selectBaseToken, selectBaseTokenTether]: IBehavior<Hex>,
      [changeName, changeNameTether]: IBehavior<string>,
      [selectTrack, selectTrackTether]: IBehavior<INode, ITrack>,
      [selectMode, selectModeTether]: IBehavior<IMasterMode>
    ) => {
      const walletState: IStream<IConnectedWallet | null> = op(walletQuery, switchPromises, state())
      const subaccountListState: IStream<ISubaccountState[]> = op(subaccountList, switchPromises, state())
      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)
      const baseTokenId: IStream<Hex> = state(TOKEN_ID.USDC, selectBaseToken)
      const nameInput: IStream<string> = state('', changeName)
      const settledName: IStream<string> = state('', nameInput)
      const trackState: IStream<ITrack | null> = state(null, selectTrack)
      const modeState: IStream<IMasterMode> = state('human', selectMode)

      const $fundEditor: I$Node = switchLatest(
        map(
          p => {
            if (!p.wallet) return $callout('Connect your wallet to fund your account.')
            const wallet = p.wallet
            const signer = wallet.session?.signer ?? wallet.address
            const homeTokens = p.registry.get(HUB_CHAIN_ID)
            const $tokenSelector = $ButtonToggle({
              value: baseTokenId,
              optionList: [...(homeTokens?.keys() ?? [])],
              $$option: map((id: Hex) => {
                const info = homeTokens?.get(id)
                return $node(info ? $tokenLabelFromSummary(getTokenDescription(info.token)) : $text(id))
              })
            })({ select: selectBaseTokenTether() })

            const predicted = op(
              settledName,
              map(rawName => {
                const name = rawName.trim() ? toHex(rawName.trim(), { size: 32 }) : EMPTY_NAME
                return predictPuppetAccount({ user: wallet.address, name, baseTokenId: p.baseTokenId, signer })
              })
            )

            const $nameField = $FieldLabeled({
              label: null,
              placeholder: map(pixelAvatarName, predicted),
              maxLength: 32,
              value: nameInput
            })({
              change: changeNameTether()
            })

            const $signSession = $defaultButtonPrimary(
              style({ flexShrink: '0', alignSelf: 'center' }),
              effectProp(
                'onclick',
                nowWith(() => () => {
                  bindSession(wallet)
                    .then(() => refreshWallet())
                    .catch(e => console.error('create session failed', e))
                })
              )
            )($text('Sign session'))

            const $accountSection = switchLatest(
              map(rawName => {
                const name = rawName.trim() ? toHex(rawName.trim(), { size: 32 }) : EMPTY_NAME
                const derivation = { user: wallet.address, name, baseTokenId: p.baseTokenId }
                const lateBindDerivation = wallet.session ? undefined : derivation
                const acc = predictPuppetAccount({ ...derivation, signer })
                const baseAccount: IStream<ISubaccountState> = op(
                  subaccountListState,
                  map(list => list.find(b => b.account === acc) ?? stubSubaccountState({ ...derivation, signer }))
                )
                const editorDraft = op(
                  combine({ account: baseAccount, dep: draftDepositList, wd: draftWithdrawList }),
                  map(d => {
                    const addr = d.account.account
                    return d.dep.find(x => x.account === addr) ?? d.wd.find(x => x.account === addr) ?? null
                  })
                )
                return $TokenBalanceEditor({
                  accountState: baseAccount,
                  tokenRegistry: p.registry,
                  walletAccount: wallet,
                  lateBindDerivation,
                  draft: editorDraft
                })({ changeDraft: changeDraftTether() })
              }, settledName)
            )

            return $column(spacing.default)(
              $tokenSelector,
              $stubAccountDisplay({
                $title: $nameField,
                address: predicted,
                $detail: wallet.session
                  ? undefined
                  : $node(style({ fontSize: text.base, color: palette.indeterminate }))(
                      $text('Sign to maintain a session')
                    ),
                $action: wallet.session ? undefined : $signSession
              }),
              $accountSection
            )
          },
          combine({ wallet: walletState, registry: tokenRegistryValue, baseTokenId })
        )
      )

      const $createMasterStep: I$Node = switchLatest(
        map(
          p => {
            if (!p.wallet) return $callout('Connect your wallet to create and fund your trading account.')
            const wallet = p.wallet
            const signer = wallet.session?.signer ?? wallet.address
            const homeTokens = p.registry.get(HUB_CHAIN_ID)
            const $tokenSelector = $ButtonToggle({
              value: baseTokenId,
              optionList: [...(homeTokens?.keys() ?? [])],
              $$option: map((id: Hex) => {
                const info = homeTokens?.get(id)
                return $node(info ? $tokenLabelFromSummary(getTokenDescription(info.token)) : $text(id))
              })
            })({ select: selectBaseTokenTether() })

            const masterStub = (rawName: string): ISubaccountState => {
              const name = rawName.trim() ? toHex(rawName.trim(), { size: 32 }) : EMPTY_NAME
              const params: IAccountLib__AccountInitParams = {
                user: wallet.address,
                name,
                baseTokenId: p.baseTokenId,
                signer
              }
              return stubMasterState(params)
            }

            const predicted = op(
              settledName,
              map(rawName => masterStub(rawName).account)
            )

            const $nameField = $FieldLabeled({
              label: null,
              placeholder: map(pixelAvatarName, predicted),
              maxLength: 32,
              value: nameInput
            })({
              change: changeNameTether()
            })

            const $signSession = $defaultButtonPrimary(
              style({ flexShrink: '0', alignSelf: 'center' }),
              effectProp(
                'onclick',
                nowWith(() => () => {
                  bindSession(wallet)
                    .then(() => refreshWallet())
                    .catch(e => console.error('create session failed', e))
                })
              )
            )($text('Sign session'))

            const $accountSection = switchLatest(
              map(rawName => {
                const stub = masterStub(rawName)
                const account: IStream<ISubaccountState> = op(
                  subaccountListState,
                  map(list => list.find(b => isAddressEqual(b.account, stub.account)) ?? stub)
                )
                return $MasterAccountEditor({
                  account,
                  walletAccount: wallet,
                  tokenRegistry: p.registry,
                  activeMaster
                })({
                  changeDraft: changeMasterDraftTether(),
                  changeRedeemDraft: changeRedeemDraftTether(),
                  changeFulfillDraft: changeFulfillDraftTether()
                })
              }, settledName)
            )

            return $column(spacing.default)(
              $tokenSelector,
              $stubAccountDisplay({
                $title: $nameField,
                address: predicted,
                $detail: wallet.session
                  ? undefined
                  : $node(style({ fontSize: text.base, color: palette.indeterminate }))(
                      $text('Sign to maintain a session')
                    ),
                $action: wallet.session ? undefined : $signSession
              }),
              $accountSection
            )
          },
          combine({ wallet: walletState, registry: tokenRegistryValue, baseTokenId })
        )
      )

      const $choiceCard = (track: ITrack, $iconNode: I$Node, title: string, desc: string): I$Node =>
        $card(
          spacing.small,
          style({
            flex: '1',
            minWidth: '240px',
            cursor: 'pointer',
            border: `1px solid ${colorShade(palette.foreground, 20)}`,
            transition: 'border-color 120ms ease-out'
          }),
          stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 50) }),
          styleBehavior(map(t => (t === track ? { borderColor: palette.primary } : {}), trackState)),
          selectTrackTether(nodeEvent('click'), constant(track))
        )(
          $row(spacing.small, style({ alignItems: 'center' }))(
            $icon({ $content: $iconNode, width: '38px', fill: palette.foreground, viewBox: '0 0 32 32' }),
            $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(title))
          ),
          $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text(desc))
        )

      const modeLabel: Record<IMasterMode, [string, string]> = {
        human: ['Trade by hand', 'You place each trade yourself with the Puppet Wallet extension.'],
        agent: ['Run an agent (bot)', 'A bot opens and maintains positions within the rules you signed.']
      }
      const $masterModeToggle: I$Node = $ButtonToggle({
        value: modeState,
        optionList: ['human', 'agent'] satisfies IMasterMode[],
        $$option: map((mode: IMasterMode) =>
          $column(spacing.tiny, style({ alignItems: 'center', textAlign: 'center', padding: '4px 0' }))(
            $node(style({ fontWeight: '600', color: palette.message }))($text(modeLabel[mode][0])),
            $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.5' }))($text(modeLabel[mode][1]))
          )
        )
      })({ select: selectModeTether() })

      const $chooser: I$Node = $row(spacing.default, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
        $choiceCard(
          'puppet',
          $puppetLogo,
          'Puppet fund',
          'Access the world’s top traders and fund the ones you believe in, All of them, under your rules.'
        ),
        $choiceCard(
          'master',
          $puppeteer,
          'Run a Master account',
          'Create an account and trade seamlessly. Build a track record and earn more doing what you do best.'
        )
      )

      const $flow: I$Node = switchLatest(
        map(track => {
          if (track === 'puppet') {
            return $column(spacing.big)(
              $stage(2, 'Fund your account', $fundStep($fundEditor)),
              $stage(3, 'Find a trader', $findStep()),
              $stage(4, 'Write the rules', $rulesStep()),
              $stage(5, 'Hold, track, exit', $exitStep()),
              $stage(6, 'Why it adds up', $puppetNextStep())
            )
          }
          if (track === 'master') {
            return $column(spacing.big)(
              $stage(2, 'Create your trading account', $createMasterStep),
              $stage(
                3,
                'Choose how you run it',
                $column(spacing.default)(
                  $masterModeToggle,
                  switchLatest(map(mode => (mode === 'agent' ? $spinUpStep() : $tradeStep()), modeState))
                )
              ),
              $stage(
                4,
                'From here',
                switchLatest(map(mode => (mode === 'agent' ? $agentNextStep() : $humanNextStep()), modeState))
              )
            )
          }
          return empty
        }, trackState)
      )

      return [
        $column(spacing.big, style({ maxWidth: '860px', margin: '0 auto', padding: '32px 24px' }))(
          $hero(),
          $stage(1, 'Choose your path', $chooser),
          $flow
        ),
        {
          changeDraft,
          changeCreateMasterDraft: filter((d): d is ICreateMasterDraft => d.kind === 'createMaster', changeMasterDraft),
          changeAllocateDraft: filter((d): d is IAllocateDraft => d.kind === 'allocate', changeMasterDraft),
          changeRedeemDraft,
          changeFulfillDraft
        }
      ]
    }
  )

const $hero = (): I$Node =>
  $column(spacing.default, style({ paddingBottom: '12px' }))(
    $heading1($text('Hello.')),
    $node(style({ fontSize: text.lg, color: palette.foreground, lineHeight: '1.5' }))(
      $text(
        'Puppet connects backers and traders under signed rules, with custody held by the protocol and never a counterparty.'
      )
    ),
    $node(style({ fontSize: text.lg, color: palette.foreground, lineHeight: '1.5' }))(
      $text('Pick how you want to take part. The steps below adapt to your choice.')
    )
  )

const $fundStep = ($editor: I$Node): I$Node =>
  $column(spacing.default)(
    $body(
      'Deposit into your account, then allocate to traders you back. Every action is co-signed by you and the protocol against your rules before the wallet executes - custody stays with your own wallet, never the trader.'
    ),
    $editor
  )

const $findStep = (): I$Node =>
  $column(spacing.default)(
    $body(
      'Every trade lands on-chain, so the leaderboard is a real track record, not a pitch. Browse traders and pick the histories you believe in.'
    ),
    $element('div')(style({ display: 'flex' }))($linkButton('Browse the leaderboard', '/', true))
  )

const $rulesStep = (): I$Node =>
  $column(spacing.default)(
    $body('You set the rulebook for each trader you back, and the wallet can only ever draw within what you signed:'),
    $bulletList([
      ['Allowance ceiling', 'the most of your funds a trader can ever put to work.'],
      ['Rate limit', 'how fast that allowance can be drawn down.'],
      ['Throttle', 'how often a single action can repeat.']
    ])
  )

const $exitStep = (): I$Node =>
  $body(
    'You hold transferable shares of the trader’s pool. Watch performance live, and redeem your shares at a fair, attested value any time, with no trader approval needed.'
  )

const $puppetNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('Exposure to traders you choose, under a rulebook you control, with a clear path out.'),
    $bulletList([
      [
        'Puppet never holds your funds',
        'they sit in a smart account only you control, not a Puppet wallet or treasury.'
      ],
      ['Same performance, more upside', 'your capital trades alongside the trader’s own.'],
      ['Bounded by rules, not trust', 'co-signed limits cap every action before it executes.'],
      ['Always an exit', 'redeem your shares at attested value whenever you want.']
    ]),
    $callout(
      'Why it stays yours: every action needs your signature and runs within the rules you set, withdrawals always return to your own wallet, and there is no admin key. No operator, trader, or Puppet team member can move or seize your money.'
    ),
    $element('div')(style({ display: 'flex', gap: '12px', paddingTop: '8px', flexWrap: 'wrap' }))(
      $linkButton('Browse traders', '/', true),
      $linkButton('How it works', 'https://docs.puppet.fund', false)
    )
  )

const $tradeStep = (): I$Node =>
  $column(spacing.default)(
    $body(
      'Trading by hand runs through Puppet Wallet, a browser extension that connects this account to GMX and any dApp. Install it once and trade straight from the venue you already use.'
    ),
    $callout(
      'Puppet Wallet never holds your real wallet keys. It can only sign trades within the rules you set, and can only ever send funds back to you, so it can never move your money out.'
    ),
    $row(
      spacing.default,
      style({ paddingTop: '8px' })
    )($linkButton('Install Puppet Wallet', 'https://docs.puppet.fund', false))
  )

const $humanNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('A funded account and a record that grows with every settled trade. From here, performance is the work.'),
    $bulletList([
      [
        'Watch your first trade settle',
        'Every action lands on Arbitrum and on the leaderboard the moment it executes.'
      ],
      [
        'Build a track record',
        'Each settled trade adds to a public history tied to this account. The chain is the proof.'
      ],
      [
        'Attract outside capital',
        'Once your record is worth following, backers fund you under rules they set, and you trade for the pool.'
      ]
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))(
      $linkButton('Leaderboard', '/', true),
      $linkButton('Protocol docs', 'https://docs.puppet.fund', false)
    )
  )

const $step = (n: number, label: string, $extra?: I$Node): I$Node =>
  $column(spacing.small)(
    $row(spacing.small, style({ alignItems: 'baseline' }))(
      $node(style({ color: palette.primary, fontWeight: '700', fontSize: text.sm, minWidth: '18px' }))($text(`${n}.`)),
      $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.6', flex: 1 }))($text(label))
    ),
    ...(($extra ? [$extra] : []) as I$Node[])
  )

const $spinUpStep = (): I$Node =>
  $column(spacing.default)(
    $step(
      1,
      'Start the GMX template on your machine:',
      $codeBlock(['bunx @puppet.fund/templates my-operator gmx', 'cd my-operator', 'bun install', 'bun run dev'])
    ),
    $step(2, 'It prints a pair link. Open that link here, on this site.'),
    $step(3, 'Click “Send session to agent” in the banner at the top.'),
    $step(4, 'Done. The agent opens and maintains positions; you fund and redeem here.'),
    $callout(
      'Shape the strategy in src/venues/gmx.ts. The agent only acts within the rules you signed, and it can never move funds out of your account.'
    )
  )

const $agentNextStep = (): I$Node =>
  $column(spacing.default)(
    $body(
      'A funded account, a session that never leaves your browser, an agent trading within your rules. From here, performance is the work.'
    ),
    $bulletList([
      [
        'Watch your first trade settle',
        'Every action lands on Arbitrum and on the leaderboard the moment your strategy executes.'
      ],
      [
        'Build a track record',
        'Each settled trade adds to a public history tied to this wallet. The chain is the proof.'
      ],
      [
        'Attract outside capital',
        'Once your record is worth following, others subscribe. Their funds flow under rules they set, and your strategy trades for the pool.'
      ]
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))(
      $linkButton('Leaderboard', '/', true),
      $linkButton('Agent guide', 'https://github.com/PuppetCopy/monorepo/blob/main/operator/README.md', false),
      $linkButton('Protocol docs', 'https://docs.puppet.fund', false)
    )
  )
