import { describe, expect, test } from 'bun:test'
import type { IAccount } from '@puppet/indexer-graphql/entities'
import type { IAccountRow } from './metric.js'

type _RowCoversEntity = IAccount extends IAccountRow ? true : never
type _EntityCoversRow = IAccountRow extends IAccount ? true : never
const rowCoversEntity: _RowCoversEntity = true
const entityCoversRow: _EntityCoversRow = true

describe('IAccountRow drift guard', () => {
  test('stays structurally identical to the generated Account entity', () => {
    expect(rowCoversEntity && entityCoversRow).toBe(true)
  })
})
