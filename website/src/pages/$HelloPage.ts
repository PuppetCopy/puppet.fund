import { HUB_CHAIN_ID, PROTOCOL } from '@puppet/contracts/const'
import type { IAccountLib__AccountInitParams, IFundAccountLib__FundAccountInitParams } from '@puppet/contracts/types'
import { predictFundAccount, predictPuppetAccount, predictShareToken } from '@puppet/sdk/account'
import { BYTES32_ZERO } from '@puppet/sdk/const'
import { getChainTokenDescription } from '@puppet/sdk/core'
import { type ISubaccountState, type ITokenRegistryMap, stubSubaccountState } from '@puppet/sdk/state'
import {
  encodeFundName,
  roboAvatarName,
  roboIndicesFromAddress,
  roboPreviewTraits,
  roboTraitsFromNameAndAddress
} from '@puppet/sdk/ui-components'
import {
  combine,
  constant,
  debounce,
  empty,
  fromPromise,
  type IStream,
  just,
  map,
  nowWith,
  op,
  sampleMap,
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
import { type Address, getAddress, type Hex, zeroAddress } from 'viem'
import {
  $anchor,
  $ButtonSecondary,
  $ButtonToggle,
  $defaultButtonPrimary,
  $defaultButtonPrimaryOutline,
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
import { routeSchema } from '../app/routeSchema.js'
import { $puppetLogo } from '../common/$icons.js'
import { $roboAvatar } from '../common/$roboAvatar.js'
import { $heading1 } from '../common/$text.js'
import { $card, $card2, $defaultMockWindow, $mockWindow } from '../common/elements/$common.js'
import { accountNameToHex, readableAccountName } from '../components/$AccountProfile.js'
import { $enableSessionDisclaimer } from '../components/$enableSession.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { $WalletLink } from '../components/$WalletLink.js'
import { $FundEditor } from '../components/portfolio/$FundEditor.js'
import { $RoboTraitPicker } from '../components/portfolio/$RoboTraitPicker.js'
import type {
  IAllocateDraft,
  IClaimDraft,
  IFundSwapDraft,
  IRecognizeFundDraft,
  IRedeemDraft,
  ISellDraft
} from '../components/portfolio/draft.js'
import { DOCS_URL, GITHUB_REPO_URL, OPERATOR_GUIDE_URL } from '../const/links.js'
import context from '../io/context.js'
import { canInstallApp, promptInstallApp } from '../utils/pwaInstall.js'
import { bindSession, type IConnectedWallet, refreshWallet } from '../wallet/index.js'
import { resolvedWalletPair } from '../wallet/pair.js'
import { $body, $bulletList, $callout, $linkButton, $stageHeader, $terminal } from './$onboarding.js'

const BUBBLE_SEED = '0x0000000000000000000000000000000000000001' as Address

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
  hideBalances: IStream<boolean>
  walletQuery: IStream<Promise<IConnectedWallet | null>>
  walletState: IStream<Promise<ISubaccountState | null>>
  draftAllocateList: IStream<IAllocateDraft[]>
  draftSwapList: IStream<IFundSwapDraft[]>
  draftRedeemList: IStream<IRedeemDraft[]>
  embedded?: boolean
}

export const $HelloPage = ({
  hideBalances,
  walletQuery,
  walletState: rootStateQuery,
  draftAllocateList,
  draftSwapList,
  draftRedeemList,
  embedded = false
}: I$HelloPage) =>
  component(
    (
      [changeMasterDraft, changeMasterDraftTether]: IBehavior<IAllocateDraft>,
      [changeSwapDraft, changeSwapDraftTether]: IBehavior<IFundSwapDraft>,
      [changeRedeemDraft, changeRedeemDraftTether]: IBehavior<ISellDraft | IClaimDraft>,
      [changeFulfillDraft, changeFulfillDraftTether]: IBehavior<IRedeemDraft | IRecognizeFundDraft>,
      [selectBaseToken, selectBaseTokenTether]: IBehavior<Hex>,
      [changeName, changeNameTether]: IBehavior<string>,
      [changeTraits, changeTraitsTether]: IBehavior<number[] | null>,
      [openAvatar, openAvatarTether]: IBehavior<INode, PointerEvent>,
      [selectMode, selectModeTether]: IBehavior<INode, IMasterMode>,
      [selectTemplate, selectTemplateTether]: IBehavior<ITemplate>,
      [_connect, connectTether]: IBehavior<unknown>
    ) => {
      const walletPair = resolvedWalletPair(walletQuery, rootStateQuery)
      const walletState: IStream<IConnectedWallet | null> = map(p => p.wallet, walletPair)
      const rootState: IStream<ISubaccountState | null> = map(p => p.root, walletPair)
      const tokenRegistryValue = fromPromise(context.getTokenRegistry())
      const baseToken: IStream<Hex> = state(zeroAddress, selectBaseToken)
      const modeState: IStream<IMasterMode> = state('human', selectMode)

      const $subhead = (label: string): I$Node =>
        $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text(label))

      interface ISectionParams {
        wallet: IConnectedWallet | null
        registry: ITokenRegistryMap
        baseToken: Hex
        root: ISubaccountState | null
      }

      const typedName: IStream<string | null> = state(null, changeName)
      const traitsState: IStream<number[] | null> = state(null, changeTraits)

      const $createMasterStep: I$Node = switchLatest(
        map(
          (p: ISectionParams) => {
            const homeTokens = p.registry.get(HUB_CHAIN_ID)
            const registeredIds = [...(homeTokens?.entries() ?? [])]
              .filter(([, info]) => info.token !== PROTOCOL.nativeToken)
              .map(([id]) => id)
            if (registeredIds.length === 0) return $callout('No tokens are registered yet. Check back shortly.')
            const effectiveBid = homeTokens?.has(p.baseToken) ? p.baseToken : registeredIds[0]!
            const $tokenSelector = $ButtonToggle({
              value: just(effectiveBid),
              optionList: registeredIds,
              $$option: map((id: Hex) => {
                const info = homeTokens?.get(id)
                return $node(info ? $tokenLabelFromSummary(getChainTokenDescription(HUB_CHAIN_ID, info.token)) : $text(id))
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
            const baseInfo = homeTokens?.get(effectiveBid)
            const $stubIdentity = (hint: string): I$Node =>
              $column(spacing.small, style({ width: '100%', maxWidth: '520px', alignSelf: 'center' }))(
                $node(style({ color: palette.foreground, fontSize: text.xs, alignSelf: 'center' }))(
                  $text('Your fund is your public identity')
                ),
                $card2(
                  style({
                    borderRadius: '30px',
                    padding: '12px 24px',
                    border: `1px solid ${colorShade(palette.foreground, 25)}`
                  })
                )(
                  $row(
                    style({ alignItems: 'center', justifyContent: 'space-between', gap: '16px', width: '100%' })
                  )(
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
                        $column(style({ minWidth: '0', gap: '2px' }))(
                          $node(style({ fontWeight: '600', fontSize: text.lg, color: palette.foreground }))(
                            $text('Your fund')
                          ),
                          baseInfo
                            ? $node($tokenLabelFromSummary(getChainTokenDescription(HUB_CHAIN_ID, baseInfo.token)))
                            : empty
                        )
                      )
                    ),
                    $node(
                      style({
                        color: palette.indeterminate,
                        fontSize: text.xs,
                        textAlign: 'right',
                        flexShrink: '0'
                      })
                    )($text(hint))
                  )
                )
              )
            if (!p.wallet)
              return $column(spacing.big)(
                $baseTokenField,
                $stubIdentity('Connect a wallet to see your fund'),
                $column(spacing.default, style({ alignItems: 'center', textAlign: 'center' }))(
                  $subhead('Connect your wallet'),
                  $node(style({ fontSize: text.sm, color: palette.foreground, lineHeight: '1.6', maxWidth: '420px' }))(
                    $text('It secures a new smart wallet, recoverable any time. No seed phrase to manage.')
                  ),
                  $row(
                    spacing.default,
                    style({ justifyContent: 'center', width: '100%', flexWrap: 'wrap' })
                  )($WalletConnect()({ connect: connectTether() }))
                )
              )
            const wallet = p.wallet
            const signer: Address | null = wallet.session?.signer ?? null

            const $signSession = $EnableSession(wallet)({})

            if (signer === null) {
              return $column(spacing.big)(
                $baseTokenField,
                $column(spacing.small, style({ width: '100%', alignItems: 'flex-start', color: palette.foreground }))(
                  $row(spacing.small, style({ width: '100%', alignItems: 'center' }))(
                    $labelDisplay(style({ width: '92px' }))($text('Session')),
                    $signSession
                  ),
                  $node(style({ color: palette.foreground, fontSize: text.xs, lineHeight: '1.5' }))(
                    $text('One gasless signature opens your session and unlocks the fund preview. Nothing moves without rules you sign.')
                  )
                ),
                $stubIdentity('Sign a session to see your fund')
              )
            }

            const fundParams: IAccountLib__AccountInitParams = { user: wallet.address, signer }
            const fundMaster = predictPuppetAccount(fundParams)
            const previewFundParams = { master: fundMaster, baseToken: effectiveBid, name: BYTES32_ZERO }
            const existingFund = p.root?.funds.find(
              f => f.baseToken === effectiveBid && getAddress(f.master as Address) === fundMaster
            )
            const defaultName =
              readableAccountName(existingFund?.name as Hex | undefined) ??
              roboAvatarName(predictShareToken(previewFundParams))
            const fundName: IStream<string> = map(n => (n?.trim() ? n : defaultName), typedName)
            const $nameField = $FieldLabeled({
              label: 'Name',
              labelWidth: 92,
              hint: 'Shown on the leaderboard and your profile, auto-generated if left blank.',
              placeholder: defaultName,
              maxLength: 32,
              value: map(n => n ?? '', typedName)
            })({
              change: changeNameTether()
            })

            const fund: IStream<IFundAccountLib__FundAccountInitParams> = map(
              ({ name, traits }) => {
                const display = name.trim() || defaultName
                return {
                  master: fundMaster,
                  baseToken: effectiveBid,
                  name: accountNameToHex(traits ? encodeFundName(display, traits) : display)
                }
              },
              combine({ name: fundName, traits: traitsState })
            )
            const seedIndices: IStream<number[]> = op(
              fundName,
              map(name =>
                roboIndicesFromAddress(
                  predictShareToken({ master: fundMaster, baseToken: effectiveBid, name: accountNameToHex(name.trim() || defaultName) })
                )
              ),
              skipRepeatsWith((a, b) => a.join() === b.join())
            )
            const editorModel = combine({ applied: traitsState, seed: seedIndices })
            const isCreated = existingFund != null
            const revealSeed: IStream<Address> = map(share => predictShareToken(share), fund)
            const $avatarBubble = $row(style({ position: 'relative', width: '52px', height: '52px', flexShrink: '0' }))(
              $node(
                style({
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: `1px solid ${colorShade(palette.foreground, 35)}`
                })
              )(
                switchLatest(
                  map(({ m, seed }) => {
                    const idx = m.applied ?? m.seed
                    return isCreated
                      ? $roboAvatar(seed, undefined, roboTraitsFromNameAndAddress(idx, seed))
                      : $roboAvatar(BUBBLE_SEED, undefined, roboPreviewTraits(idx))
                  }, combine({ m: editorModel, seed: revealSeed }))
                )
              ),
              $node(
                style({
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: palette.primary,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  lineHeight: '1',
                  border: `2px solid ${palette.background}`,
                  pointerEvents: 'none'
                })
              )($text('✎'))
            )
            const $avatarTrigger = $column(
              spacing.small,
              style({ flexShrink: '0', maxWidth: '160px', cursor: 'pointer' }),
              stylePseudo(':hover', { color: palette.message }),
              attr({ title: 'Customize avatar', role: 'button' }),
              openAvatarTether(nodeEvent('click'))
            )(
              $row(spacing.small, style({ alignItems: 'center' }))($labelDisplay($text('Avatar')), $avatarBubble),
              $node(style({ color: palette.foreground, fontSize: text.xs, whiteSpace: 'nowrap', lineHeight: '1.5' }))(
                $text('Click to pick your robot traits.')
              )
            )
            const $avatarEditor = $Popover({
              $open: op(
                openAvatar,
                sampleMap(
                  m =>
                    $RoboTraitPicker({
                      initial: m.applied ?? m.seed,
                      auto: m.seed,
                      initialTouched: m.applied != null
                    })({ changeTraits: changeTraitsTether() }),
                  editorModel
                )
              ),
              dismiss: changeTraits,
              $target: $avatarTrigger
            })({})
            const fundAccountAddr: IStream<Address> = debounce(250, map(predictFundAccount, fund))
            const account: IStream<ISubaccountState> = op(
              combine({ root: rootState, fundAddr: fundAccountAddr }),
              map(({ root, fundAddr }) => {
                const base: ISubaccountState = {
                  ...stubSubaccountState(fundParams),
                  account: fundAddr,
                  signer: fundMaster,
                  isFund: true
                }
                if (!root) return base
                const deployedFund = root.funds.some(f => getAddress(f.fund as Address) === getAddress(fundAddr))
                return {
                  ...base,
                  funds: root.funds,
                  positions: root.positions,
                  chains: deployedFund ? root.chains : base.chains,
                  lastTransactionHash: root.lastTransactionHash
                }
              })
            )
            const $accountSection = $FundEditor({
              hideBalances,
              account,
              walletAccount: wallet,
              tokenRegistry: p.registry,
              fund,
              draft: map(
                p => p.list.find(d => d.account === p.fund) ?? null,
                combine({ list: draftAllocateList, fund: fundAccountAddr })
              ),
              redeemDraft: map(
                p => p.list.find(d => d.masterAccount === p.fund) ?? null,
                combine({ list: draftRedeemList, fund: fundAccountAddr })
              ),
              swapDraftList: draftSwapList
            })({
              changeDraft: changeMasterDraftTether(),
              changeSwapDraft: changeSwapDraftTether(),
              changeRedeemDraft: changeRedeemDraftTether(),
              changeFulfillDraft: changeFulfillDraftTether()
            })

            return $column(spacing.big)(
              $column(spacing.big)(
                $baseTokenField,
                $row(spacing.big, style({ alignItems: 'flex-start', width: '100%' }))(
                  $avatarEditor,
                  $node(style({ flex: '1', minWidth: '0' }))($nameField)
                ),
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
          skipRepeatsWith<ISectionParams>(
            (a, b) =>
              a.wallet?.address === b.wallet?.address &&
              a.wallet?.session?.signer === b.wallet?.session?.signer &&
              a.registry === b.registry &&
              a.baseToken === b.baseToken &&
              !!a.root === !!b.root &&
              a.root?.signer === b.root?.signer,
            combine({ wallet: walletState, registry: tokenRegistryValue, baseToken, root: rootState })
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

      const $separator = (): I$Node => $node(style({ height: '48px', width: '100%' }))()

      const $flow: I$Node = switchLatest(
        map(mode => {
          return $column(spacing.big)(
            $separator(),
            $column(spacing.default)(
              $stageHeader(3, mode === 'agent' ? 'Spin up your agent' : 'Trade'),
              mode === 'agent' ? $spinUpStep(templateState, $templatePicker) : $tradeStep({ walletState, rootState })
            ),
            $separator(),
            $column(spacing.default)(
              $stageHeader(4, 'From here'),
              mode === 'agent' ? $agentNextStep() : $humanNextStep()
            )
          )
        }, modeState)
      )

      const $card1 = $card(spacing.big, style({ width: '100%', padding: isDesktopScreen ? '62px' : '16px' }))(
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
          changeSwapDraft,
          changeRedeemDraft,
          changeFulfillDraft
        }
      ]
    }
  )

const $hero = (): I$Node =>
  $column(spacing.default, style({ paddingBottom: '12px' }))(
    $heading1($text('Trade exactly as you do today, and earn more.')),
    $node(style({ fontSize: text.lg, lineHeight: '1.5', color: palette.message }))(
      $text(
        'Puppet capital rides your trades and pays you performance fees. You keep your keys, and every action runs under rules you sign.'
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
        $container: $defaultButtonPrimaryOutline(style({ flexShrink: '0', alignSelf: 'center' })),
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

const $tradeStep = ({
  walletState,
  rootState
}: {
  walletState: IStream<IConnectedWallet | null>
  rootState: IStream<ISubaccountState | null>
}): I$Node =>
  $column(spacing.big)(
    $body('Link this fund to GMX over WalletConnect and trade there exactly as you do today.'),
    $callout(
      'Your session key can operate on approved venues within the rules you set. It can never withdraw: funds only ever leave to your own wallet.'
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
        'On app.gmx.io choose WalletConnect, copy its connection link, then open this panel to paste it. Every trade executes under the rules you signed.'
      ),
      $WalletLink({ walletState, rootState, size: 56 })({})
    )
  )

const $humanNextStep = (): I$Node =>
  $column(spacing.default)(
    $body('A funded account and a record that grows with every settled trade. From here, performance is the work.'),
    $bulletList([
      [
        'Watch your first trade settle',
        'Every action lands on-chain and on the leaderboard the moment it executes.'
      ],
      [
        'Build a track record',
        'Each settled trade adds to a public history tied to this account. The chain is the proof.'
      ],
      [
        'Attract outside capital',
        'Once your record stands out, backers fund you under rules they set, and you trade for the pool.'
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
  $column(spacing.big)(
    $body(
      'The agent trades the base token of the fund you create above, any registered token works. A non-WETH base (USDC or ETH) also needs a little ETH in the fund to cover GMX execution fees; WETH is simplest because the keeper fee comes straight out of the collateral.'
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
          'the agent opens and manages positions within the rules you signed; your money can only ever leave to your own wallet, never to the trader, the agent, or us.'
        ],
        [
          'Your key stays on your machine',
          'pairing hands the agent a session key kept in memory, never written to disk and never sent to us; the relay and this site only ever see signatures, never the key.'
        ],
        [
          'You stay in control',
          'every action is co-signed on-chain against your rules or it never executes, and you can stop the agent any time with Ctrl-C.'
        ]
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
            $anchor(
              attr({ href: 'https://bun.com', target: '_blank' }),
              style({ textDecoration: 'underline' })
            )($text('bun.com'))
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
      )
    ),
    $callout(
      'Shape the strategy in src/index.ts. No matter what you write there, the agent stays bound by the rules you signed: it can never send your funds anywhere but your own wallet.'
    )
  )

const $agentNextStep = (): I$Node =>
  $column(spacing.default)(
    $body(
      'A live fund, an agent trading within the rules you signed, and every action checked by the protocol before it executes. From here, performance is the work.'
    ),
    $bulletList([
      [
        'Watch your first trade settle',
        'Every action lands on-chain and on the leaderboard the moment your strategy executes.'
      ],
      [
        'Build a track record',
        'Each settled trade adds to a public history tied to this wallet. The chain is the proof.'
      ],
      [
        'Attract outside capital',
        'Once your record stands out, others fund you. Their capital flows under rules they set, and your strategy trades for the pool.'
      ]
    ]),
    $row(spacing.default, style({ paddingTop: '8px' }))(
      $linkButton('Leaderboard', '/leaderboard', true),
      $linkButton('Agent guide', OPERATOR_GUIDE_URL, false),
      $linkButton('Protocol docs', DOCS_URL, false)
    )
  )
