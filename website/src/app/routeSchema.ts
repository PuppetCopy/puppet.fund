import { ETH_ADDRESS_REGEXP } from '@puppet/sdk/core'
import { createRouteSchema } from 'aelea/ui-router'

export const routeSchema = createRouteSchema({
  fragment: '',
  title: 'Puppet',
  children: {
    home: { fragment: 'home', title: 'Home' },
    hello: { fragment: 'hello', title: 'Get Started' },
    leaderboard: { fragment: 'leaderboard', title: 'Leaderboard' },
    master: {
      fragment: 'master',
      children: {
        detail: { fragment: ETH_ADDRESS_REGEXP, param: 'address', title: 'Master' }
      }
    },
    portfolio: {
      fragment: 'portfolio',
      title: 'Portfolio'
    }
  }
} as const)
