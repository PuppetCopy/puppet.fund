import replace from '@rollup/plugin-replace'
import dotenv from 'dotenv'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Loaded explicitly so config-time env is the same regardless of NODE_ENV (Bun's native
// loading is NODE_ENV-dependent). First match per var wins.
dotenv.config({ path: ['.env.local', '.env'], quiet: true })

const SITE_CONFIG = {
  __WEBSITE__: 'https://puppet.fund',
  __TWITTER_ID__: '@PuppetCopy',
  __APP_NAME__: 'Puppet',
  __APP_DESC_SHORT__: 'Puppet, seamless copytrading',
  __APP_DESC_LONG__: 'Fund top on-chain traders and share their gains. You keep your keys and set the rules.',
  __OG_IMAGE__:
    '/api/og{{if eq .OriginalReq.URL.Path `/leaderboard`}}/leaderboard?d={{now | date `2006-01-02-15`}}{{end}}',
  __THEME_PRIMARY__: '#870B38',
  __THEME_BACKGROUND__: '#292c37'
}

const WC_METADATA = {
  name: SITE_CONFIG.__APP_NAME__,
  description: SITE_CONFIG.__APP_DESC_LONG__,
  url: SITE_CONFIG.__WEBSITE__,
  icons: [`${SITE_CONFIG.__WEBSITE__}/assets/pwa/transparent-512x512.png`]
}

// Only the dev-server proxy needs the indexer endpoint; a production build must not.
const INDEXER_GRAPHQL = Bun.env.INDEXER_ENDPOINT ? new URL(Bun.env.INDEXER_ENDPOINT) : null

export default defineConfig(({ command }) => {
  if (command === 'serve' && INDEXER_GRAPHQL === null) {
    throw new Error('INDEXER_ENDPOINT env var is required')
  }
  return {
    resolve: { tsconfigPaths: true },
    define: {
      __WC_METADATA__: JSON.stringify(WC_METADATA)
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
      proxy: {
        '/api/rpc': {
          target: Bun.env.RPC_URL,
          changeOrigin: true,
          secure: true,
          rewrite: path => {
            const url = new URL(path, 'http://localhost')
            const network = url.searchParams.get('network')
            return `/${network}/${Bun.env.RPC_KEY}`
          }
        },
        ...(INDEXER_GRAPHQL
          ? {
              '/api/indexer': {
                target: INDEXER_GRAPHQL.origin,
                changeOrigin: true,
                secure: true,
                ws: true,
                rewrite: (path: string) => path.replace(/^\/api\/indexer/, INDEXER_GRAPHQL.pathname)
              }
            }
          : {}),
        // All swap/bridge providers behind one namespace: /api/swap/<provider>/<upstream path>.
        '/api/swap/across': {
          target: 'https://app.across.to',
          changeOrigin: true,
          secure: true,
          rewrite: path => {
            const stripped = path.replace(/^\/api\/swap\/across/, '/api')
            const integratorId = Bun.env.ACROSS_INTEGRATOR_ID ?? Bun.env.ACROSS_API_KEY ?? ''
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
          // Proxy the WebSocket upgrade for `/api/matchmaker/ws` — without this
          // flag Vite returns 426 to the upgrade and fromWebsocket times out
          // after 5s, logging "WebSocket is closed before the connection is
          // established" when it then closes the still-CONNECTING socket.
          ws: true,
          rewrite: path => path.replace(/^\/api\/matchmaker/, '')
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
          description: SITE_CONFIG.__APP_DESC_LONG__,
          theme_color: SITE_CONFIG.__THEME_BACKGROUND__,
          background_color: SITE_CONFIG.__THEME_BACKGROUND__,
          lang: 'en',
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
