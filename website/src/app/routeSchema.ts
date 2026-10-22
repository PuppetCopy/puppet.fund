import { createRouteSchema, href } from 'aelea/ui-router'

export const routeSchema = createRouteSchema({
  fragment: '',
  title: 'Puppet',
  children: {
    traders: {
      fragment: 'traders',
      title: 'Funds',
      children: {
        detail: { fragment: /^0x[0-9a-fA-F]{40}$/, param: 'master', title: 'Fund' }
      }
    },
    puppets: {
      fragment: 'puppets',
      title: 'Puppets',
      children: {
        detail: { fragment: /^0x[0-9a-fA-F]{40}$/, param: 'account', title: 'Puppet' }
      }
    },
    portfolio: { fragment: 'portfolio', title: 'Account' },
    wallet: {
      fragment: 'wallet',
      title: 'Wallet',
      children: {
        agent: { fragment: 'agent', title: 'Agent link' }
      }
    },
    quickstart: { fragment: 'quickstart', title: 'Quickstart' },
    changelog: { fragment: 'changelog', title: 'Release log' },
    governance: {
      fragment: 'governance',
      title: 'Governance',
      children: {
        proposal: { fragment: /^\d+$/, param: 'proposal', title: 'Proposal' }
      }
    }
  }
} as const)

export const walletPaths: readonly string[] = [href(routeSchema.wallet), href(routeSchema.wallet.agent)]
