import { CHAIN_IDS, HUB_CHAIN_ID } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { getTokenDescription, readableTokenAmountLabel } from '@puppet/sdk/core'
import { VALUE_KEY } from '@puppet/sdk/evaluate'
import { minFundedAmount } from '@puppet/sdk/mpc'
import type { IFundRow } from '@puppet/sdk/schema'
import { chainTokenOfKey, type ITokenRegistryMap } from '@puppet/sdk/state'
import { combine, constant, empty, type IStream, just, map, merge, nowWith, op, sampleMap, switchLatest, switchMap } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectProp, type I$Node, type INode, nodeEvent, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $intermediatePromise, $Popover, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Hex, isAddressEqual } from 'viem'
import {
  $amountDisplay,
  $anchor,
  $ButtonPrimary,
  $ButtonToggle,
  $defaultMiniButtonPrimary,
  $icon,
  $infoTooltip,
  $popoverCaret,
  $puppeteer,
  $smartContract,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { $tokenProfile } from '../common/$common.js'
import { chainFor } from '../common/$contract.js'
import { $puppetLogo } from '../common/$icons.js'
import { $card, $card2, $defaultMockWindow, $mockWindow } from '../common/elements/$common.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $WalletLink } from '../components/$WalletLink.js'
import { $AllocationSimulation } from '../components/portfolio/$AllocationSimulation.js'
import { $DepositEditor } from '../components/portfolio/$DepositEditor.js'
import { $EscrowedRow } from '../components/portfolio/$EscrowedRow.js'
import { $FundIdentityEditor, type IFundIdentity } from '../components/portfolio/$FundIdentityEditor.js'
import { depositArrivalToken, type IAllocateDraft, type IArrival, type IDepositDraft, type ITradeDraft } from '../components/portfolio/draft.js'
import { $editorPopoverContentContainer } from '../components/portfolio/editorUtils.js'
import { DOCS_URL, GITHUB_REPO_URL, OPERATOR_GUIDE_URL } from '../const/links.js'
import context from '../io/context.js'
import { escrowSurplus } from '../io/datastore/own.js'
import type { IOwnState } from '../io/journal/localFold.js'
import { formatUsd, priceFor } from '../io/price.js'
import { canInstallApp, promptInstallApp } from '../utils/pwaInstall.js'
import type { IConnectedWallet, IFund, IRootState, IWalletKeys, IWalletPair } from '../wallet/index.js'
import { balanceAt } from '../wallet/root.js'
import { $body, $bulletList, $callout, $linkButton, $stageHeader, $terminal } from './$onboarding.js'

const fundValueToken = getTokenDescription(HUB_CHAIN_ID, chainTokenOfKey(HUB_CHAIN_ID, VALUE_KEY))

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
  base: 'A connected agent with an empty strategy body to fill in yourself (src/index.ts).',
  guarded: 'The reference risk-managed bot: swap one pure decide() and keep the guards (on-chain stop, drawdown halt, cost budget). Starts in dry-run.',
  trend: 'Deterministic EMA(12/26) + RSI trend-follower on ETH, one position at a time, with a cooldown.',
  'copy-trader': 'Mirrors a chosen GMX trader’s ETH position, sized to your trading account, with risk caps and a liquidation guard (set TRADER_ACCOUNT).',
  'llm-basic': 'An LLM decides long / flat / close via structured tool use; your code enforces the risk caps (set ANTHROPIC_API_KEY).'
}

interface ISectionParams {
  wallet: IConnectedWallet | null
  root: IRootState | null
  registry: ITokenRegistryMap
  fundRow: IFundRow | undefined
  surplus: ReturnType<typeof escrowSurplus>
  fund: IFund | null
  keys: IWalletKeys | null
}

export interface I$HelloPage {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  draftDepositList: IStream<IDepositDraft[]>
}

export const $HelloPage = ({ hideBalances, walletPair, ownStateQuery, draftDepositList }: I$HelloPage) =>
  component(
    (
      [changeIdentity, changeIdentityTether]: IBehavior<IFundIdentity>,
      [selectMode, selectModeTether]: IBehavior<INode, IMasterMode>,
      [selectTemplate, selectTemplateTether]: IBehavior<ITemplate>,
      [popAllocate, popAllocateTether]: IBehavior<PointerEvent>,
      [fundRound, fundRoundTether]: IBehavior<IDepositDraft>,
      [arrival, arrivalTether]: IBehavior<IArrival>,
      [roundBackers, roundBackersTether]: IBehavior<bigint | null>,
      [fundEscrowed, fundEscrowedTether]: IBehavior<IAllocateDraft>
    ) => {
      const modeState: IStream<IMasterMode> = state('human' as IMasterMode, selectMode)
      const identity: IStream<IFundIdentity | null> = state(null, changeIdentity)

      const query: IStream<Promise<ISectionParams>> = op(
        combine({ pair: walletPair, own: ownStateQuery }),
        map(async q => {
          const [root, registry, own] = await Promise.all([q.pair.root, context.getTokenRegistry(), q.own])
          return {
            wallet: q.pair.wallet,
            root,
            registry,
            fundRow:
              root === null || root.fund === null || own === null
                ? undefined
                : own.fundRows.find(row => isAddressEqual(row.master, root.fund!.account)),
            surplus: root === null || root.fund === null || own === null ? [] : escrowSurplus(own, root.fund.account),
            fund: root === null ? null : root.fund,
            keys: q.pair.keys
          }
        }),
        state()
      )

      const $stubIdentity = (hint: string): I$Node =>
        $column(spacing.small, style({ width: '100%', maxWidth: '520px', alignSelf: 'center' }))(
          $node(style({ color: palette.foreground, fontSize: text.xs, alignSelf: 'center' }))($text('Your trading account is your public identity')),
          $card2(style({ borderRadius: '30px', padding: '12px 24px', border: `1px solid ${colorShade(palette.foreground, 25)}` }))(
            $row(spacing.default, style({ alignItems: 'center', justifyContent: 'space-between', width: '100%' }))(
              $node(style({ opacity: '0.6' }))(
                $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                  $node(
                    style({
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      flexShrink: '0',
                      backgroundColor: colorShade(palette.foreground, 15),
                      border: `1px dashed ${colorShade(palette.foreground, 40)}`
                    })
                  )(),
                  $node(style({ fontWeight: '600', fontSize: text.lg, color: palette.foreground }))($text('Your trading account'))
                )
              ),
              $node(style({ color: palette.indeterminate, fontSize: text.xs, textAlign: 'right', flexShrink: '0' }))($text(hint))
            )
          )
        )

      const openingRound: IStream<IDepositDraft> = sampleMap(
        (held, draft: IDepositDraft) => (held === null ? draft : { ...draft, identity: held }),
        identity,
        fundRound
      )

      const openingRoundTrade: IStream<ITradeDraft> = map(
        (round): ITradeDraft => ({
          kind: 'allocate',
          id: 'allocate',
          escrowChainId: Number(round.deposit.destinationChainId) as ChainId,
          escrowToken: round.deposit.outputToken,
          contribution: round.expectedOutput,
          backers: 0n,
          identity: round.identity ?? null
        }),
        openingRound
      )

      const savedRound: IStream<IDepositDraft | null> = state(null, openingRound)

      const $allocateSection = (root: IRootState, p: ISectionParams, wallet: IConnectedWallet): I$Node =>
        $column(spacing.default, style({ width: '100%', maxWidth: '460px' }))(
          $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('Fund your first round')),
          $row(spacing.small, style({ alignItems: 'center' }))(
            $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
              $text('Move any registered token into your fund. The hub mints units for you and the backers who join.')
            ),
            $infoTooltip(
              `Your deposit can start as any registered token on any supported chain. It is escrowed for your fund as the token and on the chain you pick; the round on ${chainFor(HUB_CHAIN_ID).name} credits it at the value you sign and mints your units.`
            )
          ),
          p.surplus.length === 0
            ? empty
            : $column(spacing.tiny, style({ width: '100%' }))(
                $row(spacing.small, style({ alignItems: 'center' }))(
                  $node(style({ fontSize: text.xs, color: palette.indeterminate }))($text('In escrow for your fund, not in a round yet')),
                  $infoTooltip(
                    'Escrow has one way out: the round that credits it into your fund. Fund a round to credit what is already there; nothing more leaves your wallet.'
                  )
                ),
                ...p.surplus.map(row => $EscrowedRow({ hideBalances, ...row })({ fundRound: fundEscrowedTether() }))
              ),
          $Popover({
            $contentContainer: $editorPopoverContentContainer,
            $target: $ButtonPrimary({
              $container: $defaultMiniButtonPrimary(style({ alignSelf: 'flex-start' })),
              $content: $row(spacing.tiny, style({ alignItems: 'center' }))($text('Allocate'), $popoverCaret())
            })({ click: popAllocateTether() }),
            $open: map(() => {
              if (root.unreachable.has(HUB_CHAIN_ID as ChainId)) {
                return $node(style({ fontSize: text.xs, color: palette.negative, lineHeight: '1.5' }))(
                  $text(`${chainFor(HUB_CHAIN_ID).name} could not be probed for your account; retry once it answers.`)
                )
              }
              const fund = p.fundRow === undefined ? null : p.fund
              return $DepositEditor({
                label: 'Allocate',
                ...(fund === null
                  ? {}
                  : {
                      $note: $AllocationSimulation({
                        master: fund.account,
                        hideBalances,
                        arrival
                      })({ backers: roundBackersTether() }),
                      gate: map(backers => backers !== null, roundBackers)
                    }),
                hideBalances,
                tokenRegistry: p.registry,
                walletAccount: wallet,
                destination: {
                  choose: ([...CHAIN_IDS] as ChainId[]).flatMap(chainId =>
                    [...(p.registry.get(chainId)?.keys() ?? [])].map(token => ({ chainId, token: token as Hex }))
                  ),
                  scope: 'allocate'
                },
                ...(fund === null ? { stakeFloor: minFundedAmount } : {}),
                existingDraft: map(list => list.find(d => d.id === 'deposit') ?? null, draftDepositList)
              })({ changeDraft: fundRoundTether(), arrival: arrivalTether() })
            }, popAllocate),
            dismiss: fundRound
          })({}),
          switchMap(d => {
            if (d === null) {
              return $row(spacing.default, style({ alignItems: 'center' }))(
                $row(spacing.small, style({ alignItems: 'center', minWidth: '0' }))(
                  $node(
                    style({
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: palette.horizon,
                      color: palette.foreground,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: text.base,
                      fontWeight: '600',
                      flexShrink: '0'
                    })
                  )($text('?')),
                  $node(style({ fontWeight: '600', fontSize: text.base, color: palette.foreground }))($text('---'))
                ),
                $node(style({ flex: 1 }))(),
                $amountDisplay({ hideBalances, usd: just(formatUsd(0n, 0n)), amount: '0.0', align: 'flex-end' })
              )
            }
            const chainId = Number(d.deposit.destinationChainId) as ChainId
            const token = depositArrivalToken(d)
            const description = getTokenDescription(chainId, token)
            const before = balanceAt(root.balances, chainId, token)
            const price = priceFor(chainId, token)
            const $staged = $row(spacing.default, style({ alignItems: 'center' }))(
              $tokenProfile(chainId, token, 32, chainId !== HUB_CHAIN_ID),
              $node(style({ flex: 1 }))(),
              $amountDisplay({
                hideBalances,
                usd: map(v => formatUsd(before, v), price),
                amount: readableTokenAmountLabel(description, before),
                change: map(
                  v => ({
                    usd: formatUsd(before + d.expectedOutput, v),
                    amount: readableTokenAmountLabel(description, before + d.expectedOutput)
                  }),
                  price
                ),
                color: just(palette.positive),
                align: 'flex-end'
              })
            )
            return $staged
          }, savedRound)
        )

      const $createStep: I$Node = $intermediatePromise({
        $display: map(async (q: Promise<ISectionParams>) => {
          const p = await q
          if (!p.wallet) {
            return $column(spacing.big)(
              $stubIdentity('Connect a wallet to see your trading account'),
              $column(spacing.default, style({ alignItems: 'center', textAlign: 'center' }))(
                $node(style({ fontSize: text.base, color: palette.message }))($text('Connect your wallet')),
                $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.4', maxWidth: '420px' }))(
                  $text('Your account derives from your address on every chain. Nothing to deploy, no seed phrase to manage.')
                ),
                $row(spacing.default, style({ justifyContent: 'center', width: '100%', flexWrap: 'wrap' }))($WalletConnect()({}))
              )
            )
          }
          const wallet = p.wallet
          if (p.root === null) return $column(spacing.big)($stubIdentity('Reading your account'))
          const root = p.root
          return $column(spacing.big, style({ alignItems: 'center' }))(
            $FundIdentityEditor(p.fund)({ changeIdentity: changeIdentityTether() }),
            p.fundRow === undefined
              ? empty
              : $column(spacing.small, style({ width: '100%', maxWidth: '460px' }))(
                  $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Your fund')),
                  $node(style({ color: palette.foreground, fontSize: text.sm }))(
                    $text(`${readableTokenAmountLabel(fundValueToken, p.fundRow.value)} at the last valuation`)
                  ),
                  $Link({
                    route: routeSchema.portfolio,
                    $content: $text('Manage in your portfolio'),
                    $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' }))
                  })({})
                ),
            $allocateSection(root, p, wallet)
          )
        }, query)
      })

      const $choiceCard = (mode: IMasterMode, $iconNode: I$Node, kicker: string, title: string, desc: string, accent: string): I$Node =>
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
          stylePseudo(':hover', { borderColor: colorShade(palette.foreground, 45), transform: 'translateY(-2px)' }),
          styleBehavior(map(m => (m === mode ? { borderColor: accent } : {}), modeState)),
          selectModeTether(nodeEvent('click'), constant(mode))
        )(
          $row(spacing.default, style({ alignItems: 'center' }))(
            $icon({ $content: $iconNode, width: '40px', fill: accent, viewBox: '0 0 32 32' }),
            $column(spacing.tiny, style({ flex: '1', minWidth: '0' }))(
              $node(style({ fontSize: text.xs, color: palette.foreground, textTransform: 'uppercase', letterSpacing: '0.08em' }))($text(kicker)),
              $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(title))
            ),
            $node(style({ color: accent, fontSize: text.lg, fontWeight: '600' }))($text('→'))
          ),
          $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.6' }))($text(desc))
        )

      const templateState: IStream<ITemplate> = state('base' as ITemplate, selectTemplate)
      const $templatePicker: I$Node = $ButtonToggle({
        value: templateState,
        optionList: ['base', 'guarded', 'trend', 'copy-trader', 'llm-basic'] satisfies ITemplate[],
        $$option: map((t: ITemplate) => $node(style({ fontWeight: '600', color: palette.message, whiteSpace: 'nowrap', padding: '2px 4px' }))($text(TEMPLATE_LABEL[t])))
      })({ select: selectTemplateTether() })

      const $chooser: I$Node = $row(spacing.default, style({ flexWrap: 'wrap', alignItems: 'stretch' }))(
        $choiceCard(
          'human',
          $puppeteer,
          'Trade by hand',
          'You place the trades',
          'Place trades on GMX by linking your trading account over WalletConnect. Every valuation of your fund builds your public record.',
          palette.positive
        ),
        $choiceCard(
          'agent',
          $smartContract,
          'Run an agent',
          'A bot places the trades',
          'Scaffold a bot that opens and maintains positions within the rules you signed. You deposit and redeem here.',
          palette.primary
        )
      )

      const $separator = (): I$Node => $node(style({ height: '48px', width: '100%' }))()

      const $flow: I$Node = switchLatest(
        map(
          mode =>
            $column(spacing.big)(
              $separator(),
              $column(spacing.default)(
                $stageHeader(3, mode === 'agent' ? 'Spin up your agent' : 'Trade'),
                mode === 'agent' ? $spinUpStep(templateState, $templatePicker) : $tradeStep(walletPair)
              ),
              $separator(),
              $column(spacing.default)($stageHeader(4, 'From here'), mode === 'agent' ? $agentNextStep() : $humanNextStep())
            ),
          modeState
        )
      )

      const $card1 = $card(spacing.big, style({ width: '100%', padding: isDesktopScreen ? '62px' : '16px' }))(
        $stageHeader(1, 'Create your fund'),
        $createStep,
        $separator(),
        $stageHeader(2, 'Choose your style'),
        $chooser,
        $flow
      )
      return [
        $column(spacing.big, style({ width: '100%' }))($card1),
        {
          changeDraft: openingRound,
          changeTradeDraft: merge(openingRoundTrade, fundEscrowed)
        }
      ]
    }
  )

const $tradeExplain = (title: string, body: string): I$Node =>
  $column(spacing.small, style({ flex: '1', minWidth: '220px' }))(
    $node(style({ fontSize: text.base, color: palette.message }))($text(title)),
    $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.4' }))($text(body))
  )

const $tradeRow = ($explain: I$Node, $action: I$Node): I$Node =>
  $row(spacing.big, style({ alignItems: 'center', flexWrap: 'wrap', width: '100%' }))($explain, $node(style({ flexShrink: '0' }))($action))

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
    $node(style({ fontSize: text.xs, fontWeight: '600', color: palette.foreground, textAlign: 'center' }))($text('Add to your apps')),
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

const $tradeStep = (walletPair: IStream<IWalletPair>): I$Node =>
  $column(spacing.big)(
    $body('Link your trading account to GMX over WalletConnect and trade there exactly as you do today.'),
    $callout(
      'Your trading account can operate on approved venues within the rules you signed. It can never withdraw to anyone else: value only ever leaves it to your own wallet.'
    ),
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
        'Link GMX',
        'On app.gmx.io choose WalletConnect, copy its connection link, then open this panel to paste it. Every order is attested before it signs.'
      ),
      $WalletLink({ walletPair, size: 56 })({})
    )
  )

const $humanNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('A funded trading account and a record that grows with every valuation. From here, performance is the work.'),
    $bulletList([
      ['Fund your first round', 'Allocate moves your deposit into your fund; the hub values the fund and mints units for you and the backers who join.'],
      ['Build a track record', 'Each valuation adds to a public history tied to this account. The chain is the proof.'],
      ['Attract outside capital', 'Once your record stands out, backers sign mandates naming your account, and their deposits join the rounds you fund alongside your own.']
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))($linkButton('Traders', '/traders', true), $linkButton('Protocol docs', DOCS_URL, false))
  )

const $step = (n: number, label: string | I$Node, $extra?: I$Node): I$Node =>
  $column(spacing.small)(
    $row(spacing.small, style({ alignItems: 'baseline' }))(
      $node(style({ color: palette.primary, fontWeight: '700', fontSize: text.sm, minWidth: '18px' }))($text(`${n}.`)),
      $node(style({ color: palette.message, fontSize: text.sm, lineHeight: '1.6', flex: 1 }))(typeof label === 'string' ? $text(label) : label)
    ),
    ...(($extra ? [$extra] : []) as I$Node[])
  )

const $spinUpStep = (templateState: IStream<ITemplate>, $picker: I$Node): I$Node =>
  $column(spacing.big)(
    $body(
      'The agent trades what your fund holds, so fund a round into it first; any registered token works. GMX execution fees are paid in native, so keep a little ETH in the fund alongside.'
    ),
    $column(
      spacing.default,
      style({
        padding: isDesktopScreen ? '18px 22px' : '14px 16px',
        borderRadius: '14px',
        backgroundColor: colorShade(palette.foreground, 6),
        border: `1px solid ${colorShade(palette.foreground, 13)}`
      })
    )(
      $node(style({ fontSize: text.sm, fontWeight: '600', color: palette.message }))($text('Before you run it')),
      $bulletList([
        [
          'It can’t take your funds',
          'the agent opens and manages positions within the rules you signed; value only ever leaves to your own account, never to the trader, the agent, or us.'
        ],
        [
          'Your key stays on your machine',
          'pairing hands the agent your half of the account key, kept in memory and never written to disk; the other half stays with the attestor, and neither half can sign alone.'
        ],
        ['You stay in control', 'every action is co-signed on-chain against your rules or it never executes, and you can stop the agent any time with Ctrl-C.']
      ])
    ),
    $column(spacing.big)(
      $step(
        1,
        'Install Bun (the templates run on Bun):',
        $column(spacing.small)(
          $terminal(['curl -fsSL https://bun.com/install | bash'], 'install bun'),
          $node(style({ fontSize: text.xs, color: palette.foreground, lineHeight: '1.5' }))(
            $text('or get it from '),
            $anchor(attr({ href: 'https://bun.com', target: '_blank' }), style({ textDecoration: 'underline' }))($text('bun.com'))
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
          $row(spacing.default)($linkButton('Read the source on GitHub', `${GITHUB_REPO_URL}/tree/main/operator/templates`, false))
        )
      ),
      $step(3, 'It prints a pair link. Open that link here, on this site.'),
      $step(4, 'Click “Send session to agent” in the banner at the top.'),
      $step(
        5,
        $node(style({ display: 'inline' }))(
          $text('Done. The agent opens and maintains positions; you allocate and redeem '),
          $Link({ route: routeSchema.portfolio, $content: $text('here'), $anchor: $defaultAnchor(style({ textDecoration: 'underline' })) })({}),
          $text('.')
        )
      )
    ),
    $callout(
      'Shape the strategy in src/index.ts. No matter what you write there, the agent stays bound by the rules you signed: it can never send value anywhere but your own account.'
    )
  )

const $agentNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('A live account, an agent trading within the rules you signed, and every action checked by the protocol before it executes. From here, performance is the work.'),
    $bulletList([
      ['Watch your first trade land', 'Every action lands on-chain the moment your strategy executes; the hub values your fund and mints your backers their units.'],
      ['Build a track record', 'Each valuation adds to a public history tied to this account. The chain is the proof.'],
      ['Attract outside capital', 'Once your record stands out, backers sign mandates naming your account, and their stakes back your strategy alongside your own.']
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))(
      $linkButton('Traders', '/traders', true),
      $linkButton('Agent guide', OPERATOR_GUIDE_URL, false),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )
