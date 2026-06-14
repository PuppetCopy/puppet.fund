import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  dev: {
    reloadCommand: 'Alt+R'
  },
  manifest: ({ mode }) => ({
    name: 'Puppet Connect',
    description: 'Fund top traders and share their gains, or run your own fund and trade as you do today. You keep your keys and set the rules.',
    icons: {
      16: '/icon-16.png',
      48: '/icon-48.png',
      128: '/icon-128.png'
    },
    action: {
      default_icon: {
        16: '/icon-16.png',
        48: '/icon-48.png',
        128: '/icon-128.png'
      },
      default_title: 'Puppet Connect'
    },
    permissions: ['storage', 'tabs'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    },
    externally_connectable: {
      matches:
        mode === 'production'
          ? ['https://puppet.fund/*', 'https://*.puppet.fund/*']
          : ['http://localhost:*/*', 'https://puppet.fund/*', 'https://*.puppet.fund/*']
    },
    web_accessible_resources: [
      {
        resources: ['/inpage.js'],
        matches: ['<all_urls>']
      }
    ]
  }),
  vite: ({ mode }) => ({
    define: {
      'import.meta.env.VITE_PUPPET_URL': JSON.stringify(
        process.env.VITE_PUPPET_URL ?? (mode === 'production' ? 'https://puppet.fund' : 'http://localhost:3000')
      ),
      'import.meta.env.VITE_MATCHMAKER_WS_URL': JSON.stringify(
        process.env.VITE_MATCHMAKER_WS_URL ??
          (mode === 'production' ? 'wss://puppet.fund/api/matchmaker' : 'ws://localhost:4000/ws')
      )
    }
  })
})
