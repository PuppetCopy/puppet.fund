// Primitives for building a Puppet operator. The ready-made GMX venue lives at
// @puppet.fund/operator/gmx and sets up its own compact; these are the building
// blocks under it.

// The public token-id registry, so consumers can pin a base token without
// reaching into @puppet internals.
export { TOKEN_ID } from '@puppet/sdk/account'
export {
  createCompact,
  type IAttestResult,
  type ICompact,
  type ICompactOpts,
  type IMatchmakerStatus
} from '@puppet/sdk/compact'
export { pairOverBrowser } from './pair.js'
