import { empty, type IStream, just, map, switchMap } from 'aelea/stream'
import { fromCallback, type IBehavior } from 'aelea/stream-extended'
import { $element, $node, $text, attr, component, type I$Node, style } from 'aelea/ui'
import { $column, $row, isDesktopScreen, isMobileScreen, spacing } from 'aelea/ui-components'
import { palette } from 'aelea/ui-components-theme'
import { $ButtonSecondary, $defaultButtonSecondary, $icon } from '@/ui-components'
import { $gmxLogo, $puppetLogo } from '../common/$icons.js'
import { $heading1 } from '../common/$text.js'
import { $labeledDivider } from '../common/elements/$common.js'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
}

export interface I$Home {}

const installPrompt: IStream<BeforeInstallPromptEvent> = fromCallback(cb =>
  window.addEventListener('beforeinstallprompt', cb as EventListener)
)

const $snapSection = $column(
  style({
    alignItems: 'center',
    gap: '26px',
    scrollSnapAlign: 'start',
    minHeight: '100vh',
    placeContent: 'center'
  })
)

const $windowButton = $row(style({ width: '8px', height: '8px', borderRadius: '50%' }))
const $windowTopBar = $row(
  style({ backgroundColor: palette.background, alignItems: 'center', gap: '3px', padding: '4px 6px' })
)(
  $windowButton(style({ backgroundColor: palette.negative }))(),
  $windowButton(style({ backgroundColor: palette.indeterminate }))(),
  $windowButton(style({ backgroundColor: palette.positive }))()
)

const $mockWindow = ($content: I$Node) =>
  $column(style({ borderRadius: '4px', overflow: 'hidden', boxShadow: '#00000063 0px 5px 20px 3px' }))(
    $windowTopBar,
    $content
  )

const $video = (src: string) =>
  $mockWindow(
    $element('video')(attr({ playsinline: '', width: '100%', height: '100%', loop: '', autoplay: '' }))(
      $element('source')(attr({ type: 'video/mp4', src }))()
    )
  )

export const $Home = (_config: I$Home) =>
  component(([_clickDownload, clickDownloadTether]: IBehavior<unknown, unknown>) => [
    $column(spacing.big, style({ flex: 1, lineHeight: '1.3' }))(
      $snapSection(
        style({
          width: '100vw',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'local',
          placeSelf: 'center',
          position: 'relative',
          top: 0,
          height: '100vh',
          paddingBottom: '30vh'
        })
      )(
        $row(style({ flex: 1, width: '50vh', perspective: '680px', position: 'absolute', bottom: 0 }))(
          style({ transform: 'translateY(0px) translateZ(0) rotateX(40deg)' })(
            $video('assets/video/leaderboard-pick-masters.mp4')
          )
        ),
        $column(spacing.big, style({ alignItems: 'center' }))(
          $column(style({ textAlign: 'center' }))(
            $node(
              style({
                fontWeight: 'bold',
                fontSize: isDesktopScreen ? '2.5em' : '1.85rem',
                whiteSpace: 'pre-wrap',
                letterSpacing: '2px'
              })
            )($text('Matching top Masters\nwith Investors'))
          ),
          $column(spacing.small, style({ maxWidth: '624px' }))(
            $node(style({ whiteSpace: 'pre-wrap', textAlign: 'center', maxWidth: '878px' }))(
              $text('Masters seamlessly earn more doing what they do best')
            ),
            $node(style({ whiteSpace: 'pre-wrap', textAlign: 'center', maxWidth: '878px' }))(
              $text('Puppets (investors) build a portfolio of top masters, picked by performance and strategy.')
            )
          ),
          $node(),
          $column(spacing.default, style({ minWidth: '250px' }))(
            isMobileScreen ? $node(style({ textAlign: 'center' }))($text('< Coming Soon >')) : empty,
            isMobileScreen
              ? switchMap(
                  prompt =>
                    $column(spacing.default)(
                      $node(),
                      $node(),
                      $column($labeledDivider('Add to Home Screen')),
                      $node(),
                      $ButtonSecondary({
                        disabled: just(true),
                        $content: $row(spacing.small, style({ alignItems: 'center' }))(
                          $icon({ $content: $puppetLogo, size: '24px', viewBox: '0 0 32 32' }),
                          $text('Download'),
                          $icon({ $content: $gmxLogo, size: '24px', viewBox: '0 0 32 32' })
                        ),
                        $container: $defaultButtonSecondary(
                          style({ position: 'relative', alignSelf: 'center', borderRadius: '30px' })
                        )
                      })({
                        click: clickDownloadTether(map(() => prompt.prompt()))
                      })
                    ),
                  installPrompt
                )
              : empty
          ),
          $node(
            style({
              color: palette.foreground,
              position: 'absolute',
              bottom: '50px',
              left: '50%',
              transform: 'translateX(-50%)'
            })
          )($text('Learn More'))
        )
      ),
      $snapSection(style({ margin: '0 auto', maxWidth: '1240px', flexDirection: 'row', gap: '70px' }))(
        $column(spacing.default, style({ flex: 1 }))(
          $heading1($text('Pick Top Masters to Copy')),
          $text(
            'Explore the leaderboard to find masters, pick the ones you like, and set rules to protect your deposit.'
          ),
          $text(
            'Each time a master opens or adjusts a position, a share of your deposit copies it, within the rules you set.'
          )
        ),
        $row(style({ flex: 1 }))($video('assets/video/leaderboard-pick-masters.mp4'))
      ),
      $snapSection(style({ margin: '0 auto', maxWidth: '1240px', flexDirection: 'row', gap: '70px' }))(
        $column(spacing.default, style({ flex: 1 }))(
          $heading1($text('Masters Earn More')),
          $text('Masters earn more as more puppets copy their trades.'),
          $text('They trade their own funds as usual, never holding or managing puppet money.')
        ),
        $row(style({ flex: 1 }))($video('assets/video/trade-adjust.mp4'))
      )
    ),
    {}
  ])
