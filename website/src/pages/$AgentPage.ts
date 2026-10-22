import { AGENT_TEMPLATES, type IAgentFile, type IAgentTemplateId, randomHex } from '@puppet/sdk/agent'
import { formatThrownError } from '@puppet/sdk/compact'
import { type ICells, randomCells } from '@puppet/sdk/ui-components'
import { combine, debounce, empty, filterNull, type IStream, just, map, merge, op, reduce, sampleMap, skipRepeats, skipRepeatsWith, start, switchLatest, switchMap, take } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, type I$Slottable, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $Popover, $row, designSheet, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import { type Address, isAddressEqual } from 'viem'
import {
  $alertInfo,
  $ButtonPrimary,
  $ButtonSecondary,
  $copy,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $document,
  $download,
  $icon,
  $infoTooltip,
  $intermediateLine,
  $labeledDivider,
  $terminal,
  keyActivate,
  text
} from '@/ui-components'
import type { IAgentIdentity } from '../app/localStoreSchema.js'
import { $card } from '../common/elements/$common.js'
import { $AgentAction, $agentStatus, type IAgentCommand, type IAgentStatuses } from '../components/$AgentLink.js'
import { $FundIdentityEditor } from '../components/portfolio/$FundIdentityEditor.js'
import { $WalletConnect } from '../components/$WalletConnect.js'
import { zipStored } from '../utils/zip.js'
import type { IWalletControl, IWalletIntent } from '../wallet/connect.js'
import type { IRootState, IWalletPair } from '../wallet/index.js'

type IPick = { template: IAgentTemplateId; path: string }

type IGate = { kind: 'pending' } | { kind: 'wallet' } | { kind: 'fund' } | { kind: 'unknown'; reason: string } | { kind: 'ready'; account: Address }

export interface I$AgentPage {
  walletPair: IStream<IWalletPair>
  identities: IStream<readonly IAgentIdentity[]>
  pending: IStream<IAgentIdentity | null>
  status: IStream<IAgentStatuses>
  walletControl: IWalletControl
}

const INSTRUCTIONS_MARK = '\u0000'

const TS_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(import|from|export|await|async|const|let|return|function|if|else|new|for|of|while|throw|try|catch|true|false|null|undefined|typeof|type)\b|\b(\d[\d_]*(?:\.\d+)?)\b/g

const TS_COLORS = [palette.foreground, palette.positive, palette.primary, palette.indeterminate]

const freshIdentity = (fund: Address, list: readonly IAgentIdentity[]): IAgentIdentity => {
  const taken = new Set(list.map(identity => identity.port))
  let port = 43000 + Math.floor(Math.random() * 7000)
  while (taken.has(port)) port = 43000 + Math.floor(Math.random() * 7000)
  return {
    secret: randomHex(32),
    port,
    name: `AGENT${list.filter(identity => isAddressEqual(identity.fund, fund)).length + 1}`,
    cells: randomCells(),
    fund,
    template: 'instruction',
    strategy: ''
  }
}

const filesOf = (identity: IAgentIdentity, instructions: string): IAgentFile[] => {
  const template = AGENT_TEMPLATES.find(entry => entry.id === identity.template)
  if (template === undefined) throw new Error(`no agent template ${identity.template}`)
  return template.files({ name: identity.name, port: identity.port, secret: identity.secret, account: identity.fund, instructions })
}

const $hint = (line: string): I$Node => $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))($text(line))

const $sectionTitle = ($label: I$Node): I$Node => $labeledDivider($row(spacing.tiny, style({ alignItems: 'center', fontSize: text.xs, whiteSpace: 'nowrap' }))($label))

const $code = (content: string): I$Node =>
  $node(style({ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: text.xs, lineHeight: '1.6', color: palette.foreground }))($text(content))

const $tsCode = (source: string): I$Node => {
  const $parts: I$Slottable[] = []
  let at = 0
  for (const match of source.matchAll(TS_TOKEN)) {
    if (match.index > at) $parts.push($text(source.slice(at, match.index)))
    $parts.push($element('span')(style({ color: TS_COLORS[match.slice(1).findIndex(group => group !== undefined)] }))($text(match[0])))
    at = match.index + match[0].length
  }
  if (at < source.length) $parts.push($text(source.slice(at)))
  return $node(style({ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: text.xs, lineHeight: '1.6', color: palette.message }))(...$parts)
}

const $fileIcon = (path: string, size: string): I$Node =>
  path.endsWith('.ts')
    ? $icon({ $content: $terminal, viewBox: '0 0 24 24', size, svgOps: style({ color: palette.positive }) })
    : $icon({ $content: $document, viewBox: '0 0 24 24', size, svgOps: style({ color: palette.primary }) })

const $choice = (selected: boolean) =>
  $node(
    attr({ role: 'button', tabindex: '0', 'aria-pressed': selected ? 'true' : 'false' }),
    style({
      cursor: 'pointer',
      borderRadius: '100px',
      border: `1px solid ${selected ? palette.primary : colorShade(palette.foreground, 25)}`,
      color: selected ? palette.message : palette.foreground
    }),
    keyActivate()
  )

export const $AgentPage = ({ walletPair, identities, pending, status, walletControl }: I$AgentPage) =>
  component(
    (
      [changeName, changeNameTether]: IBehavior<string>,
      [changeCells, changeCellsTether]: IBehavior<ICells>,
      [pickTemplate, pickTemplateTether]: IBehavior<INode, IAgentTemplateId>,
      [typeStrategy, typeStrategyTether]: IBehavior<INode, string>,
      [pickFile, pickFileTether]: IBehavior<INode, IPick>,
      [clickCopy, clickCopyTether]: IBehavior<PointerEvent, string>,
      [clickDownload, clickDownloadTether]: IBehavior<PointerEvent>,
      [command, commandTether]: IBehavior<IAgentCommand>,
      [enableSession, enableSessionTether]: IBehavior<PointerEvent>,
      [walletIntent, walletIntentTether]: IBehavior<IWalletIntent>,
      [openAvatar, openAvatarTether]: IBehavior<I$Node>,
      [closeAvatar, closeAvatarTether]: IBehavior<unknown>
    ) => {
      const gate: IStream<IGate> = op(
        walletPair,
        switchMap(async (pair): Promise<IGate> => {
          if (pair.wallet === null) return { kind: 'wallet' }
          let root: IRootState | null
          try {
            root = await pair.root
          } catch (err) {
            return { kind: 'unknown', reason: `Your account could not be read: ${formatThrownError(err)}` }
          }
          if (root === null) return { kind: 'wallet' }
          if (root.fund === null) return { kind: 'fund' }
          if ('unknown' in root.fund) return { kind: 'unknown', reason: root.fund.unknown }
          return { kind: 'ready', account: root.fund.account }
        }),
        start<IGate, IGate>({ kind: 'pending' }),
        skipRepeatsWith((a, b) => (a.kind === 'ready' && b.kind === 'ready' ? isAddressEqual(a.account, b.account) : a.kind === b.kind)),
        state()
      )

      const draft: IStream<IAgentIdentity> = op(
        gate,
        map(current => (current.kind === 'ready' ? current.account : null)),
        skipRepeats,
        switchMap(fund =>
          fund === null
            ? empty
            : op(
                combine({ list: identities, held: pending }),
                take(1),
                map(({ list, held }) => (held !== null && isAddressEqual(held.fund, fund) && !list.some(identity => identity.secret === held.secret) ? held : freshIdentity(fund, list))),
                switchMap(seed =>
                  op(
                    merge(
                      map(name => (identity: IAgentIdentity): IAgentIdentity => ({ ...identity, name: name === '' ? seed.name : name }), changeName),
                      map(cells => (identity: IAgentIdentity): IAgentIdentity => ({ ...identity, cells }), changeCells),
                      map(template => (identity: IAgentIdentity): IAgentIdentity => ({ ...identity, template }), pickTemplate),
                      map(strategy => (identity: IAgentIdentity): IAgentIdentity => ({ ...identity, strategy }), typeStrategy)
                    ),
                    reduce((identity: IAgentIdentity, apply: (identity: IAgentIdentity) => IAgentIdentity) => apply(identity), seed)
                  )
                )
              )
        ),
        state()
      )
      const kept: IStream<boolean> = op(
        combine({ list: identities, current: draft }),
        map(({ list, current }) => list.some(identity => identity.secret === current.secret)),
        skipRepeats,
        state()
      )

      const picked: IStream<IPick | null> = state(null, pickFile)

      const $main = (file: IAgentFile): I$Node => {
        const parts = file.content.split(INSTRUCTIONS_MARK)
        if (parts.length !== 2) throw new Error(`${file.path} does not hold the instructions exactly once`)
        const [before, after] = parts
        return $node(
          before.trim() === '' ? empty : $code(before.replace(/\n+$/, '')),
          $element('textarea')(
            attr({ spellcheck: 'false', placeholder: 'Paste or write your agent’s instructions' }),
            style({
              display: 'block',
              width: '100%',
              boxSizing: 'border-box',
              fieldSizing: 'content',
              minHeight: '10lh',
              resize: 'none',
              margin: '10px 0',
              padding: '10px 12px',
              borderRadius: '8px',
              border: `1px solid ${colorShade(palette.foreground, 25)}`,
              outline: 'none',
              backgroundColor: palette.background,
              color: palette.message,
              fontFamily: 'monospace',
              fontSize: text.xs,
              lineHeight: '1.6'
            }),
            stylePseudo(':focus', { borderColor: palette.primary }),
            designSheet.customScroll,
            effectProp(
              'value',
              op(
                draft,
                take(1),
                map(identity => identity.strategy)
              )
            ),
            typeStrategyTether(
              nodeEvent('input'),
              map(event => (event.currentTarget as HTMLTextAreaElement).value)
            )
          )(),
          $code(after.replace(/^\n+/, ''))
        )
      }

      const $editor = switchLatest(
        map(
          ({ current, pick }) => {
            const files = filesOf(current, INSTRUCTIONS_MARK)
            const [main] = files
            const shown = pick !== null && pick.template === current.template ? files.find(file => file.path === pick.path) : main
            if (main === undefined || shown === undefined) throw new Error(`the ${current.template} template has no file to show`)
            return $column(spacing.small)(
              $row(spacing.small, style({ alignItems: 'center', flexWrap: 'wrap' }))(
                $node(style({ flex: '1 1 240px', minWidth: '0' }))(
                  $labeledDivider(
                    files.length === 1
                      ? $row(spacing.tiny, style({ alignItems: 'center', fontFamily: 'monospace', fontSize: text.xs, color: palette.message }))($fileIcon(shown.path, '14px'), $text(shown.path))
                      : $row(spacing.tiny, style({ flexWrap: 'wrap', justifyContent: 'center' }))(
                          ...files.map(file =>
                            $choice(file.path === shown.path)(
                              attr({ title: file.path }),
                              style({ padding: '3px 10px', fontSize: text.xs, fontFamily: 'monospace', whiteSpace: 'nowrap' }),
                              pickFileTether(
                                nodeEvent('click'),
                                map(() => ({ template: current.template, path: file.path }))
                              )
                            )($row(spacing.tiny, style({ alignItems: 'center' }))($fileIcon(file.path, '13px'), $text(file.path.slice(file.path.lastIndexOf('/') + 1))))
                          )
                        )
                  )
                ),
                $row(spacing.tiny, style({ alignItems: 'center', marginLeft: 'auto' }))(
                  $ButtonSecondary({
                    $container: $defaultMiniButtonSecondary,
                    $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $copy, viewBox: '0 0 24 24', width: '14px' }), $text('Copy'))
                  })({ click: clickCopyTether(map(() => shown.path)) }),
                  $ButtonPrimary({
                    $container: $defaultMiniButtonPrimary,
                    $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $download, viewBox: '0 0 24 24', width: '14px' }), $text('Download'))
                  })({ click: clickDownloadTether() })
                )
              ),
              shown === main ? $main(shown) : shown.path.endsWith('.ts') ? $tsCode(shown.content) : $code(shown.content)
            )
          },
          combine({
            current: op(
              draft,
              skipRepeatsWith((a, b) => a.secret === b.secret && a.template === b.template && a.name === b.name)
            ),
            pick: picked
          })
        )
      )

      const failure: IStream<string> = op(
        merge(
          op(
            sampleMap((current: IAgentIdentity, path: string) => ({ files: filesOf(current, current.strategy), path }), draft, clickCopy),
            switchMap(async ({ files, path }): Promise<string> => {
              try {
                const file = files.find(entry => entry.path === path)
                if (file === undefined) throw new Error(`${path} is not in this template`)
                await navigator.clipboard.writeText(file.content)
                return ''
              } catch (err) {
                return `Copy failed: ${formatThrownError(err)}`
              }
            })
          ),
          op(
            sampleMap((current: IAgentIdentity, _click: PointerEvent) => filesOf(current, current.strategy), draft, clickDownload),
            map(files => {
              const [first] = files
              const name = files.length === 1 ? first.path.slice(first.path.lastIndexOf('/') + 1) : `${first.path.split('/')[0]}.zip`
              const blob =
                files.length === 1
                  ? new Blob([first.content], { type: 'text/markdown' })
                  : zipStored(
                      files.map(file => ({ path: file.path, bytes: new TextEncoder().encode(file.content) })),
                      new Date()
                    )
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = name
              anchor.click()
              setTimeout(() => URL.revokeObjectURL(url), 60_000)
              return ''
            })
          )
        ),
        start('')
      )

      const $create = switchLatest(
        map(
          seed =>
            $column(spacing.default)(
              $row(style({ justifyContent: 'center' }))(
                $Popover({
                  $open: openAvatar,
                  dismiss: changeCells,
                  $target: $FundIdentityEditor(
                  just(seed.name),
                  op(
                    draft,
                    map(identity => identity.cells),
                    skipRepeats
                  ),
                  seed.name,
                  switchLatest(
                    map(
                      ({ current, statuses, held, created }) => {
                        const taken = created || (held !== null && held.secret === current.secret)
                        return $row(spacing.small, style({ alignItems: 'center' }))(
                          $agentStatus(taken ? statuses[current.secret] : undefined),
                          taken ? $AgentAction(current, statuses[current.secret])({ command: commandTether(), enableSession: enableSessionTether() }) : empty
                        )
                      },
                      combine({ current: draft, statuses: status, held: pending, created: kept })
                    )
                  ),
                  closeAvatar
                )({ changeSymbol: changeNameTether(), changeCells: changeCellsTether(), openAvatar: openAvatarTether() })
                })({ dismiss: closeAvatarTether() })
              ),
              $sectionTitle(
                $row(spacing.tiny, style({ alignItems: 'center' }))(
                  $text('Template'),
                  $infoTooltip(
                    'Your instructions plus this agent’s link. Give the files to your agent, or run the Bun agent with bun agent.ts in its folder, and keep them private: they hold its link secret. The first time, allow your browser’s prompt so this site can reach it.',
                    palette.foreground
                  )
                )
              ),
              switchLatest(
                map(
                  chosen =>
                    $row(spacing.tiny, style({ flexWrap: 'wrap' }))(
                      ...AGENT_TEMPLATES.map(template =>
                        $choice(template.id === chosen)(
                          attr({ title: template.detail }),
                          style({ padding: '4px 12px', fontSize: text.sm, whiteSpace: 'nowrap' }),
                          pickTemplateTether(
                            nodeEvent('click'),
                            map(() => template.id)
                          )
                        )($text(template.name))
                      )
                    ),
                  op(
                    draft,
                    map(identity => identity.template),
                    skipRepeats
                  )
                )
              ),
              $editor,
              switchLatest(map(message => (message === '' ? empty : $node(style({ color: palette.negative, fontSize: text.sm }))($text(message))), failure))
            ),
          op(
            draft,
            skipRepeatsWith((a, b) => a.secret === b.secret)
          )
        )
      )

      return [
        $card(spacing.big, style({ width: '100%' }))(
          $column(spacing.tiny)(
            $node(style({ fontSize: text.lg, fontWeight: '600', color: palette.message }))($text('New agent')),
            $node(style({ color: palette.foreground, fontSize: text.sm, lineHeight: '1.5' }))(
              $text('Name it, pick a template, then copy or download its files. '),
              $node(style({ display: 'inline-flex', verticalAlign: 'middle' }))(
                $infoTooltip(
                  'It acts with your session in this fund, so run it where you would keep your keys. Every request is screened and simulated like your own, so money moves only to screened venues, back to your fund or to exits. It is created on its first connection, and its name and avatar are seen only by you. Remove it under Sessions on your wallet any time.',
                  palette.foreground
                )
              )
            )
          ),
          switchLatest(
            map(
              current =>
                current.kind === 'pending'
                  ? $intermediateLine('12em', text.sm)
                  : current.kind === 'wallet'
                    ? $column(spacing.small)($alertInfo($hint('Connect your wallet to create an agent.')), $WalletConnect({ control: walletControl })({ walletIntent: walletIntentTether() }))
                    : current.kind === 'fund'
                      ? $alertInfo($hint('Create your fund in your wallet first; your agents operate it.'))
                      : current.kind === 'unknown'
                        ? $hint(current.reason)
                        : $create,
              gate
            )
          )
        ),
        {
          changeIdentities: op(
            sampleMap(
              (list: readonly IAgentIdentity[], current: IAgentIdentity) =>
                list.some(identity => identity.secret === current.secret) ? list.map(identity => (identity.secret === current.secret ? current : identity)) : null,
              identities,
              debounce(400, draft)
            ),
            filterNull
          ),
          changePending: merge(
            op(
              sampleMap(
                ({ list, current }: { list: readonly IAgentIdentity[]; current: IAgentIdentity }, _take: unknown) => (list.some(identity => identity.secret === current.secret) ? null : current),
                combine({ list: identities, current: draft }),
                merge(clickCopy, clickDownload)
              ),
              filterNull
            ),
            op(
              sampleMap((held: IAgentIdentity | null, current: IAgentIdentity) => (held !== null && held.secret === current.secret ? current : null), pending, debounce(400, draft)),
              filterNull
            )
          ),
          command,
          enableSession,
          walletIntent
        }
      ]
    }
  )
