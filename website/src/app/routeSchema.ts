import { createRouteSchema } from 'aelea/ui-router'

export const routeSchema = createRouteSchema({
  fragment: '',
  title: 'Puppet',
  children: {
    traders: {
      fragment: 'traders',
      title: 'Traders',
      children: {
        detail: { fragment: /^0x[0-9a-fA-F]{40}$/, param: 'master', title: 'Trader' }
      }
    },
    portfolio: { fragment: 'portfolio', title: 'Account' },
    quickstart: { fragment: 'quickstart', title: 'Start trading' }
  }
} as const)
