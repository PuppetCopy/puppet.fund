// The generic operator entrypoint. createOperatorCore is the venue-agnostic base every
// operator builds on (pairing, clients, account, the generic operate() dispatch,
// signedBalance recognition, lifecycle); compose it to abstract your own extended
// operator. The ready-made GMX venue lives at @puppet.fund/operator/gmx and is built on
// exactly this core.

// The public token-id registry, so consumers can pin a base token without
// reaching into @puppet internals. Sourced from the contracts package (its origin), not re-barreled via the SDK.
export { TOKEN_ID } from '@puppet/contracts/const'
export {
  CompactContractError,
  CompactError,
  createCompact,
  formatThrownError,
  humanizeContractError,
  humanizeErrorCode,
  type IAttestResult,
  type ICompact,
  type ICompactOpts,
  type IMatchmakerStatus
} from '@puppet/sdk/compact'
export { createOperatorCore, type IOperateAmounts, type IOperatorConfig, type IOperatorCore } from './core.js'
export { type IClosable, runOperator } from './lifecycle.js'
export { pairOverBrowser } from './pair.js'
