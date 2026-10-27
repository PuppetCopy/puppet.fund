import { AGENT_TEMPLATES, type IAgentFile, type IAgentTemplateId } from '@puppet/sdk/agent'
import { formatThrownError } from '@puppet/sdk/compact'
import { combine, empty, type IStream, map, merge, op, sampleMap, start, switchLatest, switchMap, take } from 'aelea/stream'
import { type IBehavior, state } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, effectProp, type I$Node, type I$Slottable, type INode, nodeEvent, style, stylePseudo } from 'aelea/ui'
import { $column, $row, designSheet, spacing } from 'aelea/ui-components'
import { colorShade, palette } from 'aelea/ui-components-theme'
import {
  $ButtonPrimary,
  $ButtonSecondary,
  $copy,
  $defaultMiniButtonPrimary,
  $defaultMiniButtonSecondary,
  $document,
  $download,
  $icon,
  $labeledDivider,
  $terminal,
  keyActivate,
  text
} from '@/ui-components'
import { zipStored } from '../utils/zip.js'

const INSTRUCTIONS_MARK = '\u0000'

const TS_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(import|from|export|await|async|const|let|return|function|if|else|new|for|of|while|throw|try|catch|true|false|null|undefined|typeof|type)\b|\b(\d[\d_]*(?:\.\d+)?)\b/g

const TS_COLORS = [palette.foreground, palette.positive, palette.primary, palette.indeterminate]

type IPick = { template: IAgentTemplateId; path: string }

const filesOf = (template: IAgentTemplateId, instructions: string): IAgentFile[] => {
  const entry = AGENT_TEMPLATES.find(each => each.id === template)
  if (entry === undefined) throw new Error(`no agent template ${template}`)
  return entry.files({ instructions })
}

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

export const $AgentTemplates = () =>
  component(
    (
      [pickTemplate, pickTemplateTether]: IBehavior<INode, IAgentTemplateId>,
      [typeInstructions, typeInstructionsTether]: IBehavior<INode, string>,
      [pickFile, pickFileTether]: IBehavior<INode, IPick>,
      [clickCopy, clickCopyTether]: IBehavior<PointerEvent, string>,
      [clickDownload, clickDownloadTether]: IBehavior<PointerEvent>
    ) => {
      const chosen: IStream<IAgentTemplateId> = state('instruction', pickTemplate)
      const instructions: IStream<string> = state('', typeInstructions)
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
            effectProp('value', op(instructions, take(1))),
            typeInstructionsTether(
              nodeEvent('input'),
              map(event => (event.currentTarget as HTMLTextAreaElement).value)
            )
          )(),
          $code(after.replace(/^\n+/, ''))
        )
      }

      const $editor = switchLatest(
        map(
          ({ template, pick }) => {
            const files = filesOf(template, INSTRUCTIONS_MARK)
            const [main] = files
            const shown = pick !== null && pick.template === template ? files.find(file => file.path === pick.path) : main
            if (main === undefined || shown === undefined) throw new Error(`the ${template} template has no file to show`)
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
                                map(() => ({ template, path: file.path }))
                              )
                            )($row(spacing.tiny, style({ alignItems: 'center' }))($fileIcon(file.path, '13px'), $text(file.path.slice(file.path.lastIndexOf('/') + 1))))
                          )
                        )
                  )
                ),
                $row(spacing.tiny, style({ alignItems: 'center', marginLeft: 'auto' }))(
                  ...(files.length === 1
                    ? [
                        $ButtonSecondary({
                          $container: $defaultMiniButtonSecondary,
                          $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $copy, viewBox: '0 0 24 24', width: '14px' }), $text('Copy'))
                        })({ click: clickCopyTether(map(() => shown.path)) })
                      ]
                    : []),
                  $ButtonPrimary({
                    $container: $defaultMiniButtonPrimary,
                    $content: $row(spacing.tiny, style({ alignItems: 'center' }))($icon({ $content: $download, viewBox: '0 0 24 24', width: '14px' }), $text('Download'))
                  })({ click: clickDownloadTether() })
                )
              ),
              shown === main ? $main(shown) : shown.path.endsWith('.ts') ? $tsCode(shown.content) : $code(shown.content)
            )
          },
          combine({ template: chosen, pick: picked })
        )
      )

      const failure: IStream<string> = op(
        merge(
          op(
            sampleMap((p: { template: IAgentTemplateId; text: string }, path: string) => ({ files: filesOf(p.template, p.text), path }), combine({ template: chosen, text: instructions }), clickCopy),
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
            sampleMap((p: { template: IAgentTemplateId; text: string }, _click: PointerEvent) => filesOf(p.template, p.text), combine({ template: chosen, text: instructions }), clickDownload),
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

      return [
        $column(spacing.default)(
          switchLatest(
            map(
              current =>
                $row(spacing.tiny, style({ flexWrap: 'wrap' }))(
                  ...AGENT_TEMPLATES.map(template =>
                    $choice(template.id === current)(
                      attr({ title: template.detail }),
                      style({ padding: '4px 12px', fontSize: text.sm, whiteSpace: 'nowrap' }),
                      pickTemplateTether(
                        nodeEvent('click'),
                        map(() => template.id)
                      )
                    )($text(template.name))
                  )
                ),
              chosen
            )
          ),
          $editor,
          switchLatest(map(message => (message === '' ? empty : $node(style({ color: palette.negative, fontSize: text.sm }))($text(message))), failure))
        ),
        {}
      ]
    }
  )
