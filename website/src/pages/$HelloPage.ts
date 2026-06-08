import { HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { EMPTY_NAME, predictPuppetAccount } from '@puppet/sdk/account'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type ISubaccountState, stubMasterState, stubSubaccountState } from '@puppet/sdk/state'
import { roboAvatarName } from '@puppet/sdk/ui-components'
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
import { $AllocateEditor } from '../components/portfolio/$AllocateEditor.js'
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
import { DOCS_URL, OPERATOR_GUIDE_URL } from '../const/links.js'
import * as context from '../io/context.js'
import { bindSession, type IConnectedWallet, refreshWallet } from '../wallet/index.js'
import { $body, $bulletList, $callout, $linkButton, $stage, $stageHeader, $terminal } from './$onboarding.js'

type ITrack = 'puppet' | 'master'
type IMasterMode = 'human' | 'agent'
type ITemplate = 'base' | 'trend' | 'copy-trader' | 'llm-basic'

const TEMPLATE_LABEL: Record<ITemplate, string> = {
  base: 'Base',
  trend: 'Trend',
  'copy-trader': 'Copy-trader',
  'llm-basic': 'LLM'
}
const TEMPLATE_DESC: Record<ITemplate, string> = {
  base: 'A connected operator with an empty strategy body to fill in yourself (src/index.ts).',
  trend: 'Deterministic EMA(12/26) + RSI trend-follower on ETH, one position at a time, with a cooldown.',
  'copy-trader':
    'Mirrors a chosen GMX trader’s ETH position, sized to your funds, with risk caps and a liquidation guard (set TRADER_ACCOUNT).',
  'llm-basic': `LLM's decides long / flat / close via structured tool use; your code enforces the risk caps.`
}

export interface I$HelloPage {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  subaccountList: IStream<Promise<ISubaccountState[]>>
  draftDepositList: IStream<IDepositDraft[]>
  draftWithdrawList: IStream<IWithdrawDraft[]>
  activeMaster: IStream<Address | null>
}

const $accountStatusBadge = (predicted: IStream<Address>, accountList: IStream<ISubaccountState[]>): I$Node =>
  switchLatest(
    map(
      created =>
        created
          ? $node(
              style({
                flexShrink: '0',
                fontSize: text.xs,
                color: palette.positive,
                border: `1px solid ${colorShade(palette.positive, 30)}`,
                borderRadius: '100px',
                padding: '4px 10px'
              })
            )($text('Created'))
          : $node(
              style({
                flexShrink: '0',
                fontSize: text.xs,
                color: palette.foreground,
                border: `1px solid ${colorShade(palette.foreground, 30)}`,
                borderRadius: '100px',
                padding: '4px 10px'
              })
            )($text('Not created yet')),
      op(
        combine({ addr: predicted, accounts: accountList }),
        map(q => q.accounts.some(a => isAddressEqual(a.account, q.addr)))
      )
    )
  )

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
      [selectMode, selectModeTether]: IBehavior<IMasterMode>,
      [selectTemplate, selectTemplateTether]: IBehavior<ITemplate>
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
            // If the AccountState query already returned accounts for this wallet, reuse their signer so
            // we target the real account and skip the session prompt; only ask to sign when there are none.
            const existingSigner = p.accounts.find(a => isAddressEqual(a.user, wallet.address))?.signer
            const signer = wallet.session?.signer ?? existingSigner ?? wallet.address
            const needsSession = !wallet.session && !existingSigner
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
              placeholder: map(roboAvatarName, predicted),
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
              $column(spacing.tiny)(
                $tokenSelector,
                $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
                  $text(
                    'Base token: the currency your account holds and settles in. Matching and funding only happen within the same base token, so pick the one your traders use.'
                  )
                )
              ),
              $stubAccountDisplay({
                $title: $nameField,
                address: predicted,
                $detail: needsSession
                  ? $node(style({ fontSize: text.base, color: palette.indeterminate }))(
                      $text('Sign to maintain a session')
                    )
                  : undefined,
                $action: needsSession ? $signSession : $accountStatusBadge(predicted, subaccountListState)
              }),
              $accountSection
            )
          },
          combine({ wallet: walletState, registry: tokenRegistryValue, baseTokenId, accounts: subaccountListState })
        )
      )

      const $createMasterStep: I$Node = switchLatest(
        map(
          p => {
            if (!p.wallet) return $callout('Connect your wallet to create and fund your trading account.')
            const wallet = p.wallet
            // If the AccountState query already returned accounts for this wallet, reuse their signer so
            // we target the real account and skip the session prompt; only ask to sign when there are none.
            const existingSigner = p.accounts.find(a => isAddressEqual(a.user, wallet.address))?.signer
            const signer = wallet.session?.signer ?? existingSigner ?? wallet.address
            const needsSession = !wallet.session && !existingSigner
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
              placeholder: map(roboAvatarName, predicted),
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
                return $AllocateEditor({
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
              $column(spacing.tiny)(
                $tokenSelector,
                $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
                  $text(
                    'Base token: the currency your account holds and settles in. Matching and funding only happen within the same base token, so pick the one your traders use.'
                  )
                )
              ),
              $stubAccountDisplay({
                $title: $nameField,
                address: predicted,
                $detail: needsSession
                  ? $node(style({ fontSize: text.base, color: palette.indeterminate }))(
                      $text('Sign to maintain a session')
                    )
                  : undefined,
                $action: needsSession ? $signSession : $accountStatusBadge(predicted, subaccountListState)
              }),
              $accountSection
            )
          },
          combine({ wallet: walletState, registry: tokenRegistryValue, baseTokenId, accounts: subaccountListState })
        )
      )

      const $choiceCard = (
        track: ITrack,
        $iconNode: I$Node,
        kicker: string,
        title: string,
        desc: string,
        accent: string
      ): I$Node =>
        $card(
          spacing.small,
          style({
            flex: '1',
            minWidth: '240px',
            cursor: 'pointer',
            border: `1px solid ${colorShade(palette.foreground, 20)}`,
            transition: 'border-color 120ms ease-out, transform 120ms ease-out, box-shadow 120ms ease-out'
          }),
          stylePseudo(':hover', {
            borderColor: colorShade(palette.foreground, 50),
            transform: 'translateY(-2px)',
            boxShadow: '0 10px 28px -14px rgba(0, 0, 0, 0.65)'
          }),
          styleBehavior(map(t => (t === track ? { borderColor: accent } : {}), trackState)),
          selectTrackTether(nodeEvent('click'), constant(track))
        )(
          $row(spacing.default, style({ alignItems: 'center' }))(
            $icon({ $content: $iconNode, width: '40px', fill: accent, viewBox: '0 0 32 32' }),
            $column(spacing.tiny, style({ flex: '1', minWidth: '0' }))(
              $node(
                style({
                  fontSize: text.xs,
                  color: palette.foreground,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em'
                })
              )($text(kicker)),
              $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(title))
            ),
            $node(style({ color: accent, fontSize: text.lg, fontWeight: '600' }))($text('→'))
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

      // Template picker for the agent path: the four templates are alternatives (you scaffold one), so
      // pick one and its description + command render in a single terminal below.
      const templateState: IStream<ITemplate> = state('base', selectTemplate)
      const $templatePicker: I$Node = $ButtonToggle({
        value: templateState,
        optionList: ['base', 'trend', 'copy-trader', 'llm-basic'] satisfies ITemplate[],
        $$option: map((t: ITemplate) =>
          $node(style({ fontWeight: '600', color: palette.message, whiteSpace: 'nowrap', padding: '2px 4px' }))(
            $text(TEMPLATE_LABEL[t])
          )
        )
      })({ select: selectTemplateTether() })

      const $chooser: I$Node = $row(spacing.default, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
        $choiceCard(
          'puppet',
          $puppetLogo,
          'Puppet fund',
          'Back a trader',
          'Puppets (Investors) pick and choose top traders to fund by their rules',
          palette.primary
        ),
        $choiceCard(
          'master',
          $puppeteer,
          'Master Wallet',
          'Become a trader',
          'Traders seamlessly earn more doing what they do best',
          palette.positive
        )
      )

      // Step 1 folds in the chosen path's first concrete action (fund / create account), so picking a
      // path and getting set up read as one step rather than two. The steps below renumber from 2.
      const $subhead = (label: string): I$Node =>
        $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(label))

      const $firstAction: I$Node = switchLatest(
        map(track => {
          if (track === 'puppet') {
            return $card(spacing.default)($subhead('Fund your account'), $fundStep($fundEditor))
          }
          if (track === 'master') {
            return $card(spacing.default)($subhead('Create your trading account'), $createMasterStep)
          }
          return empty
        }, trackState)
      )

      const $flow: I$Node = switchLatest(
        map(track => {
          if (track === 'puppet') {
            return $column(spacing.big)(
              $stage(2, 'Find a trader', $findStep()),
              $stage(3, 'Write the rules', $rulesStep()),
              $stage(4, 'Hold, track, exit', $exitStep()),
              $stage(5, 'Why it adds up', $puppetNextStep())
            )
          }
          if (track === 'master') {
            return $column(spacing.big)(
              $stage(
                2,
                'Choose how you run it',
                $column(spacing.default)(
                  $masterModeToggle,
                  switchLatest(
                    map(
                      mode => (mode === 'agent' ? $spinUpStep(templateState, $templatePicker) : $tradeStep()),
                      modeState
                    )
                  )
                )
              ),
              $stage(
                3,
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
          $column(spacing.default)($stageHeader(1, 'Choose your path'), $chooser, $firstAction),
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
    $node(style({ fontSize: text.lg, lineHeight: '1.5' }))(
      $element('span')(style({ color: palette.foreground }))(
        $text('Puppet connects backers and traders under signed rules. ')
      ),
      $element('span')(style({ color: palette.message }))(
        $text('You hold custody. Your subaccount is a smart wallet controlled by you.')
      )
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
      $linkButton('How it works', DOCS_URL, false)
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
    $row(spacing.default, style({ paddingTop: '8px' }))($linkButton('Install Puppet Wallet', DOCS_URL, false))
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
      $linkButton('Protocol docs', DOCS_URL, false)
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

const $spinUpStep = (templateState: IStream<ITemplate>, $picker: I$Node): I$Node =>
  $column(spacing.default)(
    $step(
      1,
      'Pick a template and scaffold it on your machine:',
      $column(spacing.default)(
        $picker,
        switchLatest(
          map(
            (t: ITemplate) => $terminal([`bunx @puppet.fund/templates my-operator gmx ${t}`], TEMPLATE_DESC[t]),
            templateState
          )
        ),
        $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text('Then:')),
        $terminal(['cd my-operator', 'bun install', 'bun run dev'])
      )
    ),
    $step(2, 'It prints a pair link. Open that link here, on this site.'),
    $step(3, 'Click “Send session to agent” in the banner at the top.'),
    $step(4, 'Done. The agent opens and maintains positions; you fund and redeem here.'),
    $callout(
      'Shape the strategy in src/index.ts. The agent only acts within the rules you signed, and it can never move funds out of your account.'
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
      $linkButton('Agent guide', OPERATOR_GUIDE_URL, false),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )
