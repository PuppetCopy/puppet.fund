import { describe, expect, test } from 'bun:test'
import type { IAccountState } from '@puppet/indexer-graphql/entities'
import type { IAccountStateRow } from './metric.js'

// Compile-time drift guard (typecheck-only). IAccountStateRow is a hand-mirror of the
// generated AccountState entity, kept SDK-local so the SDK's public .d.ts carries no
// @puppet/indexer-graphql reference (which ships raw .ts and blocks declaration
// bundling downstream). If the entity changes shape, one of these aliases resolves to
// `never`, the const assignment stops compiling, and sdk tsgo:check fails — re-sync
// IAccountStateRow in metric.ts then. (This import lives only in the test, never in
// the SDK's shipped public types.)
type _RowCoversEntity = IAccountState extends IAccountStateRow ? true : never
type _EntityCoversRow = IAccountStateRow extends IAccountState ? true : never
const rowCoversEntity: _RowCoversEntity = true
const entityCoversRow: _EntityCoversRow = true

describe('IAccountStateRow drift guard', () => {
  test('stays structurally identical to the generated AccountState entity', () => {
    expect(rowCoversEntity && entityCoversRow).toBe(true)
  })
})
