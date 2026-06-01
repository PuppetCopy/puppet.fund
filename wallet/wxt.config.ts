import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  dev: {
    reloadCommand: 'Alt+R'
  },
  manifest: {
    name: 'Puppet Wallet',
    description: 'Smart wallet for copy-trading on any dApp',
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
      default_title: 'Puppet Wallet'
    },
    permissions: ['storage', 'tabs'],
    externally_connectable: {
      matches: ['http://localhost:*/*', 'https://puppet.fund/*', 'https://*.puppet.fund/*']
    },
    web_accessible_resources: [
      {
        resources: ['/inpage.js'],
        matches: ['<all_urls>']
      }
    ]
  },
  vite: ({ mode }) => ({
    define: {
      'import.meta.env.VITE_PUPPET_URL': JSON.stringify(
        process.env.VITE_PUPPET_URL ?? (mode === 'production' ? 'https://puppet.fund' : 'http://localhost:3000')
      ),
      'import.meta.env.VITE_MATCHMAKER_WS_URL': JSON.stringify(
        process.env.VITE_MATCHMAKER_WS_URL ??
          (mode === 'production' ? 'wss://puppet.fund/api/matchmaker' : 'ws://localhost:8080')
      )
    }
  })
})
