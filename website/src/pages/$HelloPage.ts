import { CHAIN_IDS, PROTOCOL } from '@puppet/contracts/const'
import type { ChainId } from '@puppet/sdk/const'
import { readableAddress, readablePercentage } from '@puppet/sdk/core'
import type { IBookRow } from '@puppet/sdk/schema'
import type { ITokenRegistryMap } from '@puppet/sdk/state'
import { awaitPromises, combine, constant, empty, filter, filterNull, type IStream, map, nowWith, op, sampleMap, skipRepeatsWith, start, switchLatest } from 'aelea/stream'
import { type IBehavior, multicast, state } from 'aelea/stream-extended'
import { $node, $text, attr, component, effectProp, type I$Node, type INode, nodeEvent, style, styleBehavior, stylePseudo } from 'aelea/ui'
import { $column, $intermediatePromise, $row, isDesktopScreen, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { $defaultAnchor, $Link } from 'aelea/ui-router'
import { type Address, isAddressEqual } from 'viem'
import {
  $anchor,
  $ButtonPrimary,
  $ButtonToggle,
  $defaultMiniButtonPrimary,
  $icon,
  $infoTooltip,
  $puppeteer,
  $smartContract,
  text
} from '@/ui-components'
import { routeSchema } from '../app/routeSchema.js'
import { chainFor } from '../common/$contract.js'
import { $puppetLogo } from '../common/$icons.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $card, $card2, $defaultMockWindow, $mockWindow } from '../common/elements/$common.js'
import { accountDisplayName } from '../components/$AccountProfile.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $WalletLink } from '../components/$WalletLink.js'
import { $TokenBalanceEditor } from '../components/portfolio/$TokenBalanceEditor.js'
import { depositCreditToken, type IDepositDraft, type IEditorDraft } from '../components/portfolio/draft.js'
import { DOCS_URL, GITHUB_REPO_URL, OPERATOR_GUIDE_URL } from '../const/links.js'
import context from '../io/context.js'
import type { IOwnState } from '../io/journal/localFold.js'
import { canInstallApp, promptInstallApp } from '../utils/pwaInstall.js'
import type { IConnectedWallet, IRootState, IWalletPair } from '../wallet/index.js'
import { balanceAt } from '../wallet/root.js'
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
  guarded: 'The reference risk-managed bot: swap one pure decide() and keep the guards (on-chain stop, drawdown halt, cost budget). Starts in dry-run.',
  trend: 'Deterministic EMA(12/26) + RSI trend-follower on ETH, one position at a time, with a cooldown.',
  'copy-trader': 'Mirrors a chosen GMX trader’s ETH position, sized to your trading account, with risk caps and a liquidation guard (set TRADER_ACCOUNT).',
  'llm-basic': 'An LLM decides long / flat / close via structured tool use; your code enforces the risk caps (set ANTHROPIC_API_KEY).'
}

interface ISectionParams {
  wallet: IConnectedWallet | null
  root: IRootState | null
  registry: ITokenRegistryMap
  books: IBookRow[]
}

export interface I$HelloPage {
  hideBalances: IStream<boolean>
  walletPair: IStream<IWalletPair>
  walletRoot: IStream<IRootState | null>
  ownStateQuery: IStream<Promise<IOwnState | null>>
  draftDepositList: IStream<IDepositDraft[]>
}

export const $HelloPage = ({ hideBalances, walletPair, walletRoot, ownStateQuery, draftDepositList }: I$HelloPage) =>
  component(
    (
      [changeDepositDraft, changeDepositDraftTether]: IBehavior<IEditorDraft>,
      [clickCreate, clickCreateTether]: IBehavior<PointerEvent>,
      [selectMode, selectModeTether]: IBehavior<INode, IMasterMode>,
      [selectTemplate, selectTemplateTether]: IBehavior<ITemplate>
    ) => {
      const modeState: IStream<IMasterMode> = state('human' as IMasterMode, selectMode)
      const keyless: IStream<boolean> = map(p => p.bodyKeys === null, walletPair)
      const deriving = op(
        sampleMap((pair, _click: PointerEvent) => pair, walletPair, clickCreate),
        map(pair => (pair.wallet === null || pair.bodyKeys === null ? null : { wallet: pair.wallet, keys: pair.bodyKeys })),
        filterNull,
        map(f => f.keys.derive(f.wallet)),
        state()
      )
      const created: IStream<Address> = op(
        deriving,
        map(async signer => (await signer).account),
        awaitPromises,
        multicast
      )

      const query: IStream<Promise<ISectionParams>> = op(
        combine({ pair: walletPair, own: ownStateQuery }),
        map(async q => {
          const [root, registry, own] = await Promise.all([q.pair.root, context.getTokenRegistry(), q.own])
          return {
            wallet: q.pair.wallet,
            root,
            registry,
            books: root === null || own === null ? [] : own.books.filter(b => isAddressEqual(b.master, root.account))
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

      const $create: I$Node = $column(spacing.big)(
        $row(spacing.small, style({ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }))(
          $row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, color: palette.foreground }))(
            $text(map(k => (k ? 'Key service unavailable in this build' : 'A fresh key shared between you and Puppet'), keyless)),
            $infoTooltip(
              'Your trading account is the address of a key you and Puppet hold together; neither side can move funds alone. One wallet holds exactly one account, at the same address on every chain and every venue; your first deposit binds it where it lands.',
              palette.foreground)
          ),
          $ButtonPrimary({
            $container: $defaultMiniButtonPrimary,
            $content: $text('Create trading account'),
            disabled: map(p => p.keyless || (p.deriving ?? false), combine({ keyless, deriving: start(null, deriving) }))
          })({ click: clickCreateTether() })
        )
      )

      const $accountCard = (root: IRootState, p: ISectionParams, wallet: IConnectedWallet): I$Node => {
        const account = root.account
        const puppetAccount: IStream<IRootState> = start(
          root,
          filter((live): live is IRootState => live !== null && isAddressEqual(live.account, account), walletRoot)
        )
        const registeredOn = (chainId: ChainId): Address[] =>
          [...(p.registry.get(chainId)?.keys() ?? [])].filter(t => !isAddressEqual(t, PROTOCOL.nativeToken))
        const draftFor = (list: IDepositDraft[], chainId: ChainId, token: Address): IDepositDraft | null =>
          list.find(
            d =>
              (Number(d.deposit.destinationChainId) === chainId && isAddressEqual(depositCreditToken(d), token)) ||
              (d.deposit.chainId === chainId && isAddressEqual(d.deposit.inputToken, token))
          ) ?? null
        const heldList: IStream<{ chainId: ChainId; token: Address }[]> = op(
          combine({ account: puppetAccount, drafts: draftDepositList }),
          map(q =>
            ([...CHAIN_IDS] as ChainId[]).flatMap(chainId =>
              registeredOn(chainId)
                .filter(token => balanceAt(q.account.balances, chainId, token) > 0n || draftFor(q.drafts, chainId, token) !== null)
                .map(token => ({ chainId, token }))
            )
          ),
          skipRepeatsWith((a, b) => a.map(x => `${x.chainId}:${x.token}`).join() === b.map(x => `${x.chainId}:${x.token}`).join())
        )
        const $balanceRows = switchLatest(
          map(
            list =>
              list.length === 0
                ? empty
                : $column(spacing.default, style({ width: '100%' }))(
                    ...list.map(x =>
                      $TokenBalanceEditor({
                        hideBalances,
                        accountState: puppetAccount,
                        chainId: x.chainId,
                        token: x.token,
                        tokenRegistry: p.registry,
                        walletAccount: wallet,
                        draft: map(drafts => draftFor(drafts, x.chainId, x.token), draftDepositList)
                      })({ changeDraft: changeDepositDraftTether() })
                    )
                  ),
            heldList
          )
        )
        const $existing =
          p.books.length === 0
            ? empty
            : $column(spacing.small, style({ width: '100%' }))(
                $node(style({ color: palette.foreground, fontSize: text.xs }))($text('Your books')),
                ...p.books.map(b =>
                  $row(spacing.default, style({ fontSize: text.sm, alignItems: 'center' }))(
                    $node(style({ color: palette.foreground }))($text(`${chainFor(Number(b.chainId) as ChainId).name} · cycle ${b.cycle}`))
                  )
                ),
                $Link({
                  route: routeSchema.portfolio,
                  $content: $text('Manage in your portfolio'),
                  $anchor: $defaultAnchor(style({ fontSize: text.sm, textDecoration: 'underline' }))
                })({})
              )
        return $card2(
          style({ borderRadius: '30px', padding: '20px 24px', width: '100%', maxWidth: '520px', alignSelf: 'center', border: `1px solid ${colorShade(palette.foreground, 25)}` })
        )(
          $column(spacing.default, style({ width: '100%' }))(
            $row(spacing.default, style({ alignItems: 'center' }))(
              $node(style({ width: '48px', height: '48px', borderRadius: '50%', overflow: 'hidden', flexShrink: '0' }))($roboAvatar(account, 48)),
              $column(style({ minWidth: '0', gap: '2px', flex: '1' }))(
                $node(style({ fontWeight: '600', fontSize: text.lg }))($text(accountDisplayName(account))),
                $row(spacing.tiny, style({ alignItems: 'center', fontFamily: 'monospace', fontSize: text.xs, color: palette.foreground }))(
                  $text(readableAddress(account)),
                  $infoTooltip(
                    `Your trading account takes ${readablePercentage(PROTOCOL.performanceFee)} of every backer gain at settlement. The same address on every chain; a deposit creates it where it lands.`,
                    palette.foreground)
                )
              ),
              $infoTooltip('Deposits land in this account on the chain you pick. A cross-chain arrival is swept in automatically once the bridge fills.', palette.foreground)
            ),
            $existing,
            $balanceRows
          )
        )
      }

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
          if (p.root === null) return $column(spacing.big)($stubIdentity('One signature creates it'), $create)
          return $accountCard(p.root, p, wallet)
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
          'Place trades on GMX by linking your trading account over WalletConnect. Every settled cycle builds your public record.',
          palette.positive
        ),
        $choiceCard(
          'agent',
          $smartContract,
          'Run an agent',
          'A bot places the trades',
          'Scaffold a bot that opens and maintains positions within the rules you signed. You deposit and settle here.',
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
        $stageHeader(1, 'Create your trading account'),
        $createStep,
        $separator(),
        $stageHeader(2, 'Choose your style'),
        $chooser,
        $flow
      )
      return [
        $column(spacing.big, style({ width: '100%' }))($card1),
        { changeDraft: changeDepositDraft, deriveAccount: created }
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
        'On app.gmx.io choose WalletConnect, copy its connection link, then open this panel to paste it. Every order is attested inside your open cycle.'
      ),
      $WalletLink({ walletPair, size: 56 })({})
    )
  )

const $humanNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('A credited trading account and a record that grows with every settled cycle. From here, performance is the work.'),
    $bulletList([
      ['Watch your first cycle settle', 'Every action lands on-chain the moment it executes; closing at flat settles your backers on the hub.'],
      ['Build a track record', 'Each settled cycle adds to a public history tied to this account. The chain is the proof.'],
      ['Attract outside capital', 'Once your record stands out, backers sign mandates naming your account, and you trade their bond alongside your own.']
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
      'The agent trades whatever you credited into the trading account above; any registered token works. GMX execution fees are paid in native, so credit a little ETH alongside.'
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
          $text('Done. The agent opens and maintains positions; you credit and settle '),
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
      ['Watch your first cycle settle', 'Every action lands on-chain the moment your strategy executes; closing at flat settles your backers on the hub.'],
      ['Build a track record', 'Each settled cycle adds to a public history tied to this account. The chain is the proof.'],
      ['Attract outside capital', 'Once your record stands out, backers sign mandates naming your account, and your strategy trades their bond alongside your own.']
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))(
      $linkButton('Traders', '/traders', true),
      $linkButton('Agent guide', OPERATOR_GUIDE_URL, false),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )
