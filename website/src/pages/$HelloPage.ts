import { HUB_CHAIN_ID, TOKEN_ID } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount, predictShareToken } from '@puppet/sdk/account'
import { ADDRESS_ZERO, BYTES32_ZERO } from '@puppet/sdk/const'
import { getTokenDescription } from '@puppet/sdk/gmx'
import { type ISubaccountState, type ITokenRegistryMap, stubSubaccountState } from '@puppet/sdk/state'
import { roboAvatarName } from '@puppet/sdk/ui-components'
import {
  combine,
  constant,
  empty,
  filter,
  type IStream,
  just,
  map,
  nowWith,
  op,
  skipRepeatsWith,
  switchLatest,
  switchPromises
} from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import {
  $node,
  $text,
  attr,
  component,
  effectProp,
  type I$Node,
  type INode,
  nodeEvent,
  style,
  styleBehavior,
  stylePseudo
} from 'aelea/ui'
import { $column, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, getAddress, type Hex } from 'viem'
import {
  $anchor,
  $ButtonSecondary,
  $ButtonToggle,
  $defaultButtonPrimary,
  $defaultButtonSecondary,
  $defaultTextFieldContainer,
  $FieldLabeled,
  $icon,
  $labelDisplay,
  $popoverCaret,
  $puppeteer,
  $smartContract,
  $tokenLabelFromSummary,
  text
} from '@/ui-components'
import { $heading1 } from '../common/$text.js'
import { $puppetLogo } from '../common/$icons.js'
import { $card, $card2, $defaultMockWindow, $mockWindow } from '../common/elements/$common.js'
import { $fundProfile, accountNameToHex, readableAccountName } from '../components/$AccountProfile.js'
import { $WalletLink } from '../components/$WalletLink.js'
import { $enableSessionDisclaimer } from '../components/$enableSession.js'
import { $FundEditor } from '../components/portfolio/$FundEditor.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import type { IAllocateDraft, IClaimDraft, IRedeemDraft, ISellDraft, ISwapDraft } from '../components/portfolio/draft.js'
import { routeSchema } from '../app/routeSchema.js'
import { DOCS_URL, GITHUB_REPO_URL, OPERATOR_GUIDE_URL } from '../const/links.js'
import * as context from '../io/context.js'
import { bindSession, type IConnectedWallet, refreshWallet } from '../wallet/index.js'
import { canInstallApp, promptInstallApp } from '../utils/pwaInstall.js'
import { $body, $bulletList, $callout, $linkButton, $stageHeader, $terminal } from './$onboarding.js'

type IMasterMode = 'human' | 'agent'
type ITemplate = 'base' | 'guarded' | 'trend' | 'copy-trader' | 'llm-basic'

const TEMPLATE_LABEL: Record<ITemplate, string> = {
  base: 'Base',
  guarded: 'Guarded',
  trend: 'Trend',
  'copy-trader': 'Copy-trader',
  'llm-basic': 'LLM'
}
const TEMPLATE_DESC: Record<ITemplate, string> = {
  base: 'A connected operator with an empty strategy body to fill in yourself (src/index.ts).',
  guarded:
    'The reference risk-managed bot: swap one pure decide() and keep the guards (on-chain stop, drawdown halt, cost budget). Starts in dry-run.',
  trend: 'Deterministic EMA(12/26) + RSI trend-follower on ETH, one position at a time, with a cooldown.',
  'copy-trader':
    'Mirrors a chosen GMX trader’s ETH position, sized to your funds, with risk caps and a liquidation guard (set TRADER_ACCOUNT).',
  'llm-basic':
    'An LLM decides long / flat / close via structured tool use; your code enforces the risk caps (set ANTHROPIC_API_KEY).'
}

export interface I$HelloPage {
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<ISubaccountState | null>
  draftAllocateList: IStream<IAllocateDraft[]>
  draftRedeemList: IStream<IRedeemDraft[]>
  draftSwapList: IStream<ISwapDraft[]>
  embedded?: boolean
}

export const $HelloPage = ({
  walletQuery,
  walletState: rootState,
  draftAllocateList,
  draftRedeemList,
  draftSwapList,
  embedded = false
}: I$HelloPage) =>
  component(
    (
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<ISwapDraft>,
      [selectBaseToken, selectBaseTokenTether]: IBehavior<Hex>,
      [changeName, changeNameTether]: IBehavior<string>,
      [selectMode, selectModeTether]: IBehavior<INode, IMasterMode>,
      [selectTemplate, selectTemplateTether]: IBehavior<ITemplate>,
      [_connect, connectTether]: IBehavior<unknown>
    ) => {
      const walletState: IStream<IConnectedWallet | null> = op(walletQuery, switchPromises, state())
      const tokenRegistryValue = switchPromises(context.tokenRegistryQuery)
      const baseTokenId: IStream<Hex> = state(TOKEN_ID.USDC, selectBaseToken)
      const modeState: IStream<IMasterMode> = state('human', selectMode)

      const $subhead = (label: string): I$Node =>
        $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(label))

      interface ISectionParams {
        wallet: IConnectedWallet | null
        registry: ITokenRegistryMap
        baseTokenId: Hex
        root: ISubaccountState | null
      }

      // Typed name survives section rebuilds (base-token switch re-keys the section,
      // but the user's input is component state, not section state). null = untouched.
      const typedName: IStream<string | null> = state(null, changeName)

      const $createMasterStep: I$Node = switchLatest(
        map(
          (p: ISectionParams) => {
            if (!p.wallet)
              return $column(spacing.default, style({ alignItems: 'center', textAlign: 'center' }))(
                $subhead('Connect your wallet'),
                $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.6', maxWidth: '420px' }))(
                  $text('It secures a new smart wallet, recoverable any time. No seed phrase to manage.')
                ),
                $row(spacing.default, style({ justifyContent: 'center', width: '100%', flexWrap: 'wrap' }))(
                  $WalletConnect()({ connect: connectTether() })
                )
              )
            const wallet = p.wallet
            const signer: Address | null = wallet.session?.signer ?? p.root?.signer ?? null
            const homeTokens = p.registry.get(HUB_CHAIN_ID)
            // A fund's base token must be an ERC20: deposit routes, allocate sweeps and
            // redeem drains all move it with token transfers. Native (token 0) is a
            // holdable balance, not a base.
            const registeredIds = [...(homeTokens?.entries() ?? [])]
              .filter(([, info]) => info.token !== ADDRESS_ZERO)
              .map(([id]) => id)
            if (registeredIds.length === 0) return $callout('No tokens are registered yet. Check back shortly.')
            const effectiveBid = homeTokens?.has(p.baseTokenId) ? p.baseTokenId : registeredIds[0]!
            const $tokenSelector = $ButtonToggle({
              value: just(effectiveBid),
              optionList: registeredIds,
              $$option: map((id: Hex) => {
                const info = homeTokens?.get(id)
                return $node(info ? $tokenLabelFromSummary(getTokenDescription(info.token)) : $text(id))
              })
            })({ select: selectBaseTokenTether() })
            const $baseTokenField = $defaultTextFieldContainer(
              $row(spacing.small, style({ width: '100%' }))(
                $labelDisplay(style({ width: '92px' }))($text('Base token')),
                $node(style({ flex: '1' }))($tokenSelector)
              ),
              $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
                $text('The currency your fund holds and settles in, pick the one your traders use.')
              )
            )

            const $signSession = $EnableSession(wallet)({})

            if (signer === null) {
              return $column(spacing.big)(
                $column(spacing.big)(
                  $baseTokenField,
                  $column(
                    spacing.small,
                    style({ width: '100%', alignItems: 'flex-start', color: palette.foreground })
                  )(
                    $row(spacing.small, style({ width: '100%', alignItems: 'center' }))(
                      $labelDisplay(style({ width: '92px' }))($text('Session')),
                      $signSession
                    ),
                    $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
                      $text('Sign a session to preview and create your fund.')
                    )
                  )
                )
              )
            }

            const fundParams: IAccountLib__AccountInitParams = { user: wallet.address, signer }
            const fundMaster = predictPuppetAccount(fundParams)
            const fundStub: ISubaccountState = {
              ...stubSubaccountState(fundParams),
              account: predictFundAccount(fundMaster),
              signer: fundMaster,
              isFund: true
            }
            // An empty name resolves to the EXISTING fund for this base token when one
            // exists (the card shows it, no fresh preview); only without one does it
            // generate the token-scoped default, so a token switch regenerates name and
            // avatar together.
            const existingFund = p.root?.funds.find(
              f => f.baseTokenId === effectiveBid && getAddress(f.master as Address) === fundMaster
            )
            const defaultName =
              readableAccountName(existingFund?.name as Hex | undefined) ??
              roboAvatarName(predictShareToken(fundMaster, effectiveBid, BYTES32_ZERO))
            const fundName: IStream<string> = map(n => (n?.trim() ? n : defaultName), typedName)
            const $nameField = $FieldLabeled({
              label: 'Name',
              labelWidth: 92,
              hint: 'Shown to backers on the leaderboard and your profile. Leave blank to keep the generated name.',
              placeholder: defaultName,
              maxLength: 32,
              value: map(n => n ?? '', typedName)
            })({
              change: changeNameTether()
            })

            // FA lens off the root: the fund-shaped state derives from the PA (account =
            // predicted FA, signer = PA), carrying the root's funds/positions.
            const account: IStream<ISubaccountState> = op(
              rootState,
              map(root =>
                root
                  ? {
                      ...fundStub,
                      funds: root.funds,
                      positions: root.positions,
                      chains: root.chains,
                      lastTransactionHash: root.lastTransactionHash
                    }
                  : fundStub
              )
            )
            const $accountSection = $FundEditor({
              account,
              walletAccount: wallet,
              tokenRegistry: p.registry,
              initialBaseTokenId: just(effectiveBid),
              fundName,
              draft: map(list => list.find(d => d.account === fundStub.account) ?? null, draftAllocateList),
              redeemDraft: map(list => list.find(d => d.masterAccount === fundStub.account) ?? null, draftRedeemList),
              swapDraftList: draftSwapList,
              $stubAnchor: ($aumDisplay, $depositButton, $withdrawButton) =>
                $row(spacing.big, style({ alignItems: 'center', width: '100%' }))(
                  $column(
                    spacing.small,
                    style({ alignItems: 'flex-start', minWidth: '0' })
                  )(
                    switchLatest(
                      map(
                        name =>
                          $fundProfile(
                            {
                              master: fundMaster,
                              baseTokenId: effectiveBid,
                              name: accountNameToHex(name.trim() || defaultName)
                            },
                            48
                          ),
                        fundName
                      )
                    )
                  ),
                  $row(spacing.small, style({ alignItems: 'center', justifyContent: 'flex-end', flex: '1' }))(
                    $column(spacing.small, style({ alignItems: 'flex-end' }))($depositButton, $withdrawButton),
                    $column(style({ gap: '2px', alignItems: 'flex-end' }))(
                      $node(style({ color: palette.foreground, fontSize: text.xs }))($text('AUM')),
                      $aumDisplay
                    )
                  )
                )
            })({
              changeDraft: changeMasterDraftTether(),
              changeRedeemDraft: changeRedeemDraftTether(),
              changeFulfillDraft: changeFulfillDraftTether(),
              changeSwapDraft: changeSwapDraftTether()
            })

            return $column(spacing.big)(
              $column(spacing.big)(
                $baseTokenField,
                $nameField,
                $column(spacing.small, style({ width: '100%', maxWidth: '520px', alignSelf: 'center' }))(
                  $node(style({ color: palette.foreground, fontSize: text.xs, alignSelf: 'center' }))(
                    $text('Your fund is your public identity')
                  ),
                  $card2(
                    style({
                      borderRadius: '30px',
                      padding: '20px 24px',
                      border: `1px solid ${colorShade(palette.foreground, 25)}`
                    })
                  )($accountSection)
                )
              )
            )
          },
          // Identity-keyed rebuild: wallet/root re-emissions (attest folds, wagmi events)
          // must NOT remount the section, or an open allocate popover gets torn down.
          // Live values inside read their own streams; only these change the layout.
          skipRepeatsWith<ISectionParams>(
            (a, b) =>
              a.wallet?.address === b.wallet?.address &&
              a.wallet?.session?.signer === b.wallet?.session?.signer &&
              a.registry === b.registry &&
              a.baseTokenId === b.baseTokenId &&
              !!a.root === !!b.root &&
              a.root?.signer === b.root?.signer,
            combine({ wallet: walletState, registry: tokenRegistryValue, baseTokenId, root: rootState })
          )
        )
      )

      const $choiceCard = (
        mode: IMasterMode,
        $iconNode: I$Node,
        kicker: string,
        title: string,
        desc: string,
        accent: string
      ): I$Node =>
        $column(
          spacing.small,
          style({
            flex: '1',
            minWidth: '240px',
            padding: '18px',
            borderRadius: '12px',
            backgroundColor: colorShade(palette.foreground, 6),
            cursor: 'pointer',
            border: `1px solid ${colorShade(palette.foreground, 18)}`,
            transition: 'border-color 120ms ease-out, transform 120ms ease-out'
          }),
          stylePseudo(':hover', {
            borderColor: colorShade(palette.foreground, 45),
            transform: 'translateY(-2px)'
          }),
          styleBehavior(map(m => (m === mode ? { borderColor: accent } : {}), modeState)),
          selectModeTether(nodeEvent('click'), constant(mode))
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

      // Template picker for the agent path: the four templates are alternatives (you scaffold one), so
      // pick one and its description + command render in a single terminal below.
      const templateState: IStream<ITemplate> = state('base', selectTemplate)
      const $templatePicker: I$Node = $ButtonToggle({
        value: templateState,
        optionList: ['base', 'guarded', 'trend', 'copy-trader', 'llm-basic'] satisfies ITemplate[],
        $$option: map((t: ITemplate) =>
          $node(style({ fontWeight: '600', color: palette.message, whiteSpace: 'nowrap', padding: '2px 4px' }))(
            $text(TEMPLATE_LABEL[t])
          )
        )
      })({ select: selectTemplateTether() })

      const $chooser: I$Node = $row(spacing.default, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
        $choiceCard(
          'human',
          $puppeteer,
          'Trade by hand',
          'You place the trades',
          'Place trades on GMX and across DeFi by linking your fund over WalletConnect. Every settled trade builds your public record.',
          palette.positive
        ),
        $choiceCard(
          'agent',
          $smartContract,
          'Run an agent',
          'A bot places the trades',
          'Scaffold a bot that opens and maintains positions within the rules you signed. You fund and redeem here.',
          palette.primary
        )
      )

      // Setup comes first (fund creation inputs, then the wallet card); the path choice
      // follows as step 2 so it reads as part of the same flow, not an orthogonal pick.

      const $separator = (): I$Node =>
        $node(
          style({ height: '1px', width: '100%', backgroundColor: colorShade(palette.foreground, 14), margin: '4px 0' })
        )()

      const $flow: I$Node = switchLatest(
        map(mode => {
          return $column(spacing.big)(
            $separator(),
            $column(spacing.default)(
              $stageHeader(3, mode === 'agent' ? 'Spin up your agent' : 'Trade'),
              mode === 'agent' ? $spinUpStep(templateState, $templatePicker) : $tradeStep({ walletState })
            ),
            $separator(),
            $column(spacing.default)(
              $stageHeader(4, 'From here'),
              mode === 'agent' ? $agentNextStep() : $humanNextStep()
            )
          )
        }, modeState)
      )

      const $card1 = $card(spacing.big, style({ width: '100%', padding: isDesktopScreen ? '32px' : '16px' }))(
        $stageHeader(1, 'Create your fund'),
        $createMasterStep,
        $separator(),
        $stageHeader(2, 'Choose your style'),
        $chooser,
        $flow
      )
      return [
        embedded
          ? $column(spacing.big, style({ width: '100%' }))($card1)
          : $column(spacing.big, style({ maxWidth: '860px', margin: '0 auto', padding: '32px 24px' }))($hero(), $card1),
        {
          changeAllocateDraft: changeMasterDraft,
          changeRedeemDraft,
          changeFulfillDraft,
          changeSwapDraft
        }
      ]
    }
  )

const $hero = (): I$Node =>
  $column(spacing.default, style({ paddingBottom: '12px' }))(
    $heading1($text('Trade exactly as you do today, and earn more.')),
    $node(style({ fontSize: text.lg, lineHeight: '1.5', color: palette.message }))(
      $text(
        'Backer capital rides your trades and pays you performance fees. You keep your keys, and every action runs under rules you sign.'
      )
    )
  )

const $EnableSession = (wallet: IConnectedWallet) =>
  component(([popSession, popSessionTether]: IBehavior<PointerEvent>) => [
    $Popover({
      $container: $node(style({ display: 'flex' })),
      $open: map(
        () =>
          $column(spacing.default, style({ maxWidth: '320px' }))(
            ...$enableSessionDisclaimer(),
            $defaultButtonPrimary(
              style({ alignSelf: 'flex-end', minHeight: '40px' }),
              effectProp(
                'onclick',
                nowWith(() => () => {
                  bindSession(wallet)
                    .then(() => refreshWallet())
                    .catch(e => console.error('create session failed', e))
                })
              )
            )($text('Enable session'))
          ),
        popSession
      ),
      dismiss: empty,
      $target: $ButtonSecondary({
        $container: $defaultButtonSecondary(style({ flexShrink: '0', alignSelf: 'center' })),
        $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Sign session'), $popoverCaret())
      })({ click: popSessionTether() })
    })({}),
    {}
  ])

const $tradeExplain = (title: string, body: string): I$Node =>
  $column(spacing.small, style({ flex: '1', minWidth: '220px' }))(
    $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(title)),
    $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text(body))
  )

const $tradeRow = ($explain: I$Node, $action: I$Node): I$Node =>
  $row(spacing.big, style({ alignItems: 'center', flexWrap: 'wrap', width: '100%' }))(
    $explain,
    $node(style({ flexShrink: '0' }))($action)
  )

const $installWindow: I$Node = $mockWindow(
  $column(
    style({
      aspectRatio: '1',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      padding: '16px',
      cursor: 'pointer',
      backgroundColor: colorShade(palette.foreground, 4)
    }),
    stylePseudo(':hover', { backgroundColor: colorShade(palette.foreground, 10) }),
    effectProp(
      'onclick',
      nowWith(() => () => {
        void promptInstallApp()
      })
    )
  )(
    $node(style({ fontSize: text.xs, fontWeight: '600', color: palette.foreground, textAlign: 'center' }))(
      $text('Add to your apps')
    ),
    $row(
      style({
        width: '88px',
        height: '88px',
        borderRadius: '20px',
        backgroundColor: palette.primary,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '#00000040 0px 6px 16px 0px'
      })
    )($icon({ $content: $puppetLogo, width: '52px', viewBox: '0 0 32 32', fill: '#ffffff' }))
  ),
  $defaultMockWindow(style({ width: '160px', border: `1px solid ${colorShade(palette.foreground, 20)}` }))
)

const $tradeStep = ({ walletState }: { walletState: IStream<IConnectedWallet | null> }): I$Node =>
  $column(spacing.big)(
    $body('Link this fund to GMX (or any dApp) over WalletConnect.'),
    $callout(
      'Your session key allows any operation on approved venues within the rules you set, but it can never move funds out of your fund.'
    ),
    // App-install is offered only when a one-click install is available; this is false both
    // when already installed and on browsers that can't prompt, so the section stays hidden.
    switchLatest(
      map(
        can =>
          can
            ? $column(spacing.big)(
                $tradeRow(
                  $tradeExplain(
                    'Install the app (optional)',
                    'Add Puppet to your apps so the connection keeps working in the background, even when this tab is not focused. Recommended for hands-on trading.'
                  ),
                  $installWindow
                ),
                $node(style({ height: '1px', backgroundColor: colorShade(palette.foreground, 14) }))()
              )
            : empty,
        canInstallApp
      )
    ),
    $tradeRow(
      $tradeExplain(
        'Link a dApp',
        'On the dApp choose WalletConnect, copy its connection link, then open this panel to paste it. Every trade executes under the rules you signed.'
      ),
      $WalletLink({ walletState, size: 56 })({})
    )
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
      $linkButton('Leaderboard', '/leaderboard', true),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )

const $step = (n: number, label: string | I$Node, $extra?: I$Node): I$Node =>
  $column(spacing.small)(
    $row(spacing.small, style({ alignItems: 'baseline' }))(
      $node(style({ color: palette.primary, fontWeight: '700', fontSize: text.sm, minWidth: '18px' }))($text(`${n}.`)),
      $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.6', flex: 1 }))(
        typeof label === 'string' ? $text(label) : label
      )
    ),
    ...(($extra ? [$extra] : []) as I$Node[])
  )

const $spinUpStep = (templateState: IStream<ITemplate>, $picker: I$Node): I$Node =>
  $column(spacing.default)(
    $body(
      'The agent trades the base token of the fund you create above, any registered token works. A non-WETH base (USDC or ETH) also needs a little ETH in the fund to cover GMX execution fees; WETH is simplest because the keeper fee comes straight out of the collateral.'
    ),
    $step(
      1,
      'Install Bun (the templates run on Bun):',
      $column(spacing.small)(
        $terminal(['curl -fsSL https://bun.com/install | bash'], 'install bun'),
        $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
          $text('or get it from '),
          $anchor(attr({ href: 'https://bun.com', target: '_blank' }), style({ textDecoration: 'underline' }))(
            $text('bun.com')
          )
        )
      )
    ),
    $step(
      2,
      'Pick a template and scaffold it on your machine:',
      $column(spacing.default)(
        $picker,
        switchLatest(
          map((t: ITemplate) => {
            const env =
              t === 'llm-basic'
                ? ['cp .env.example .env   # set ANTHROPIC_API_KEY']
                : t === 'copy-trader'
                  ? ['cp .env.example .env   # set TRADER_ACCOUNT']
                  : t === 'guarded'
                    ? ['cp .env.example .env   # dry-run is the default; DRY_RUN=0 goes live']
                    : []
            return $column(spacing.default)(
              $terminal([`bunx @puppet.fund/templates my-operator gmx ${t}`], TEMPLATE_DESC[t]),
              $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text('Then:')),
              $terminal(['cd my-operator', 'bun install', ...env, 'bun run dev'])
            )
          }, templateState)
        ),
        $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
          $text('The scaffolder only writes files locally, no keys, no network, and it is fully open source.')
        ),
        $row(spacing.default)(
          $linkButton('Read the source on GitHub', `${GITHUB_REPO_URL}/tree/main/operator/templates`, false)
        )
      )
    ),
    $step(3, 'It prints a pair link. Open that link here, on this site.'),
    $step(4, 'Click “Send session to agent” in the banner at the top.'),
    $step(
      5,
      $node(style({ display: 'inline' }))(
        $text('Done. The agent opens and maintains positions; you fund and redeem '),
        $Link({
          route: routeSchema.portfolio,
          $content: $text('here'),
          $anchor: $defaultAnchor(style({ textDecoration: 'underline' }))
        })({}),
        $text('.')
      )
    ),
    $callout(
      'Shape the strategy in src/index.ts. The agent only acts within the rules you signed, and it can never move funds out of your account.'
    )
  )

const $agentNextStep = (): I$Node =>
  $column(spacing.default)(
    $body(
      'A funded fund, an agent trading within the rules you signed, every action co-signed by the protocol. From here, performance is the work.'
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
      $linkButton('Leaderboard', '/leaderboard', true),
      $linkButton('Agent guide', OPERATOR_GUIDE_URL, false),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )
