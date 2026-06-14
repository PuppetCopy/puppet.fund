import { ETH_ADDRESS_REGEXP } from '@puppet/sdk/core'
import { createRouteSchema } from 'aelea/ui-router'

export const routeSchema = createRouteSchema({
  fragment: '',
  title: 'Puppet',
  children: {
    leaderboard: { fragment: 'leaderboard', title: 'Leaderboard' },
    fund: {
      fragment: 'fund',
      children: {
        detail: { fragment: ETH_ADDRESS_REGEXP, param: 'address', title: 'Fund' }
      }
    },
    portfolio: {
      fragment: 'portfolio',
      title: 'Wallet Page'
    }
  }
} as const)
