import { readFileSync } from 'node:fs'
import { Agent } from 'node:https'
import replace from '@rollup/plugin-replace'
import dotenv from 'dotenv'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Loaded explicitly so config-time env is the same regardless of NODE_ENV (Bun's native
// loading is NODE_ENV-dependent). First match per var wins.
dotenv.config({ path: ['.env.local', '.env'], quiet: true })

const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

function themeVar(themeName: string, role: string): string {
  const block = new RegExp(`body\\.${themeName}\\s*\\{([\\s\\S]*?)\\}`).exec(INDEX_HTML)?.[1]
  if (block === undefined) throw new Error(`index.html has no body.${themeName} block in #aelea-theme-config`)
  const value = new RegExp(`--${role}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
  if (value === undefined) throw new Error(`index.html body.${themeName} defines no --${role}`)
  return value
}

// Mirrors ops/website.Caddyfile so a CSP or header regression surfaces in dev, not in the container.
// script-src additionally allows inline here ONLY because vite-plugin-pwa injects an inline dev-SW
// registrar that the built index.html does not have; Caddy stays strict for the shipped bundle.
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src *; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
}

const WEBSITE = 'https://puppet.fund'
const SITE_CONFIG = {
  __WEBSITE__: WEBSITE,
  __TWITTER_ID__: '@PuppetCopy',
  __APP_NAME__: 'Puppet',
  __APP_DESC_SHORT__: 'Puppet, a trading wallet operated by humans and agents',
  __APP_DESC_LONG__:
    'Back top traders and share their gains, or trade as you do today with backing from others, on any EVM chain. Keep your keys; every match runs under rules you sign.',
  __APP_DESC_INSTALL__:
    'Installs Puppet as its own app: a standalone window with no browser chrome, a home screen icon, and faster loads, so charts and order entry get the full screen and stay put while you trade. It is the same Puppet either way, with the same keys and the same account. Cancel to keep using it in this browser tab.',
  __OG_IMAGE__: `${WEBSITE}/api/og{{$p := .OriginalReq.URL.Path}}{{$master := regexFind \`^/traders/0x[0-9a-fA-F]{40}$\` $p}}{{if $master}}/masters/{{regexFind \`0x[0-9a-fA-F]{40}\` $master}}?{{$s := .OriginalReq.URL.Query.Get \`s\`}}{{if $s}}s={{urlquery $s}}{{else}}d={{now | date \`2006-01-02-15\`}}{{end}}{{else if eq $p \`/traders\`}}/masters?d={{now | date \`2006-01-02-15\`}}{{end}}`,
  __THEME_BG_LIGHT__: themeVar('light', 'horizon'),
  __THEME_BG_DARK__: themeVar('dark', 'horizon')
}

const WC_METADATA = {
  name: SITE_CONFIG.__APP_NAME__,
  description: SITE_CONFIG.__APP_DESC_LONG__,
  url: SITE_CONFIG.__WEBSITE__,
  icons: [`${SITE_CONFIG.__WEBSITE__}/assets/pwa/transparent-512x512.png`]
}

const RELAYER_ADDRESS = Bun.env.RELAYER_ADDRESS
if (!RELAYER_ADDRESS) throw new Error('RELAYER_ADDRESS is required; set it in .env.local')
if (!/^0x[0-9a-fA-F]{40}$/.test(RELAYER_ADDRESS)) {
  throw new Error(`RELAYER_ADDRESS "${RELAYER_ADDRESS}" is not a 20-byte address; every signed intent would name it`)
}

export default defineConfig(() => {
  return {
    resolve: { tsconfigPaths: true },
    define: {
      __WC_METADATA__: JSON.stringify(WC_METADATA),
      __RELAYER_ADDRESS__: JSON.stringify(RELAYER_ADDRESS)
    },
    build: {
      sourcemap: true,
      target: 'es2022',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2300,
      rollupOptions: {
        treeshake: {
          moduleSideEffects: 'no-external',
          propertyReadSideEffects: false
        },
        output: {
          manualChunks(id) {
            // Don't manually chunk web3 packages - let Vite handle them
            // to avoid platform-specific circular dependency issues

            // Skip non-node_modules
            if (!id.includes('node_modules/') && !id.includes('/dist/')) {
              return undefined
            }

            // // Workspace packages
            if (id.includes('aelea/')) return 'puppet-core'

            // // Heavy dependencies that should be isolated
            if (id.includes('sdk/dist')) return 'sdk'
            if (id.includes('lightweight-charts')) return 'charts'

            // Web3 related - keep together to avoid circular deps

            // All other node_modules go to vendor
            // if (id.includes('node_modules/')) return 'vendor'

            return undefined
          }
        }
      }
    },
    server: {
      port: Number(Bun.env.PORT) || 3000,
      headers: SECURITY_HEADERS,
      proxy: {
        '/api/rpc': {
          target: Bun.env.RPC_URL,
          changeOrigin: true,
          secure: true,
          agent: new Agent({ keepAlive: false }),
          proxyTimeout: 20_000,
          rewrite: path => {
            const url = new URL(path, 'http://localhost')
            const network = url.searchParams.get('network')
            return `/${network}/${Bun.env.RPC_KEY_WEBSITE}`
          }
        },
        // All swap/bridge providers behind one namespace: /api/swap/<provider>/<upstream path>.
        '/api/swap/across': {
          target: 'https://app.across.to',
          changeOrigin: true,
          secure: true,
          rewrite: path => {
            const stripped = path.replace(/^\/api\/swap\/across/, '/api')
            const integratorId = Bun.env.ACROSS_INTEGRATOR_ID
            if (!integratorId) {
              throw new Error('Missing ACROSS_INTEGRATOR_ID: set it in .env (see .env.example); without it Across throttles as anonymous')
            }
            return `${stripped}${stripped.includes('?') ? '&' : '?'}integratorId=${integratorId}`
          }
        },
        '/api/swap/lifi': {
          target: 'https://li.quest',
          changeOrigin: true,
          secure: true,
          rewrite: path => path.replace(/^\/api\/swap\/lifi/, ''),
          headers: Bun.env.LIFI_API_KEY ? { 'x-lifi-api-key': Bun.env.LIFI_API_KEY } : undefined
        },
        '/api/matchmaker': {
          target: Bun.env.MATCHMAKER_ENDPOINT,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/matchmaker/, '')
        },
        '/api/chronicle': {
          target: Bun.env.CHRONICLE_ENDPOINT,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/chronicle/, '')
        },
        '/api/oracle': {
          target: Bun.env.ORACLE_ENDPOINT,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/oracle/, '')
        },
        '^/api/og(/.*)?$': {
          target: Bun.env.OG_ENDPOINT || 'http://localhost:4100',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/og/, '/og')
        }
      }
    },
    plugins: [
      VitePWA({
        registerType: 'prompt',
        strategies: 'injectManifest',
        injectManifest: {
          maximumFileSizeToCacheInBytes: 2_000_000,
          globPatterns: ['**/*.{js,html,svg,ico,woff2,png}']
        },
        injectRegister: false,
        srcDir: 'src/app/sw',
        filename: 'service-worker.ts',
        pwaAssets: {
          config: true,
          overrideManifestIcons: true
        },
        manifest: {
          name: SITE_CONFIG.__APP_NAME__,
          short_name: SITE_CONFIG.__APP_NAME__,
          description: SITE_CONFIG.__APP_DESC_INSTALL__,
          theme_color: SITE_CONFIG.__THEME_BG_DARK__,
          background_color: SITE_CONFIG.__THEME_BG_DARK__,
          lang: 'en',
          start_url: '/portfolio',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui'],
          orientation: 'portrait-primary',
          categories: ['Copy Trading', 'DeFi'],
          screenshots: [
            { src: 'assets/screenshot/narrow1.png', type: 'image/png', sizes: '828x1792', form_factor: 'narrow' },
            { src: 'assets/screenshot/narrow2.png', type: 'image/png', sizes: '828x1792', form_factor: 'narrow' },

            { src: 'assets/screenshot/wide1.png', type: 'image/png', sizes: '3260x1692', form_factor: 'wide' },
            { src: 'assets/screenshot/wide2.png', type: 'image/png', sizes: '3260x1692', form_factor: 'wide' }
          ]
        },
        // Note: workbox options are not used with injectManifest strategy
        // Service worker lifecycle is controlled in src/app/sw/service-worker.ts
        devOptions: {
          enabled: true,
          navigateFallback: 'index.html',
          suppressWarnings: true,
          type: 'module'
        }
      }),
      replace({
        preventAssignment: true,
        include: 'index.html',
        ...SITE_CONFIG
      })
    ]
  }
})
